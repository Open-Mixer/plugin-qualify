// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The qualify runner (R-112, shared-plugin-supervisor §5.8): it takes the request plugin-hostd wrote into its spool,
 * runs the check isolated: plugin-qualify-sync --plugin, which puts the record into the qualification store, where
 * plugin-hostd reads the verdict (the owner's ruling of 2026-11-28: never a pin file in pins_dir). These tests hold the
 * rule's gate for this repo: a spool request is qualified by that command; a check killed by a signal, an OOM kill and
 * a timeout leave no record and are kept beside the request with their outcome code; nothing is written into the pins
 * directory; the process runs at idle priority on no audio CPU (a real child, read back from /proc); the spool's own
 * files are written by temporary file and rename; and a run never touches the operator's choice.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  audioCpusOf,
  defaultProbe,
  noFiguresArgv,
  storeKeyOf,
  isolatedArgv,
  isolationFor,
  parseRequest,
  runSpoolOnce,
  spawnIsolated,
  writeAtomic,
  type SpoolProbeEnd,
  type SpoolConfig,
  type SpoolDeps,
} from "./qualify-spool.js";

const URI = "clap:/usr/lib/clap/fx.clap#org.example.fx";
const SHA = "a".repeat(64);
const LAYOUT = `omx-layout/1:${"b".repeat(64)}`;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function desk(): { cfg: SpoolConfig; files: { spool: string; pins: string; store: string; accepted: string } } {
  const root = mkdtempSync(join(tmpdir(), "qualify-spool."));
  dirs.push(root);
  const spool = join(root, "state", "plugin-hostd", "qualify");
  const pins = join(root, "pins.d");
  const store = join(root, "state", "plugin-hostd", "pins");
  mkdirSync(spool, { recursive: true });
  mkdirSync(pins, { recursive: true });
  writeFileSync(join(spool, "fx-0001.request"), `uri ${URI}\nfile fx.clap ${SHA}\n`);
  writeFileSync(store, `pin_set ${URI} fx.clap=${SHA} -\n`);
  return { cfg: { spoolDir: spool, budgetMs: 1000, quick: ["plugin-qualify-sync"], writer: ["plugin-qualification-db-write"], scope: "user" }, files: { spool, pins, store, accepted: `${store}.accepted` } };
}

/** The figure-less records the spool asked the writer for: (uri, reason) */
const written: [string, string][] = [];
afterEach(() => written.splice(0));
const deps = (end: SpoolProbeEnd, extra: Partial<SpoolDeps> = {}): SpoolDeps => ({
  audioCpus: () => [0],
  onlineCpus: () => [0, 1, 2, 3],
  probe: async () => end,
  noFigures: (request, reason) => (written.push([request.uri, reason]), undefined),
  ...extra,
});
/** Whatever a pass left in the pins directory: the packages' alone, so nothing. */
const pinsDirFiles = (dir: string): string[] => readdirSync(dir);

describe("the spool request and the cpus it may run on", () => {
  it("reads the uri and the files the daemon hashed, and refuses a request with no uri", () => {
    expect(parseRequest(`uri ${URI}\nfile fx.clap ${SHA}\n`)).toEqual({ uri: URI, files: [{ path: "fx.clap", sha256: SHA }] });
    expect(parseRequest(`file fx.clap ${SHA}\n`)).toBeUndefined();
  });

  it("the audio cpus are the driver's and every worker's; the qualify cpus are the rest, and none known is a refusal to run", () => {
    expect(audioCpusOf({ driverCpu: 2, perWorker: [{ cpu: 3 }, { cpu: null }] })).toEqual([2, 3]);
    expect(audioCpusOf(null)).toBeUndefined();
    expect(isolationFor([2, 3], [0, 1, 2, 3])).toEqual({ ok: true, cpus: [0, 1] });
    expect(isolationFor([0, 1, 2, 3], [0, 1, 2, 3]).ok).toBe(false);
    expect(isolationFor(undefined, [0, 1]).ok).toBe(false);
  });

  it("the argv pins the cpus, idles the scheduler and the io", () => {
    const argv = isolatedArgv({ ok: true, cpus: [0, 1] }, ["plugin-qualify", "x"]);
    expect(argv.join(" ")).toBe("taskset -c 0,1 ionice -c 3 chrt -i 0 plugin-qualify x");
  });
});

describe("the process the runner starts, read back from /proc (sabotage: spawn it with no isolation -> red)", () => {
  it("runs at SCHED_IDLE on no audio cpu", async () => {
    const online = Array.from({ length: Number(spawnSync("nproc").stdout) }, (_, i) => i);
    if (online.length < 2) return; // one cpu has no complement: the runner refuses to run there (tested above)
    const audio = [online[0]!];
    const iso = isolationFor(audio, online);
    if (!iso.ok) throw new Error(iso.error);
    const end = await spawnIsolated(iso, ["sh", "-c", 'grep Cpus_allowed_list /proc/self/status; chrt -p $$'], { timeoutMs: 20000 });
    if (end.kind !== "exited") throw new Error(`the probe did not run: ${JSON.stringify(end)}`);
    const text = end.stdout;
    const allowed = /Cpus_allowed_list:\s*(\S+)/.exec(text)![1]!;
    const cpus = allowed.split(",").flatMap((r) => { const [a, b] = r.split("-").map(Number); return Array.from({ length: (b ?? a!) - a! + 1 }, (_, i) => a! + i); });
    expect(cpus.filter((c) => audio.includes(c)), `the child ran on an audio cpu: ${allowed}`).toEqual([]);
    expect(text).toMatch(/scheduling policy: SCHED_IDLE/);
  });
});

describe("a spool request is qualified into the store, never into the pins directory", () => {
  it("a check that ran to its end has put its record in the store: the pass says stored and writes no pin file", async () => {
    const { cfg, files } = desk();
    const out = await runSpoolOnce(cfg, deps({ kind: "exited", code: 0, stdout: "" }));
    expect(out).toEqual([{ uri: URI, stored: true }]);
    expect(pinsDirFiles(files.pins)).toEqual([]);
    expect(JSON.parse(readFileSync(join(files.spool, "fx-0001.verdict"), "utf8"))).toEqual({ uri: URI, stored: true });
    expect(existsSync(join(files.spool, "fx-0001.request"))).toBe(true);
  });

  it("the check is plugin-qualify-sync --plugin <uri>, isolated: the one-plugin qualification that puts the record", async () => {
    const root = mkdtempSync(join(tmpdir(), "qualify-spool-argv."));
    dirs.push(root);
    const said = join(root, "argv");
    const sync = join(root, "plugin-qualify-sync");
    writeFileSync(sync, `#!/bin/sh\nprintf '%s\\n' "$@" > ${said}\n`, { mode: 0o755 });
    const iso = isolationFor([0], [0, 1]);
    if (!iso.ok) throw new Error(iso.error);
    const end = await defaultProbe({ uri: URI, files: [] }, iso, { spoolDir: root, budgetMs: 10_000, quick: [sync, "--system"], writer: [], scope: "user" });
    expect(end).toEqual({ kind: "exited", code: 0 });
    expect(readFileSync(said, "utf8").trim().split("\n")).toEqual(["--system", "--plugin", URI]);
  });

  it.each([
    ["a check killed by a signal", { kind: "signaled", signal: "SIGSEGV" } as SpoolProbeEnd, "probe.crashed"],
    ["an OOM kill", { kind: "memory-limit" } as SpoolProbeEnd, "probe.memory-limit"],
    ["the budget passing", { kind: "timeout" } as SpoolProbeEnd, "probe.timeout"],
  ])("%s is the store's figure-less record of the files, refused with %s (decided by the coordinator)", async (_n, end, reason) => {
    const { cfg, files } = desk();
    const out = await runSpoolOnce(cfg, deps(end));
    expect(out).toEqual([{ uri: URI, refused: reason }]);
    expect(written).toEqual([[URI, reason]]);
    expect(pinsDirFiles(files.pins)).toEqual([]);
    expect(JSON.parse(readFileSync(join(files.spool, "fx-0001.verdict"), "utf8"))).toEqual({ uri: URI, stored: true, refused: reason });
  });

  it("the figure-less record is the writer's no-figures verb, the files the daemon hashed in byte order", () => {
    const argv = noFiguresArgv({ spoolDir: "/s", budgetMs: 1, quick: [], writer: ["plugin-qualification-db-write"], scope: "system" },
      { uri: URI, files: [{ path: "z.ttl", sha256: SHA }, { path: "a.so", sha256: SHA }] }, "probe.timeout");
    expect(argv).toEqual(["plugin-qualification-db-write", "no-figures", "--scope", "system", "--format", "clap", "--uri", "org.example.fx",
      "--host", "omx-clap-host", "--reason", "probe.timeout", "--file", `a.so=${SHA}`, "--file", `z.ttl=${SHA}`]);
    expect(storeKeyOf("lv2:urn:x")).toEqual({ format: "lv2", uri: "urn:x" });
  });

  it("a run that failed otherwise, or a record the writer refused, leaves the store as it was", async () => {
    const { cfg, files } = desk();
    const out = await runSpoolOnce(cfg, deps({ kind: "exited", code: 1 }));
    expect(out).toEqual([{ uri: URI, unstored: "probe.refused-instantiation" }]);
    expect(written).toEqual([]);
    expect(JSON.parse(readFileSync(join(files.spool, "fx-0001.verdict"), "utf8"))).toEqual({ uri: URI, stored: false, reason: "probe.refused-instantiation" });
    const again = desk();
    const refused = await runSpoolOnce(again.cfg, deps({ kind: "timeout" }, { noFigures: () => "refused: no-figures-reason" }));
    expect(refused).toEqual([{ uri: URI, unstored: "probe.timeout" }]);
  });

  it("a request that has its end is not qualified again", async () => {
    const { cfg } = desk();
    let runs = 0;
    const d = deps({ kind: "timeout" }, { probe: async () => (runs++, { kind: "timeout" }) });
    await runSpoolOnce(cfg, d);
    await runSpoolOnce(cfg, d);
    expect(runs).toBe(1);
  });

  it("no known audio cpu set means no run, said and left for the next pass", async () => {
    const { cfg, files } = desk();
    let runs = 0;
    const out = await runSpoolOnce(cfg, deps({ kind: "timeout" }, { audioCpus: () => undefined, probe: async () => (runs++, { kind: "timeout" }) }));
    expect(runs).toBe(0);
    expect(out).toEqual([{ uri: URI, deferred: "the audio cpus are not known" }]);
    expect(existsSync(join(files.spool, "fx-0001.verdict"))).toBe(false);
  });
});

describe("a run never touches the operator's choice", () => {
  it("leaves the operator's accepted list and the pin store byte for byte", async () => {
    const { cfg, files } = desk();
    writeFileSync(files.accepted, `# the user's choices\n${URI}\n`);
    const before = [readFileSync(files.accepted), readFileSync(files.store)];
    await runSpoolOnce(cfg, deps({ kind: "signaled", signal: "SIGSEGV" }));
    await runSpoolOnce(cfg, deps({ kind: "exited", code: 0 }));
    expect(readFileSync(files.accepted).equals(before[0]!)).toBe(true);
    expect(readFileSync(files.store).equals(before[1]!)).toBe(true);
  });
});

describe("the spool's files are written by temporary file and rename", () => {
  it("a write that fails before the rename leaves the target as it was and no temporary file", () => {
    const dir = mkdtempSync(join(tmpdir(), "qualify-spool-atomic."));
    dirs.push(dir);
    const target = join(dir, "90-qualify.pins");
    writeFileSync(target, "old\n");
    expect(() => writeAtomic(target, "new\n", () => { throw new Error("killed before the rename"); })).toThrow(/killed/);
    expect(readFileSync(target, "utf8")).toBe("old\n");
    expect(readdirSync(dir)).toEqual(["90-qualify.pins"]);
    const before = statSync(target).ino;
    writeAtomic(target, "new\n");
    expect(readFileSync(target, "utf8")).toBe("new\n");
    // a rename puts a NEW file in place: a reader that had the old one open never sees half of the new (sabotage: write in place -> same inode -> red)
    expect(statSync(target).ino).not.toBe(before);
  });
});
