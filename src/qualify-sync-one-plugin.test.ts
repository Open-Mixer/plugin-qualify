// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify-sync --plugin <target>`: one plugin, never a scan (omx-panel docs/descriptions-store.md, sections 7, 11
 * and 13 lane 6; plugin-qualify#151). Two `.clap` files lie on the search path; `--plugin A` gives A a record, a pin and a
 * descriptor and B none, under the same lock a scan takes. `--under-load` (plugin-hostd's ask, while the engine plays)
 * marks the run with the qualify domain's run condition `measured-under-load`: its figures never reach the store as a
 * quiet machine's, so the planner reads the plugin's cost as unknown, and the next idle scan measures it again whole.
 * The scanner, the probe runner and plugin-hostd are stand-ins (shell scripts), as in qualify-sync-multi-id.test.ts.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { parsePinLine } from "./pins-file.js";
import { MEASURED_UNDER_LOAD, parseSyncArgs, readSyncState, resolveSyncSettings, runSync } from "./qualify-sync.js";
import { searchPathOf, splitPathFlags } from "./hostd-search-path.support.js";
import { QualificationStore } from "./qualification-store.js";
import { fakeStore } from "./store-fake.support.js";

let fake = fakeStore();
beforeEach(() => {
  fake = fakeStore();
});
const store = (): QualificationStore => new QualificationStore("user", { run: fake.run });

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "qualify-sync-one-plugin-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PROBE = readFileSync(join(PKG, "fixtures", "probe-output", "success-msi.json"), "utf8");
const A = "org.example.alpha";
const B = "org.example.beta";

const plugin = (id: string) => ({
  id, name: id, vendor: "v", version: "1", description: "d", url: "u", features: ["audio-effect"],
  params: [], audio_ports: { inputs: [], outputs: [] }, note_ports: { inputs: 0, outputs: 0 }, latency: 0,
});

function stands() {
  const root = mkdtempSync(join(scratch, "p-"));
  const clap = join(root, "clap");
  const out = join(root, "out");
  mkdirSync(clap);
  mkdirSync(join(root, "lv2"));
  const fileOf = (id: string): string => join(clap, `${id}.clap`);
  for (const id of [A, B]) writeFileSync(fileOf(id), `the bytes of ${id}`);
  writeFileSync(join(root, "scan.json"), JSON.stringify({ scanner: "clap-qualify", version: "0.1.0", files: [A, B].map((id) => ({ path: fileOf(id), plugins: [plugin(id)] })) }));
  writeFileSync(join(root, "probe.json"), PROBE);
  // every file the probe runner was asked to measure, one a line: "never a scan" is read here
  const measured = join(root, "measured.log");
  const script = (name: string, body: string): string => {
    const p = join(root, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  const scanner = script("clap-qualify", `cat ${JSON.stringify(join(root, "scan.json"))}`);
  const interposer = join(root, "rt_interpose.so");
  writeFileSync(interposer, "");
  const runner = script(
    "probe-runner",
    `while [ "$1" != "--out" ]; do shift; done; o="$2"; shift 2; while [ "\${1#--}" != "$1" ]; do shift 2; done; f="$1"; id="$2"
echo "$f" >> ${JSON.stringify(measured)}
s=$(sha256sum "$f" | cut -d" " -f1)
sed -e "s|\\"id\\": \\"org.example.plate\\"|\\"id\\": \\"$id\\"|" -e "s|/usr/lib64/clap/example-plate.clap|$f|" -e "s|356902794a4eec2122989e072271ef995968131145db918d9a3084ce582f244b|$s|g" -e "s|\\"example-plate.clap\\"|\\"$(basename "$f")\\"|g" ${JSON.stringify(join(root, "probe.json"))} > "$o"`,
  );
  const hostd = script("plugin-hostd", `while [ "$1" != "--pin-files" ]; do shift; done; u="$2"; p="\${u#clap:}"; p="\${p%#*}"; echo "root $(dirname "$p")"; echo "file $(basename "$p")"`);
  const env = { ...process.env, OMX_CLAP_QUALIFY: scanner, OMX_RT_INTERPOSE: interposer, OMX_PROBE_RUNNER: runner, PLUGIN_HOSTD: hostd } as Record<string, string>;
  const flags = [
    "--config", "/dev/null", "--clap-path", clap, "--lv2-path", join(root, "lv2"), "--lv2-extra", "",
    "--pin-file", join(out, "qualified.pins"), "--descriptor-dir", join(out, "descriptors"), "--state-file", join(out, "state.json"),
    "--budget-s", "4", "--hostd-port", "0", "--hostd-feedback-port", "0", "--settle-s", "0", "--no-distributed",
  ];
  const settings = (extra: readonly string[] = []) => {
    const sp = splitPathFlags([...flags, ...extra]);
    const args = parseSyncArgs(sp.argv);
    if (!args.ok) throw new Error(args.error);
    const r = resolveSyncSettings(new Map(), args.args, env, "/home/u", undefined, undefined, sp.run);
    if (!r.ok) throw new Error(r.error);
    return { settings: r.settings, args: args.args };
  };
  const pins = (): string[] => {
    const file = join(out, "qualified.pins");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").map((l) => parsePinLine(l)).filter((p) => p !== undefined).map((p) => p!.uri);
  };
  const descriptors = (): string[] => (existsSync(join(out, "descriptors")) ? readdirSync(join(out, "descriptors")) : []);
  const measuredFiles = (): string[] => (existsSync(measured) ? [...new Set(readFileSync(measured, "utf8").split("\n").filter((l) => l !== ""))] : []);
  return { env, fileOf, out, settings, pins, descriptors, measuredFiles };
}

describe("plugin-qualify-sync --plugin: one plugin, never a scan", () => {
  it("gives A a record, a pin and a descriptor and B none; B is never measured", async () => {
    const m = stands();
    const target = `clap:${m.fileOf(A)}#${A}`;
    const { settings, args } = m.settings(["--plugin", target]);
    expect(args.plugin).toBe(target);
    const lines: string[] = [];
    const summary = await runSync(settings, { plugin: args.plugin, qualificationStore: store(), env: m.env, log: (l) => lines.push(l) });
    const said = lines.join("\n");
    expect(m.measuredFiles(), said).toEqual([m.fileOf(A)]);
    expect(m.pins(), said).toEqual([target]);
    expect(fake.user().map((r) => r.uri), said).toEqual([A]);
    expect(m.descriptors().some((f) => f.includes(A)), said).toBe(true);
    expect(m.descriptors().some((f) => f.includes(B)), said).toBe(false);
    expect(Object.keys(readSyncState(settings.stateFile).entries)).toEqual([`clap:${m.fileOf(A)}`]);
    expect(summary?.qualified, said).toBe(1);
    // a scan afterwards takes B and finds A recorded as it is
    const scan = await runSync(m.settings().settings, { qualificationStore: store(), env: m.env, log: () => {} });
    expect([scan?.qualified, scan?.skipped]).toEqual([1, 1]);
    expect(m.pins().sort()).toEqual([target, `clap:${m.fileOf(B)}#${B}`].sort());
  });

  it("a target on no search path measures nothing and says so", async () => {
    const m = stands();
    const { settings } = m.settings();
    const lines: string[] = [];
    const summary = await runSync(settings, { plugin: "clap:/nowhere/x.clap#x", qualificationStore: store(), env: m.env, log: (l) => lines.push(l) });
    expect(summary?.pluginAbsent).toBe("clap:/nowhere/x.clap#x");
    expect(m.measuredFiles()).toEqual([]);
    expect(m.pins()).toEqual([]);
    expect(lines.join("\n")).toContain("clap:/nowhere/x.clap#x: no plugin on the search path is this target; nothing was measured");
  });

  it("run as non-root (no --system) writes no system path", () => {
    const sp = splitPathFlags(["--config", "/dev/null", "--plugin", "urn:x", "--clap-path", "/c", "--lv2-path", "/l"]);
    const args = parseSyncArgs(sp.argv);
    if (!args.ok) throw new Error(args.error);
    const r = resolveSyncSettings(new Map(), args.args, { XDG_STATE_HOME: "" }, "/home/u", undefined, undefined, searchPathOf(sp.lv2, sp.clap));
    if (!r.ok) throw new Error(r.error);
    expect(r.settings.system).toBe(false);
    for (const p of [r.settings.stateFile, r.settings.pinFile, r.settings.descriptorDir]) expect(p.startsWith("/home/u/"), p).toBe(true);
  });

  it("--under-load marks the run measured-under-load: no figure reaches the store, and the next idle scan measures it again whole", async () => {
    const m = stands();
    const target = `clap:${m.fileOf(A)}#${A}`;
    const { settings, args } = m.settings(["--plugin", target, "--under-load"]);
    expect(args.underLoad).toBe(true);
    const lines: string[] = [];
    await runSync(settings, { plugin: args.plugin, underLoad: true, qualificationStore: store(), env: m.env, log: (l) => lines.push(l) });
    const said = lines.join("\n");
    expect(readSyncState(settings.stateFile).entries[`clap:${m.fileOf(A)}`]?.runCondition, said).toBe(MEASURED_UNDER_LOAD);
    // its verdict is used (the pin); its cost is unknown to the planner (no record of it in the store)
    expect(m.pins(), said).toEqual([target]);
    expect(fake.user(), said).toEqual([]);
    // the next scan with the engine idle replaces it whole
    const scan = await runSync(m.settings().settings, { qualificationStore: store(), env: m.env, log: () => {} });
    expect(scan?.qualified).toBe(2);
    expect(readSyncState(settings.stateFile).entries[`clap:${m.fileOf(A)}`]?.runCondition).toBeUndefined();
    expect(fake.user().map((r) => r.uri).sort()).toEqual([A, B]);
  });

  it("--under-load goes only with --plugin, and --plugin with no other pass", () => {
    expect(parseSyncArgs(["--under-load"])).toEqual({ ok: false, error: "--under-load marks plugin-hostd's ask: it goes with --plugin only" });
    expect(parseSyncArgs(["--plugin", "urn:x", "--rejudge"]).ok).toBe(false);
    expect(parseSyncArgs(["--plugin"])).toEqual({ ok: false, error: "--plugin needs a value" });
  });

  it("measured-under-load is the qualify domain's run condition, the word the record carries", () => {
    const doc = JSON.parse(readFileSync(join(PKG, "contract.d", "qualify", "qualify.json"), "utf8")) as { components: { schemas: Record<string, { "x-kind": string; oneOf: { const: string }[] }> } };
    const item = doc.components.schemas["QUALIFY_RUN_CONDITIONS"];
    expect(item?.["x-kind"]).toBe("words");
    expect(item?.oneOf.map((w) => w.const)).toEqual([MEASURED_UNDER_LOAD]);
    expect(MEASURED_UNDER_LOAD).toBe("measured-under-load");
  });
});
