// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The sync fills plugin-db's store (#73): after a run, every plugin it recorded with a whole pin is written to plugin-db
 * as plugin-db's records documentation describes it, the pinned layer (`plugin-db pin`) and then the judged layer
 * (`plugin-db put <address> judged --writer plugin-qualify`), so `plugin-db --system query` answers for it. Until this,
 * the sync wrote pins and records only and a device's store stayed empty: every reader's answer was none.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { OMX_CLAP_HOST_PROFILE, OPENMIXER_CONSOLE_PROFILE } from "./host-profiles.js";
import { judgementRules } from "./judgement-line.js";
import type { PluginDbRun } from "./plugin-db-cli.js";
import { storeJudgedLayers } from "./plugin-db-store.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { fixtureJson } from "./probe-output-fixtures.js";
import { readProbeOutput } from "./probe-output.js";
import { buildQualificationRecord, type QualificationRecord } from "./qualification-record.js";
import type { SyncPlugin, SyncState } from "./qualify-sync.js";
import { QualificationStore, type ShadowKey } from "./qualification-store.js";
import { fakeStore } from "./store-fake.support.js";

const dir = mkdtempSync(join(tmpdir(), "pq-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function recordOf(patch: (d: Record<string, any>) => void = () => {}): QualificationRecord {
  const d = fixtureJson("success-msi");
  patch(d);
  const r = readProbeOutput(JSON.stringify(d));
  if (!r.ok) throw new Error(r.problem);
  return buildQualificationRecord(judgeProbeOutput(r.output, [OPENMIXER_CONSOLE_PROFILE, OMX_CLAP_HOST_PROFILE]), { file: "x.probe.json", sha256: "0".repeat(64), bytes: 1 });
}

const records = new QualificationStore("user", { run: fakeStore({ validate: false }).run });
let n = 0;
/** The record put in the qualification store, under a key of its own; the store pass reads it from there. */
function written(record: QualificationRecord | Record<string, unknown>): ShadowKey {
  const r = record as QualificationRecord;
  const key: ShadowKey = { sha256: r.binary?.sha256 ?? "0".repeat(64), format: r.plugin?.format ?? "lv2", uri: r.plugin?.id ?? "urn:x", offer: `o${String(n++)}`, hostClass: "x86-64" };
  records.put(key, r);
  return key;
}

const FILES = [
  { path: "b.ttl", sha256: "2".repeat(64) },
  { path: "a.so", sha256: "1".repeat(64) },
];
const LAYOUT = { scheme: "omx-layout/1", sha256: "c".repeat(64) };

function plugin(record: ShadowKey | undefined, withPin = true, uri = "urn:x"): SyncPlugin {
  return {
    uri,
    outcome: "qualified",
    ...(withPin ? { pin: { uri, integrity: { files: FILES, layout: LAYOUT }, verdict: "in-process" } } : {}),
    ...(record === undefined ? {} : { record }),
  } as SyncPlugin;
}

function stateOf(...plugins: SyncPlugin[]): SyncState {
  return { schema: "plugin-qualify.sync-state/2", entries: { "/x": { format: "lv2", root: "/x", files: [], plugins, qualifiedAt: "t", seconds: 0 } } } as unknown as SyncState;
}

/** A plugin-db that answers 0 and remembers every call; `answer` makes one call fail. */
function fakeDb(answer: (args: readonly string[]) => { status: number; stderr?: string; missing?: boolean } = () => ({ status: 0 })) {
  const calls: { args: readonly string[]; input: string | undefined }[] = [];
  const run: PluginDbRun = (args, input) => {
    calls.push({ args, input });
    const a = answer(args);
    return { status: a.status, stdout: "", stderr: a.stderr ?? "", ...(a.missing ? { missing: true } : {}) };
  };
  return { calls, run };
}

const LV2_PATH = "/usr/lib/lv2:/zynthian/zynthian-plugins/lv2";
const base = { machineClass: "rpi5", system: true, lv2Path: LV2_PATH, env: {}, records };

describe("the sync's store pass", () => {
  it("a recorded plugin with a pin is pinned, then its judged layer put, in the service's store", () => {
    const rec = recordOf();
    const db = fakeDb();
    const out = storeJudgedLayers(stateOf(plugin(written(rec))), { ...base, run: db.run });
    expect(out.stored).toBe(1);
    const address = `${rec.plugin.format}:${rec.plugin.id}`;
    expect(db.calls.map((c) => c.args)).toEqual([
      ["--system", "pin", address, "--lv2-path", LV2_PATH, "--layout", `${LAYOUT.scheme}:${LAYOUT.sha256}`],
      ["--system", "put", address, "judged", "--writer", "plugin-qualify"],
    ]);
    const body = JSON.parse(db.calls[1]!.input!);
    expect(body.machineClass).toBe("rpi5");
    expect(body.rules).toBe(rec.rules);
    expect(out.lines).toEqual([`plugin-db: 1 plugins stored in the system store, 0 already there, 0 without a pin, 0 without a judged layer, 0 refused`]);
  });

  it("a CLAP plugin is pinned by the .clap file its pin's uri names", () => {
    const db = fakeDb();
    storeJudgedLayers(stateOf(plugin(written(recordOf()), true, "clap:/usr/lib/clap/omx-eq8.clap#org.openmixer.eq8")), { ...base, run: db.run });
    expect(db.calls[0]!.args.slice(2, 5)).toEqual([expect.any(String), "--file", "/usr/lib/clap/omx-eq8.clap"]);
  });

  it("a record that states no rules is judged by its set's plugin-qualify (provenance), else by this one", () => {
    const { rules: _drop, ...noRules } = recordOf();
    const fromSet = { ...noRules, provenance: { packages: { "plugin-qualify": "0.19.0" } } };
    const db = fakeDb();
    storeJudgedLayers(stateOf(plugin(written(fromSet)), plugin(written(noRules))), { ...base, run: db.run });
    const puts = db.calls.filter((c) => c.args[1] === "put").map((c) => JSON.parse(c.input!).rules);
    expect(puts).toEqual([judgementRules("0.19.0"), judgementRules()]);
  });

  it("a plugin without a pin (refused, not offered) is not stored, and is counted", () => {
    const db = fakeDb();
    const out = storeJudgedLayers(stateOf(plugin(written(recordOf()), false)), { ...base, run: db.run });
    expect(db.calls).toEqual([]);
    expect(out).toMatchObject({ stored: 0, noPin: 1 });
  });

  it("a record with no judged layer is counted with its reason, and nothing is written for it", () => {
    const rec = { ...recordOf(), verdicts: [] };
    const db = fakeDb();
    const out = storeJudgedLayers(stateOf(plugin(written(rec))), { ...base, run: db.run });
    expect(db.calls).toEqual([]);
    expect(out.noLayer).toBe(1);
    expect(out.lines.join("\n")).toMatch(/no judged layer: no verdict under/);
  });

  it("a pin plugin-db refuses: no put for that plugin, the refusal named, the next plugin still stored", () => {
    let first = true;
    const db = fakeDb((args) => {
      if (args[1] === "pin" && first) {
        first = false;
        return { status: 1, stderr: "plugin-db: the layout does not read" };
      }
      return { status: 0 };
    });
    const out = storeJudgedLayers(stateOf(plugin(written(recordOf())), plugin(written(recordOf()))), { ...base, run: db.run });
    expect(db.calls.map((c) => c.args[1])).toEqual(["pin", "pin", "put"]);
    expect(out).toMatchObject({ stored: 1, refused: 1 });
    expect(out.lines.join("\n")).toMatch(/plugin-db: the layout does not read/);
  });

  it("no plugin-db installed: one line, and nothing more is tried", () => {
    const db = fakeDb(() => ({ status: -1, missing: true }));
    const out = storeJudgedLayers(stateOf(plugin(written(recordOf())), plugin(written(recordOf()))), { ...base, run: db.run });
    expect(db.calls).toHaveLength(1);
    expect(out.stored).toBe(0);
    expect(out.lines).toEqual(["plugin-db is not installed: the store is plugin-db's to pin; no plugin was stored"]);
  });

  it("no machine class known here: nothing is written, and the line says why", () => {
    const db = fakeDb();
    const out = storeJudgedLayers(stateOf(plugin(written(recordOf()))), { ...base, machineClass: undefined, run: db.run });
    expect(db.calls).toEqual([]);
    expect(out.lines).toEqual(["plugin-db: this machine's class is not known (host_class), so no plugin was stored"]);
  });

  it("the user's store when the sync is not the system service: no --system", () => {
    const db = fakeDb();
    storeJudgedLayers(stateOf(plugin(written(recordOf()))), { ...base, system: false, run: db.run });
    expect(db.calls.every((c) => !c.args.includes("--system"))).toBe(true);
  });
});

const realPluginDb = spawnSync("plugin-db", ["--help"], { encoding: "utf8" });
const haveRealPluginDb = realPluginDb.error === undefined && /pin <address>/.test(`${realPluginDb.stdout}${realPluginDb.stderr}`);

describe("the store stamp: an unchanged plugin is not written again", () => {
  const stampOf = () => join(dir, `stamp${String(n++)}.json`);

  it("a second run over the same state calls plugin-db for nothing, and says the plugins are already stored", () => {
    const stampFile = stampOf();
    const state = stateOf(plugin(written(recordOf())));
    storeJudgedLayers(state, { ...base, stampFile, run: fakeDb().run });
    const db = fakeDb();
    const out = storeJudgedLayers(state, { ...base, stampFile, run: db.run });
    expect(db.calls).toEqual([]);
    expect(out).toMatchObject({ stored: 0, already: 1 });
    expect(out.lines.at(-1)).toMatch(/0 plugins stored in the system store, 1 already there,/);
  });

  it("other bytes (the files of the pin), another layout or another body: written again", () => {
    const stampFile = stampOf();
    const rec = written(recordOf());
    storeJudgedLayers(stateOf(plugin(rec)), { ...base, stampFile, run: fakeDb().run });
    const moved = plugin(rec);
    const other = { ...moved, pin: { ...moved.pin!, integrity: { files: [{ path: "a.so", sha256: "9".repeat(64) }], layout: LAYOUT } } } as SyncPlugin;
    const db = fakeDb();
    expect(storeJudgedLayers(stateOf(other), { ...base, stampFile, run: db.run }).stored).toBe(1);
    expect(db.calls).toHaveLength(2);
  });

  it("a write plugin-db refused is not stamped: the next run tries it again", () => {
    const stampFile = stampOf();
    const state = stateOf(plugin(written(recordOf())));
    storeJudgedLayers(state, { ...base, stampFile, run: fakeDb((a) => ({ status: a[1] === "put" ? 1 : 0 })).run });
    const db = fakeDb();
    expect(storeJudgedLayers(state, { ...base, stampFile, run: db.run }).stored).toBe(1);
  });

  it("a stamp that does not read is started over, never trusted", () => {
    const stampFile = stampOf();
    writeFileSync(stampFile, "{ not json");
    const db = fakeDb();
    expect(storeJudgedLayers(stateOf(plugin(written(recordOf()))), { ...base, stampFile, run: db.run }).stored).toBe(1);
    expect(JSON.parse(readFileSync(stampFile, "utf8")).schema).toBe("plugin-qualify.store-stamp/1");
  });
});

describe.skipIf(!haveRealPluginDb)("against the plugin-db installed here, in a store of its own", () => {
  it("plugin-db takes the pin and the judged layer, and shows the entry with its files and layout", () => {
    const home = join(dir, "home");
    const clap = join(dir, "clap");
    mkdirSync(home);
    mkdirSync(clap);
    writeFileSync(join(clap, "x.clap"), "not a real plugin, only bytes to pin");
    const rec = recordOf();
    const uri = `clap:${join(clap, "x.clap")}#${rec.plugin.id}`;
    const env = { ...process.env, HOME: home, PLUGIN_DB_STORE: undefined };
    const out = storeJudgedLayers(stateOf(plugin(written(rec), true, uri)), { machineClass: "x86-64", system: false, lv2Path: "", env, records });
    expect(out.lines.at(-1)).toMatch(/^plugin-db: 1 plugins stored in the store, 0 already there, 0 without a pin, 0 without a judged layer, 0 refused$/);
    const show = spawnSync("plugin-db", ["show", `${rec.plugin.format}:${rec.plugin.id}`], { encoding: "utf8", env });
    expect(show.status).toBe(0);
    expect(show.stdout).toMatch(/^files +same$/m);
    expect(show.stdout).toMatch(/^layout +same$/m);
  });
});

describe("the sync runs the store pass", () => {
  it("runSync stores after it writes the pin file, only when its caller asks (options.store), with the host class", () => {
    const src = readFileSync(new URL("./qualify-sync.ts", import.meta.url), "utf8");
    const run = src.slice(src.indexOf("export async function runSync("));
    const pins = run.indexOf("writeFileWhole(settings.pinFile, after)");
    const store = run.indexOf("storeJudgedLayers(state,");
    expect(pins).toBeGreaterThan(0);
    expect(store).toBeGreaterThan(pins);
    expect(run.slice(store - 80, store + 200)).toMatch(/options\.store !== undefined/);
    expect(run.slice(store, store + 300)).toMatch(/machineClass: settings\.hostClass/);
    expect(run.slice(store, store + 300)).toMatch(/stampFile: `\$\{settings\.stateFile\}\.stored`/);
  });

  it("plugin-qualify-sync asks for the store pass, in the system store under --system", () => {
    const bin = readFileSync(new URL("../bin/plugin-qualify-sync.mjs", import.meta.url), "utf8");
    expect(bin).toMatch(/store: \{ system: parsed\.args\.system \}/);
  });
});
