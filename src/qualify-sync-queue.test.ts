// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The re-qualify queue (#204) and a record the store's writer refuses (#205), over a fixture machine: a CLAP directory of
 * two `.clap` files of plain bytes against the store's stand-in. `plate.clap` has a record of its bytes in the base;
 * `hall.clap` has one of an earlier build, so its bytes changed. The queue names what a run would measure and why, and
 * writes nothing; a sync with one record the writer refuses still pins every plugin.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { FIXTURE_CLAP_ID, storedFixture, writeFakeClap } from "./distributed-records.support.js";
import { QualificationStore, type StoredRecord } from "./qualification-store.js";
import { parseSyncArgs, queueText, requalifyQueue, resolveSyncSettings, runSync, type SyncSettings } from "./qualify-sync.js";
import { splitPathFlags } from "./hostd-search-path.support.js";
import { fakeStore, type FakeStore } from "./store-fake.support.js";
import type { StoreRun } from "./qualification-store.js";

const scratch = mkdtempSync(join(tmpdir(), "queue-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CLASS = "test-class";

/** A machine: `plate.clap` and `hall.clap` in its CLAP directory, an empty LV2 one, the state under `state/`. */
function machine(name: string, flags: readonly string[] = []): { root: string; plate: string; hall: string; settings: SyncSettings } {
  const root = join(scratch, name);
  const plate = join(root, "clap", "plate.clap");
  const hall = join(root, "clap", "hall.clap");
  writeFakeClap(plate);
  writeFakeClap(hall, "the hall build of today\n");
  mkdirSync(join(root, "lv2"), { recursive: true });
  const sp = splitPathFlags([
    "--clap-path", join(root, "clap"), "--lv2-path", join(root, "lv2"), "--lv2-extra", "",
    "--descriptor-dir", join(root, "state", "descriptors"), "--state-file", join(root, "state", "sync.json"),
    "--pin-file", join(root, "state", "qualified.pins"), "--hostd-port", "0", "--budget-s", "5", "--host-class", CLASS,
    ...flags,
  ]);
  const args = parseSyncArgs(sp.argv);
  if (!args.ok) throw new Error(args.error);
  const r = resolveSyncSettings(new Map(), args.args, {}, root, undefined, undefined, sp.run);
  if (!r.ok) throw new Error(r.error);
  return { root, plate, hall, settings: r.settings };
}

/** The base of every case: plate's record of its bytes, and hall's of an earlier build (written, recorded, rewritten). */
function base(m: { root: string; plate: string; hall: string }): StoredRecord[] {
  const earlier = join(m.root, "earlier", "hall.clap");
  writeFakeClap(earlier, "the hall build of last month\n");
  return [storedFixture(m.plate), storedFixture(earlier)];
}

const hostdStandIn = (uri: string) => {
  const path = uri.replace(/^clap:/, "").replace(/#.*$/, "");
  return { status: 0, stdout: `root ${dirname(path)}\nfile ${basename(path)}\n`, stderr: "" };
};

const queueOf = (m: { settings: SyncSettings }, fake: FakeStore) => requalifyQueue(m.settings, { env: {}, qualificationStore: new QualificationStore("user", { run: fake.run }), pinFilesRun: hostdStandIn });

const stripLatency = (m: any): any => {
  const kept = (m.unmeasured ?? []).filter((u: { dimension: string }) => u.dimension !== "latency");
  return { ...m, grid: m.grid.map(({ latency: _latency, ...p }: Record<string, unknown>) => p), ...(kept.length === 0 ? {} : { unmeasured: kept }) };
};

describe("plugin-qualify-sync --queue (#204)", () => {
  it("lists the plugin whose bytes changed, with its reason, and not the one its record still answers; it writes nothing", () => {
    const m = machine("changed");
    const fake = fakeStore({ base: base(m) });
    const q = queueOf(m, fake);
    expect(q.installed).toBe(2);
    expect(q.queued.map((x) => [x.reason, basename(x.key)])).toEqual([["no-record", "hall.clap"]]);
    expect(q.queued[0]!.detail).toMatch(/binary differs/);
    expect(queueText(q.queued)).toMatch(/^no-record\t\S*hall\.clap\t/);
    // nothing measured, nothing written: no state, no pin, no record, no writer call
    expect(readdirSync(m.root)).not.toContain("state");
    expect(fake.user()).toEqual([]);
    expect(fake.calls.filter((c) => c.startsWith("write "))).toEqual([]);
  });

  it("a cell this machine runs that no record holds queues every plugin, the recorded one as cell-unmeasured", () => {
    const m = machine("new-cell", ["--grid", "48000/128,192000/64"]);
    const fake = fakeStore({ base: base(m) });
    const q = queueOf(m, fake);
    expect(q.queued.map((x) => [x.reason, basename(x.key)]).sort()).toEqual([["cell-unmeasured", "plate.clap"], ["no-record", "hall.clap"]]);
    expect(q.queued.find((x) => x.key.endsWith("plate.clap"))!.detail).toMatch(/measured at .*48000\/128/);
  });

  it("a record from before today's latency pass is queued as rules-newer", () => {
    const m = machine("rules");
    const [plate, hall] = base(m);
    const fake = fakeStore({ base: [{ ...plate!, record: { ...plate!.record, measurements: stripLatency(plate!.record.measurements) } }, hall!] });
    const q = queueOf(m, fake);
    expect(q.queued.map((x) => [x.reason, basename(x.key)]).sort()).toEqual([["no-record", "hall.clap"], ["rules-newer", "plate.clap"]]);
  });

  it("another host class has no record at all: both plugins are queued as no-record", () => {
    const m = machine("other-class", ["--host-class", "another"]);
    const fake = fakeStore({ base: base(m) });
    expect(queueOf(m, fake).queued.map((x) => x.reason)).toEqual(["no-record", "no-record"]);
  });

  it("agrees with the sync: what the queue leaves out is taken from the records, and after the sync it is not queued again", async () => {
    const m = machine("agrees");
    const fake = fakeStore({ base: base(m) });
    const before = queueOf(m, fake).queued.map((x) => x.key);
    const summary = await runSync(m.settings, { env: {}, log: () => {}, qualificationStore: new QualificationStore("user", { run: fake.run }), pinFilesRun: hostdStandIn });
    expect(summary!.distributed).toBe(1);
    expect(fake.user().map((u) => u.record.binary.path)).toEqual(["plate.clap"]);
    expect(before.map((k) => basename(k))).toEqual(["hall.clap"]);
    expect(queueOf(m, fake).queued.some((x) => x.key.endsWith("plate.clap"))).toBe(false);
  });

  it("--queue goes with no option that measures", () => {
    expect(parseSyncArgs(["--queue"])).toMatchObject({ ok: true, args: { queue: true } });
    for (const other of [["--force"], ["--rejudge"], ["--plugin", "x"], ["--refresh-pins"], ["--memory-only"]]) expect(parseSyncArgs(["--queue", ...other]).ok).toBe(false);
  });
});

describe("a record the store's writer refuses (#205)", () => {
  it("is named and skipped: the run goes on, and every plugin is pinned, the refused one from the base", async () => {
    const m = machine("refused");
    const plate = storedFixture(m.plate);
    const hall = storedFixture(m.hall);
    const fake = fakeStore({ base: [plate, hall] });
    // the writer of an older word list refuses hall's record, as the Pi's did (word-unknown)
    const run: StoreRun = (tool, args, input, env) => {
      if (tool === "write" && args[0] === "put" && JSON.parse(input ?? "{}").binary?.path === "hall.clap")
        return { status: 1, stdout: "", stderr: "plugin-qualification-db-write put: refused: word-unknown: record: verdicts[3].reasons[2].params.unmeasuredReason\n" };
      return fake.run(tool, args, input, env);
    };
    const lines: string[] = [];
    const summary = await runSync(m.settings, { env: {}, log: (l) => lines.push(l), qualificationStore: new QualificationStore("user", { run }), pinFilesRun: hostdStandIn });
    expect(summary!.refusedRecords, lines.join("\n")).toHaveLength(1);
    expect(summary!.refusedRecords![0]).toContain(FIXTURE_CLAP_ID);
    expect(lines.some((l) => /the store's writer refused its record \(word-unknown\).*skipped, the run goes on/.test(l))).toBe(true);
    expect(summary!.distributed).toBe(2);
    expect(fake.user().map((u) => u.record.binary.path)).toEqual(["plate.clap"]);
    const pins = readFileSync(m.settings.pinFile, "utf8").split("\n").filter((l) => l.startsWith("pin_set"));
    expect(pins.map((l) => (/hall\.clap/.test(l) ? "hall" : /plate\.clap/.test(l) ? "plate" : l)).sort()).toEqual(["hall", "plate"]);
  });
});
