// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The qualify runner (R-112, shared-plugin-supervisor §5.8): it takes the request plugin-hostd wrote into its spool,
 * runs the quick check isolated, and ALWAYS records a verdict. These tests hold the rule's gate for this repo: a spool
 * request is qualified; a prober killed by a signal, an OOM kill and a timeout each write verdict=refused with their
 * outcome code; the process runs at idle priority on no audio CPU (a real child, read back from /proc); the pin files
 * are written by temporary file and rename; and a verdict never overwrites the operator's choice.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pinWords } from "./pins-file.js";
import {
  audioCpusOf,
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

function desk(opts: { stored?: boolean } = {}): { cfg: SpoolConfig; files: { spool: string; pins: string; store: string; accepted: string } } {
  const root = mkdtempSync(join(tmpdir(), "qualify-spool."));
  dirs.push(root);
  const spool = join(root, "state", "plugin-hostd", "qualify");
  const pins = join(root, "pins.d");
  const store = join(root, "state", "plugin-hostd", "pins");
  mkdirSync(spool, { recursive: true });
  mkdirSync(pins, { recursive: true });
  writeFileSync(join(spool, "fx-0001.request"), `uri ${URI}\nfile fx.clap ${SHA}\n`);
  if (opts.stored !== false) writeFileSync(store, `pin_set ${URI} fx.clap=${SHA} -\n`);
  return { cfg: { spoolDir: spool, pinsDir: pins, storePath: store, budgetMs: 1000, quick: ["plugin-qualify"] }, files: { spool, pins, store, accepted: `${store}.accepted` } };
}

const deps = (end: SpoolProbeEnd, extra: Partial<SpoolDeps> = {}): SpoolDeps => ({
  audioCpus: () => [0],
  onlineCpus: () => [0, 1, 2, 3],
  probe: async () => end,
  ...extra,
});
const pinLinesOf = (dir: string): string[] =>
  readdirSync(dir).filter((f) => f.endsWith(".pins")).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim() !== ""));
const verdictOf = (line: string): string | undefined => pinWords(line).find((w) => w.startsWith("verdict="))?.slice(8);

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

describe("a spool request is qualified and its verdict is always recorded", () => {
  it("a pass is written as the verdict the run earned, by temporary file and rename, and the request is left to the daemon", async () => {
    const { cfg, files } = desk();
    const out = await runSpoolOnce(cfg, deps({ kind: "exited", code: 0, stdout: "", pinsText: `pin_set ${URI} fx.clap=${SHA} ${LAYOUT} verdict=in-process\n` }));
    expect(out).toEqual([{ uri: URI, verdict: "in-process" }]);
    expect(pinLinesOf(files.pins).map(verdictOf)).toEqual(["in-process"]);
    expect(readdirSync(files.pins).filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(existsSync(join(files.spool, "fx-0001.request"))).toBe(true);
  });

  it.each([
    ["a prober killed by a signal", { kind: "signaled", signal: "SIGSEGV" } as SpoolProbeEnd, "probe.crashed"],
    ["an OOM kill", { kind: "memory-limit" } as SpoolProbeEnd, "probe.memory-limit"],
    ["the budget passing", { kind: "timeout" } as SpoolProbeEnd, "probe.timeout"],
  ])("%s is recorded as verdict=refused with %s", async (_n, end, reason) => {
    const { cfg, files } = desk();
    const out = await runSpoolOnce(cfg, deps(end));
    expect(out).toEqual([{ uri: URI, verdict: "refused", reason }]);
    const lines = pinLinesOf(files.pins);
    expect(lines.map(verdictOf)).toEqual(["refused"]);
    // the pin keeps the files the daemon hashed, so the verdict is about those very bytes
    expect(lines[0]).toContain(`fx.clap=${SHA}`);
    expect(JSON.parse(readFileSync(join(files.spool, "fx-0001.verdict"), "utf8"))).toMatchObject({ uri: URI, verdict: "refused", reason });
  });

  it("a request that has its verdict is not qualified again", async () => {
    const { cfg } = desk();
    let runs = 0;
    const d = deps({ kind: "timeout" }, { probe: async () => (runs++, { kind: "timeout" }) });
    await runSpoolOnce(cfg, d);
    await runSpoolOnce(cfg, d);
    expect(runs).toBe(1);
  });

  it("no known audio cpu set means no run and no verdict, said and left for the next pass", async () => {
    const { cfg, files } = desk();
    let runs = 0;
    const out = await runSpoolOnce(cfg, deps({ kind: "timeout" }, { audioCpus: () => undefined, probe: async () => (runs++, { kind: "timeout" }) }));
    expect(runs).toBe(0);
    expect(out).toEqual([{ uri: URI, deferred: "the audio cpus are not known" }]);
    expect(pinLinesOf(files.pins)).toEqual([]);
  });
});

describe("a verdict never overwrites the operator", () => {
  it("leaves the operator's accepted list byte for byte, and writes the refusal as advice", async () => {
    const { cfg, files } = desk();
    writeFileSync(files.accepted, `# the user's choices\n${URI}\n`);
    const before = readFileSync(files.accepted);
    await runSpoolOnce(cfg, deps({ kind: "signaled", signal: "SIGSEGV" }));
    expect(readFileSync(files.accepted).equals(before)).toBe(true);
    expect(pinLinesOf(files.pins).map(verdictOf)).toEqual(["refused"]);
  });

  it("drops a verdict that finishes after a pin_clear of its files: the store no longer holds the plugin", async () => {
    const { cfg, files } = desk({ stored: false });
    const out = await runSpoolOnce(cfg, deps({ kind: "timeout" }));
    expect(out).toEqual([{ uri: URI, dropped: "the pin store no longer holds the plugin" }]);
    expect(pinLinesOf(files.pins)).toEqual([]);
    expect(existsSync(join(files.spool, "fx-0001.verdict"))).toBe(false);
  });

  it("drops a verdict about files that are no longer the pinned ones", async () => {
    const { cfg, files } = desk();
    writeFileSync(files.store, `pin_set ${URI} fx.clap=${"c".repeat(64)} -\n`);
    const out = await runSpoolOnce(cfg, deps({ kind: "timeout" }));
    expect(out[0]).toMatchObject({ dropped: expect.stringContaining("files") });
    expect(pinLinesOf(files.pins)).toEqual([]);
  });
});

describe("the pin files are written by temporary file and rename", () => {
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
