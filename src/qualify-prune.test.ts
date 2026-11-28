// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * What the sync leaves of a plugin that is gone (#168): its pin, qualification record, probe copy and descriptor are
 * removed, a running plugin-hostd is told with pin_clear, and what belongs to a plugin still there (or to no plugin
 * of the sync's) stays. Runs the real run over a machine with no plugin to qualify: nothing here needs the probe runner.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  SYNC_STATE_SCHEMA,
  digestFiles,
  discoverSyncItems,
  parseSyncArgs,
  pruneStale,
  resolveSyncSettings,
  runSync,
  type FileDigest,
  type SyncState,
} from "./qualify-sync.js";
import { statePinsText } from "./sync-pins.support.js";
import { searchPathOf, splitPathFlags } from "./hostd-search-path.support.js";
import { QualificationStore, keyId, type ShadowKey } from "./qualification-store.js";
import { fakeStore, type FakeStore } from "./store-fake.support.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "qualify-prune-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const GONE = "urn:test:gone";
const KEPT = "urn:plugin-qualify:fixture:lv2-rt-safe";
const safe = (uri: string): string => uri.replace(/[^A-Za-z0-9._-]/g, "_");
const stem = (uri: string, sha: string): string => `${safe(uri)}@1.0-${sha.repeat(12)}`;
/** A record as the unit tests of the prune need it: the key's parts, nothing else; the stand-in does not check it. */
const recordOf = (uri: string, sha: string, format = "lv2") => ({ plugin: { format, id: uri }, binary: { sha256: sha.repeat(64), path: "x", files: [] }, tiers: { offeredOn: [] }, measurements: { grid: [] }, verdicts: [] }) as never;
const keyOf = (uri: string, sha: string, offer = "default", format = "lv2"): ShadowKey => ({ sha256: sha.repeat(64), format, uri, offer, hostClass: "x86-64" });
const store = (fake: FakeStore): QualificationStore => new QualificationStore("user", { run: fake.run });
/** A machine whose state remembers a plugin that is gone (GONE) and one that is still installed (KEPT); their records are in the store. */
function machine(extraLv2Dir?: string) {
  const root = mkdtempSync(join(scratch, "m-"));
  const lv2 = join(root, "lv2");
  const bundle = join(lv2, "rt-safe.lv2");
  cpSync(join(PKG, "native", "fixtures", "rt-safe.lv2"), bundle, { recursive: true });
  writeFileSync(join(bundle, "gain.so"), "binary");
  const d = join(root, "descriptors");
  mkdirSync(d);
  const fake = fakeStore({ validate: false });
  const records = store(fake);
  const files: Record<string, string> = {};
  const keys: Record<string, ShadowKey> = {};
  for (const [uri, sha] of [[GONE, "b"], [KEPT, "a"]] as const) {
    files[uri] = stem(uri, sha);
    keys[uri] = keyOf(uri, sha);
    records.put(keys[uri], recordOf(uri, sha));
    writeFileSync(join(d, `${stem(uri, sha)}.json`), "{}");
  }
  records.put(keyOf("by-hand", "9"), recordOf("by-hand", "9")); // a record the CLI wrote, never the sync's
  const item = discoverSyncItems({ lv2Dirs: [lv2], clapDirs: [] }).items[0]!;
  const entry = (uri: string, root_: string, fileList: readonly FileDigest[]) => ({
    format: "lv2" as const, root: root_, files: fileList, qualifiedAt: "2026-10-28T00:00:00.000Z", seconds: 0,
    plugins: [{ uri, outcome: "qualified" as const, record: keys[uri]! }],
  });
  const state: SyncState = {
    schema: SYNC_STATE_SCHEMA,
    // the uninstalled bundle lived in a directory the run scans (#247: a run drops only what it looked for)
    entries: { [`lv2:${GONE}`]: entry(GONE, join(lv2, "gone.lv2"), []), [item.key]: entry(KEPT, item.root, digestFiles(item.root, item.files)!) },
  };
  writeFileSync(join(root, "state.json"), JSON.stringify(state));
  const run = async (lv2Dirs: string) => {
    const sp = splitPathFlags(["--lv2-path", lv2Dirs, "--lv2-extra", "", "--clap-path", join(root, "no-clap"), "--clap-extra", "",
      "--descriptor-dir", d, "--state-file", join(root, "state.json"), "--host-class", "x86-64"]);
    const args = parseSyncArgs(sp.argv);
    if (!args.ok) throw new Error(args.error);
    const r = resolveSyncSettings(new Map(), args.args, {}, root, undefined, undefined, sp.run);
    if (!r.ok) throw new Error(r.error);
    const log: string[] = [];
    const summary = await runSync(r.settings, { qualificationStore: store(fake), log: (l) => log.push(l), env: { ...process.env } });
    return { summary, log };
  };
  const held = () => fake.user().map((u) => `${u.uri} ${u.sha256.slice(0, 1)}`).sort();
  return { root, lv2, d, files, keys, fake, held, run };
}

describe("a run over a machine whose plugin was uninstalled", () => {
  it("removes its record and descriptor, keeps what is still there, and its state pins it no more", async () => {
    // plugin-hostd reads the pins from the store: the record's delete is what unpins it there, and nothing is sent
    const m = machine();
    const r = await m.run(m.lv2);
    expect(r.summary).toMatchObject({ qualified: 0, skipped: 1 });
    expect(m.held()).toEqual([`by-hand 9`, `${KEPT} a`].sort());
    expect(m.fake.calls.filter((c) => c.startsWith("write delete"))).toEqual([`write delete --scope user --sha256 ${"b".repeat(64)} --format lv2 --uri ${GONE} --offer default --host-class x86-64`]);
    expect(readdirSync(m.d)).toEqual([`${m.files[KEPT]}.json`]);
    expect(statePinsText(join(m.root, "state.json"))).not.toContain(GONE);
    expect(existsSync(join(m.root, "qualified.pins"))).toBe(false);
  });

  it("removes nothing when a bundle could not be read: a half-written one is no uninstall", async () => {
    const m = machine();
    mkdirSync(join(m.lv2, "broken.lv2", "manifest.ttl"), { recursive: true }); // a bundle whose manifest cannot be read
    const before = [m.held().length, readdirSync(m.d).length];
    const r = await m.run(m.lv2);
    expect(r.log.join("\n")).toContain("no record or descriptor is removed this run");
    expect([m.held().length, readdirSync(m.d).length]).toEqual(before);
    expect(existsSync(join(m.d, `${m.files[GONE]}.json`))).toBe(true);
  });
});

describe("pruneStale", () => {
  const entry = (record: ShadowKey, uri = "u", format: "lv2" | "clap" = "lv2") => ({ format, root: "/r", files: [], qualifiedAt: "", seconds: 0, plugins: [{ uri, outcome: "qualified" as const, record }] });

  it("keeps a record another plugin of the state still names, and removes the ones of a binary that changed", () => {
    const m = machine();
    const gone = m.keys[GONE]!;
    const before: SyncState = { schema: SYNC_STATE_SCHEMA, entries: { a: entry(gone), b: entry(gone) } };
    const records = store(m.fake);
    // two copies of one binary share a record: one copy removed, the other still names it
    expect(pruneStale({ descriptorDir: m.d }, records, before, { schema: SYNC_STATE_SCHEMA, entries: { a: before.entries["a"]! } })).toEqual([]);
    expect(m.held()).toContain(`${GONE} b`);
    // the binary changed (a new hash): the old key's record and descriptor go
    const upgraded: SyncState = { schema: SYNC_STATE_SCHEMA, entries: { a: entry(keyOf(GONE, "d")), b: entry(keyOf(GONE, "d")) } };
    const removed = pruneStale({ descriptorDir: m.d }, records, before, upgraded).map((f) => f.replace(m.root, ""));
    expect(removed.sort()).toEqual([`/descriptors/${m.files[GONE]}.json`, `${GONE} (default, ${"b".repeat(12)})`].sort());
    expect(m.held()).not.toContain(`${GONE} b`);
  });

  // #177: a CLAP record is keyed by the plugin's id and the binary's hash, while its descriptor carries the declared version
  const CLAP_ID = "org.freemixer.plugin-qualify.fixture.rt-safe";

  it("removes a CLAP plugin's descriptor by id and binary hash, though its stem names a different version suffix than the record's key does", () => {
    const m = machine();
    const hash = "d".repeat(12);
    const descriptorStemName = `${CLAP_ID}@1-${hash}`;
    const fake = fakeStore({ validate: false });
    const records = store(fake);
    const key = keyOf(CLAP_ID, "d", "default", "clap");
    records.put(key, recordOf(CLAP_ID, "d", "clap"));
    writeFileSync(join(m.d, `${descriptorStemName}.json`), "{}");
    const removed = pruneStale({ descriptorDir: m.d }, records, { schema: SYNC_STATE_SCHEMA, entries: { c: entry(key, `urn:clap:${CLAP_ID}`, "clap") } }, { schema: SYNC_STATE_SCHEMA, entries: {} }).map((f) => f.replace(m.root, ""));
    expect(removed.sort()).toEqual([`/descriptors/${descriptorStemName}.json`, `${CLAP_ID} (default, ${hash})`].sort());
    expect(fake.user()).toEqual([]);
  });

  it("keeps a descriptor whose id and binary hash the state still names, even though a record of it went stale", () => {
    const m = machine();
    const hash = "e".repeat(12);
    const keptStem = `${CLAP_ID}@1-${hash}`;
    const fake = fakeStore({ validate: false });
    const records = store(fake);
    const stale = keyOf(CLAP_ID, "e", "default", "clap");
    const kept = keyOf(CLAP_ID, "e", "custom", "clap");
    records.put(stale, recordOf(CLAP_ID, "e", "clap"));
    records.put(kept, recordOf(CLAP_ID, "e", "clap"));
    writeFileSync(join(m.d, `${keptStem}.json`), "{}");
    const removed = pruneStale({ descriptorDir: m.d }, records, { schema: SYNC_STATE_SCHEMA, entries: { c: entry(stale, "u", "clap") } }, { schema: SYNC_STATE_SCHEMA, entries: { c: entry(kept, "u", "clap") } }).map((f) => f.replace(m.root, ""));
    expect(removed).toEqual([`${CLAP_ID} (default, ${hash})`]);
    expect(existsSync(join(m.d, `${keptStem}.json`))).toBe(true);
    expect(fake.user().map((u) => keyId({ sha256: u.sha256, format: u.format, uri: u.uri, offer: u.offer, hostClass: u.host_class }))).toEqual([keyId(kept)]);
  });
});

describe("pruneStale over records the state never named (#198)", () => {
  it("removes every record of an installed id made from other bytes, whichever tier, and keeps the installed bytes' records and other ids", () => {
    const fake = fakeStore({ validate: false });
    const records = store(fake);
    const d = mkdtempSync(join(scratch, "d-"));
    const ID = "org.openmixer.chorus";
    const put = (uri: string, sha: string, offer: string) => records.put(keyOf(uri, sha, offer, "clap"), recordOf(uri, sha, "clap"));
    put(ID, "c", "custom");
    put(ID, "c", "default");
    put(ID, "e", "custom");
    put(ID, "e", "default");
    put("org.openmixer.flanger", "1", "default");
    const state: SyncState = {
      schema: SYNC_STATE_SCHEMA,
      entries: { clap: { format: "clap", root: "/x", files: [], qualifiedAt: "2026-10-28T00:00:00.000Z", seconds: 0, plugins: [{ uri: ID, outcome: "qualified", record: keyOf(ID, "e", "custom", "clap") }] } },
    };
    pruneStale({ descriptorDir: d }, records, state, state);
    expect(fake.user().map((u) => `${u.uri} ${u.sha256.slice(0, 1)} ${u.offer}`).sort()).toEqual([`${ID} e custom`, `${ID} e default`, "org.openmixer.flanger 1 default"].sort());
    // and the base is never touched, whatever its keys
    expect(fake.calls.every((c) => !c.includes("--layer base"))).toBe(true);
  });
});
