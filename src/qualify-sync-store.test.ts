// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * What `plugin-qualify-sync` does on the qualification store (the store spec's section 6.1, cases C5 to C9): the re-judge,
 * the prune and the counts read the store and no directory, the removed settings are refused, and the state of the older
 * schema is moved aside. The store is the stand-in of `store-fake.support.ts`.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { QualificationStore, shadowKeyOf, type StoredRecord } from "./qualification-store.js";
import { readProbeOutput } from "./probe-output.js";
import { CLAP_RT, FIXTURES, LV2_CLEAN, LV2_RT, stored } from "./qualify-rejudge.support.js";
import { rejudgeState } from "./qualify-rejudge.js";
import {
  SYNC_STATE_SCHEMA,
  parseSyncArgs,
  parseSyncConf,
  pluginCounts,
  pluginCountsLine,
  pruneStale,
  readSyncState,
  resolveSyncSettings,
  type SyncContext,
  type SyncState,
} from "./qualify-sync.js";
import { searchPathOf } from "./hostd-search-path.support.js";
import { fakeStore } from "./store-fake.support.js";
import { storeExport } from "./store-export.support.js";

const scratch = mkdtempSync(join(tmpdir(), "qualify-sync-store-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function exported(stem: string, omit?: string): StoredRecord {
  const probe = readProbeOutput(readFileSync(join(FIXTURES, `${stem}.probe.json`), "utf8"));
  if (!probe.ok) throw new Error(probe.problem);
  return storeExport(stored(stem), probe.output, omit);
}

function settingsOf(extra: string[] = [], conf = new Map<string, string>()) {
  const args = parseSyncArgs(extra);
  if (!args.ok) throw new Error(args.error);
  const r = resolveSyncSettings(conf, args.args, {}, scratch, undefined, () => "x86_64", searchPathOf([join(scratch, "none")], [join(scratch, "none")]));
  if (!r.ok) throw new Error(r.error);
  return r.settings;
}

const keyed = (r: StoredRecord) => shadowKeyOf(r);

/** A state naming each record by its shadow key, as a plugin of an entry whose files are still the bytes it was qualified from. */
function stateOf(records: readonly StoredRecord[], rootOf: (r: StoredRecord) => string): SyncState {
  const entries: SyncState["entries"] = {};
  for (const r of records) {
    entries[`${r.format}:${r.uri}`] = { format: r.format as "clap" | "lv2", root: rootOf(r), files: [], qualifiedAt: "2026-11-01T00:00:00.000Z", seconds: 0, plugins: [{ uri: r.uri, outcome: "qualified", record: keyed(r) }] };
  }
  return { schema: SYNC_STATE_SCHEMA, entries };
}

describe("C9: the old settings and state are gone", () => {
  it.each(["qualification_dir", "distributed_dir"])("%s is refused as an unknown setting, in the file and as a flag", (key) => {
    const conf = parseSyncConf(`${key} /somewhere\n`);
    expect(conf.ok).toBe(false);
    if (!conf.ok) expect(conf.error).toMatch(new RegExp(key));
    const args = parseSyncArgs([`--${key.replace(/_/g, "-")}`, "/somewhere"]);
    expect(args.ok).toBe(false);
  });

  it("the settings hold no directory of records", () => {
    const s = settingsOf() as unknown as Record<string, unknown>;
    expect(Object.keys(s).filter((k) => /qualificationDir|distributedDirs/.test(k))).toEqual([]);
  });

  it("a state of plugin-qualify.sync-state/1 is moved aside and every plugin is qualified again", () => {
    const dir = mkdtempSync(join(scratch, "state-"));
    const file = join(dir, "state.json");
    writeFileSync(file, JSON.stringify({ schema: "plugin-qualify.sync-state/1", entries: { "lv2:urn:x": { format: "lv2", root: "/b", files: [], plugins: [], qualifiedAt: "x", seconds: 0 } } }));
    const log: string[] = [];
    expect(readSyncState(file, (l) => log.push(l)).entries).toEqual({});
    expect(existsSync(`${file}.unreadable`)).toBe(true);
    expect(SYNC_STATE_SCHEMA).toBe("plugin-qualify.sync-state/2");
  });
});

describe("C5: no directory is read", () => {
  /** A directory of valid old files the sync must not look at. */
  function oldFiles(): string {
    const dir = mkdtempSync(join(scratch, "old-"));
    cpSync(FIXTURES, dir, { recursive: true });
    return dir;
  }

  it("with the store absent the re-judge refuses by qualification-db.absent and takes nothing from the files", () => {
    const old = oldFiles();
    const fake = fakeStore({ absent: true });
    const ctx: SyncContext = { settings: settingsOf(), env: {}, log: () => {}, store: new QualificationStore("user", { run: fake.run }) };
    expect(() => rejudgeState(ctx, { schema: SYNC_STATE_SCHEMA, entries: {} })).toThrow(/qualification-db\.absent/);
    expect(readdirSync(old).length).toBeGreaterThan(0);
  });

  it("the re-judge, the prune and the counts answer from the store while a directory of valid old files sits beside", () => {
    oldFiles();
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const a = exported(LV2_CLEAN);
    store.put(keyed(a), a.record);
    const ctx: SyncContext = { settings: settingsOf(), env: {}, log: () => {}, store };
    rejudgeState(ctx, stateOf([a], () => "/nowhere"));
    pruneStale(settingsOf(), store, stateOf([a], () => "/nowhere"), { schema: SYNC_STATE_SCHEMA, entries: {} });
    expect(pluginCountsLine(pluginCounts(store))).toMatch(/^plugins \d/);
    expect(fake.calls.every((c) => /^(read|write) /.test(c))).toBe(true);
  });
});

describe("C6: qualify-rejudge on the store", () => {
  it("judges the user layer's records again with no probe output on disk, puts only the records that changed, leaves the base as it was", () => {
    const stale = exported(LV2_RT);
    const staleRecord = JSON.parse(JSON.stringify(stale.record));
    staleRecord.verdicts[0].rating = "unknown";
    staleRecord.verdicts[0].measured = false;
    const fresh = exported(CLAP_RT);
    const base = exported(LV2_CLEAN);
    const fake = fakeStore({ base: [{ ...base, layer: "base" }] });
    const store = new QualificationStore("user", { run: fake.run });
    store.put(keyed(stale), staleRecord);
    store.put(keyed(fresh), fresh.record);
    const baseBefore = JSON.stringify(fake.base);
    const ctx: SyncContext = { settings: settingsOf(), env: {}, log: () => {}, store };
    const first = rejudgeState(ctx, stateOf([stale, fresh], () => "/nowhere"), () => "2026-11-19T00:00:00.000Z");
    expect(first.changed).toBeGreaterThanOrEqual(1);
    const writes = fake.calls.filter((c) => c.startsWith("write put")).length;
    const again = rejudgeState(ctx, first.state, () => "2026-11-19T01:00:00.000Z");
    expect(again.changed).toBe(0);
    expect(fake.calls.filter((c) => c.startsWith("write put")).length).toBe(writes);
    expect(JSON.stringify(fake.base)).toBe(baseBefore);
  });

  it("owes figures-unreadable for a CLAP record whose rows lack host_extensions, and does not judge it again", () => {
    const clap = exported(CLAP_RT, "record_extension");
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    store.put(keyed(clap), clap.record);
    const ctx: SyncContext = { settings: settingsOf(), env: {}, log: () => {}, store };
    const r = rejudgeState(ctx, stateOf([clap], () => "/nowhere"));
    expect(r.owing.flatMap((o) => o.owes.map((x) => x.code))).toContain("qualify.sync.figures-unreadable");
    expect(fake.calls.filter((c) => c.startsWith("write put")).length).toBe(1);
  });
});

describe("C7: pruneStale on the store", () => {
  const gone = exported(LV2_CLEAN);
  const kept = exported(LV2_RT);
  const otherBytes = { ...exported(LV2_RT), sha256: "d".repeat(64), record: { ...exported(LV2_RT).record, binary: { ...exported(LV2_RT).record.binary, sha256: "d".repeat(64), files: [{ path: "nrepel.so", sha256: "d".repeat(64) }] } } } as StoredRecord;
  const baseOnly = { ...exported(CLAP_RT), layer: "base" as const };

  function setup() {
    const fake = fakeStore({ base: [baseOnly] });
    const store = new QualificationStore("user", { run: fake.run });
    for (const r of [gone, kept, otherBytes]) store.put(keyed(r), r.record);
    const dd = mkdtempSync(join(scratch, "desc-"));
    return { fake, store, dd };
  }

  it("a plugin gone from the state, and a kept plugin with other bytes, each lose their user record by delete; a kept record and the base stay", () => {
    const { fake, store, dd } = setup();
    const before = stateOf([gone, kept], () => "/b");
    const after = stateOf([kept], () => "/b");
    const removed = pruneStale({ ...settingsOf(), descriptorDir: dd }, store, before, after);
    const left = fake.user().map((r) => `${r.uri} ${r.sha256.slice(0, 4)}`).sort();
    expect(left).toEqual([`${kept.uri} ${kept.sha256.slice(0, 4)}`]);
    expect(fake.base).toHaveLength(1);
    expect(fake.calls.filter((c) => c.startsWith("write delete")).length).toBe(2);
    expect(removed.length).toBeGreaterThanOrEqual(2);
  });

  it("a record another plugin of the state still names (two copies of one binary) is kept", () => {
    const { fake, store, dd } = setup();
    const before = stateOf([gone, kept], () => "/b");
    const after = stateOf([kept], () => "/b");
    after.entries["lv2:copy"] = { ...after.entries[`lv2:${kept.uri}`]!, plugins: [{ uri: "copy", outcome: "qualified", record: keyed(gone) }] };
    pruneStale({ ...settingsOf(), descriptorDir: dd }, store, before, after);
    expect(fake.user().map((r) => r.uri)).toContain(gone.uri);
  });

  it("the descriptor files of a gone plugin go as they do today", () => {
    const { store, dd } = setup();
    const id = gone.uri.replace(/[^A-Za-z0-9._-]/g, "_");
    writeFileSync(join(dd, `${id}@unversioned-${gone.sha256.slice(0, 12)}.json`), "{}");
    writeFileSync(join(dd, "by-hand.json"), "{}");
    pruneStale({ ...settingsOf(), descriptorDir: dd }, store, stateOf([gone, kept], () => "/b"), stateOf([kept], () => "/b"));
    expect(readdirSync(dd)).toEqual(["by-hand.json"]);
  });
});

describe("C8: pluginCounts on the store", () => {
  it("the line equals the one the records give by hand, for the user layer; the base is not counted", () => {
    const a = exported(LV2_CLEAN);
    const b = exported(CLAP_RT);
    const base = { ...exported(LV2_RT), layer: "base" as const };
    const fake = fakeStore({ base: [base] });
    const store = new QualificationStore("user", { run: fake.run });
    for (const r of [a, b]) store.put(keyed(r), r.record);
    const offered = (r: StoredRecord) => r.record.tiers.offeredOn.length > 0;
    const by = (f: string, o?: boolean) => [a, b].filter((r) => r.format === f && (o === undefined || offered(r) === o)).length;
    const part = (o?: boolean): string => {
      const fs = ["clap", "lv2"].filter((f) => by(f, o) > 0);
      return `${String(fs.reduce((n, f) => n + by(f, o), 0))}${fs.length === 0 ? "" : ` (${fs.map((f) => `${f} ${String(by(f, o))}`).join(", ")})`}`;
    };
    expect(pluginCountsLine(pluginCounts(store))).toBe(`plugins ${part()}, offered ${part(true)}, not offered ${part(false)}`);
  });

  it("under --system it asks the system layer's own records", () => {
    const fake = fakeStore();
    pluginCounts(new QualificationStore("system", { run: fake.run }));
    expect(fake.calls[0]).toBe("read counts --scope system --layer user --json");
  });
});
