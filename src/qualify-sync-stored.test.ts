// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The sync takes a plugin from the store's records only when every file the record lists hashes, here, as it did where it
 * was measured (the pin). The sync runs whole over a CLAP directory of plain bytes against the store's stand-in; a record
 * that applies means the sweep never runs, so no prober is needed. A record that does not apply sends the plugin to the
 * sweep, which finds no plugin in the bytes: the tests read only that it was not taken from the store.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { FIXTURE_CLAP_ID, storedFixture, writeFakeClap } from "./distributed-records.support.js";
import { parsePinLine } from "./pins-file.js";
import { QualificationStore, shadowKeyOf, type StoredRecord } from "./qualification-store.js";
import { parseSyncArgs, resolveSyncSettings, runSync, summaryLine, type SyncSettings } from "./qualify-sync.js";
import { searchPathOf, splitPathFlags } from "./hostd-search-path.support.js";
import { fakeStore, type FakeStore } from "./store-fake.support.js";

const scratch = mkdtempSync(join(tmpdir(), "stored-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CLASS = "test-class";

/** A machine: a CLAP directory with one `.clap`, an empty LV2 one, the state under `state/`. */
function machine(name: string, flags: readonly string[] = []): { root: string; clap: string; settings: SyncSettings } {
  const root = join(scratch, name);
  const clap = join(root, "clap", "plate.clap");
  writeFakeClap(clap);
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
  return { root, clap, settings: r.settings };
}

async function sync(settings: SyncSettings, fake: FakeStore, force = false) {
  const lines: string[] = [];
  const summary = await runSync(settings, { force, env: {}, log: (l) => lines.push(l), qualificationStore: new QualificationStore("user", { run: fake.run }) });
  if (summary === undefined) throw new Error("the run held no lock");
  return { summary, lines };
}

const measured = (s: { qualified: number; refused: number; crashed: number; hung: number; unmeasured: number }): number => s.qualified + s.refused + s.crashed + s.hung + s.unmeasured;

/** The measurements of a record as a probe from before the latency pass left them. */
const stripLatency = (m: any): any => {
  const kept = (m.unmeasured ?? []).filter((u: { dimension: string }) => u.dimension !== "latency");
  return { ...m, grid: m.grid.map(({ latency: _latency, ...p }: Record<string, unknown>) => p), ...(kept.length === 0 ? {} : { unmeasured: kept }) };
};

const edited = (r: StoredRecord, change: (rec: any) => any): StoredRecord => ({ ...r, record: change(JSON.parse(JSON.stringify(r.record))) });

describe("a stored record", () => {
  it("applies on a matching file set: the plugin is not measured, its record is put in the layer, its pin is written, the next run skips it", async () => {
    const m = machine("applies");
    const fake = fakeStore({ base: [storedFixture(m.clap)] });
    const { summary, lines } = await sync(m.settings, fake);
    const uri = `clap:${m.clap}#${FIXTURE_CLAP_ID}`;
    expect(lines).toContain(`stored: ${uri}: applied (store)`);
    expect(summary.distributed).toBe(1);
    expect(measured(summary)).toBe(0);
    expect(summaryLine(summary)).toMatch(/, distributed 1, /);
    // the record is the layer's own now, judged again from its rows, and no file of records exists anywhere
    expect(fake.user().map((u) => [u.layer, u.uri])).toEqual([["user", FIXTURE_CLAP_ID]]);
    expect(fake.user()[0]!.record.binary.files).toEqual([{ path: "plate.clap", sha256: fake.user()[0]!.record.binary.sha256 }]);
    expect(fake.user()[0]!.record.rejudged).toBeDefined();
    expect(readdirSync(join(m.root, "state")).filter((f) => /\.(qualification|probe|unmeasured)\.json$/.test(f))).toEqual([]);
    const pins = readFileSync(m.settings.pinFile, "utf8").split("\n").filter((l) => l.startsWith("pin_set"));
    expect(pins).toHaveLength(1);
    const pin = parsePinLine(pins[0]!)!;
    expect(pin.uri).toBe(uri);
    expect(pin.files).toEqual([{ path: "plate.clap", sha256: fake.user()[0]!.record.binary.sha256 }]);
    expect(pin.verdict).toBeDefined();
    const again = await sync(m.settings, fake);
    expect([again.summary.skipped, again.summary.distributed, measured(again.summary)]).toEqual([1, 0, 0]);
  });

  it("is ignored when a byte of the binary differs: the plugin is measured as today", async () => {
    const m = machine("differs");
    const fake = fakeStore({ base: [storedFixture(m.clap)] });
    appendFileSync(m.clap, "one byte more");
    const { summary, lines } = await sync(m.settings, fake);
    expect(lines).toContain(`stored: clap:${m.clap}#${FIXTURE_CLAP_ID}: binary differs`);
    expect(lines.some((l) => l.includes(": applied ("))).toBe(false);
    expect(summary.distributed).toBe(0);
    expect(measured(summary)).toBeGreaterThan(0);
    expect(fake.user()).toEqual([]);
  });

  it("applies beside a record of earlier bytes of the same plugin, which is passed over", async () => {
    const m = machine("two-builds");
    const earlier = join(m.root, "earlier", "plate.clap");
    writeFakeClap(earlier, "an earlier build\n");
    const fake = fakeStore({ base: [storedFixture(earlier), storedFixture(m.clap)] });
    const { summary, lines } = await sync(m.settings, fake);
    expect(lines).toContain(`stored: clap:${m.clap}#${FIXTURE_CLAP_ID}: applied (store)`);
    expect([summary.distributed, measured(summary)]).toEqual([1, 0]);
    expect(fake.user()).toHaveLength(1);
  });

  it("is taken whatever its probe columns say: the pin has no probe bytes", async () => {
    const m = machine("probe-columns");
    const fake = fakeStore({ base: [edited(storedFixture(m.clap), (r) => ({ ...r, probe: { ...r.probe, sha256: "f".repeat(64), file: "gone.probe.json" } }))] });
    const { summary } = await sync(m.settings, fake);
    expect(summary.distributed).toBe(1);
  });

  it("is ignored for another host class, under --no-distributed, and under --force", async () => {
    for (const [name, flags, force] of [["other-class", ["--host-class", "another"], false], ["off", ["--no-distributed"], false], ["forced", [], true]] as const) {
      const m = machine(name, flags);
      const fake = fakeStore({ base: [storedFixture(m.clap)] });
      const run = (flags as readonly string[]).includes("--no-distributed") ? { ...m.settings, distributed: false } : m.settings;
      const { summary } = await sync(run, fake, force);
      expect([name, summary.distributed]).toEqual([name, 0]);
      expect([name, measured(summary)]).toEqual([name, 1]);
    }
  });

  it("with a run that lacks a step its outcome calls for is refused, and the plugin is measured here", async () => {
    const m = machine("run-lacks-step");
    const fake = fakeStore({ base: [edited(storedFixture(m.clap), (r) => ({ ...r, run: { id: "r", steps: [{ step: "scan", result: "ok" }, { step: "probe", result: "probe.ok" }] } }))] });
    const { summary, lines } = await sync(m.settings, fake);
    expect(lines.some((l) => /its record lacks the steps describe, rt-safety; measured here/.test(l)), lines.join("\n")).toBe(true);
    expect(summary.distributed).toBe(0);
  });

  it("refused by an older judge for RT-safety alone is judged again from its rows: it is taken, isolated, never refused", async () => {
    const m = machine("older-judge-rt");
    // the probe counted syscalls in the run; plugin-qualify 0.16.1 rated that unsuitable, today's judge conditional (#196)
    const was = storedFixture(m.clap, { edit: (doc) => { for (const p of doc["grid"]) if (p["rtSafety"] !== undefined) p["rtSafety"]["syscalls"] = 7; } });
    const fake = fakeStore({ base: [edited(was, (r) => ({ ...r, verdicts: r.verdicts.map((v: any) => (v.host === "omx-clap-host" ? { ...v, rating: "unsuitable", qualified: false, deciding: "hosting.rt-safety.violations-in-run" } : v)) }))] });
    const { summary, lines } = await sync(m.settings, fake);
    expect(summary.distributed, lines.join("\n")).toBe(1);
    expect(summary.refused).toBe(0);
    const pins = readFileSync(m.settings.pinFile, "utf8").split("\n").filter((l) => l.startsWith("pin_set"));
    expect(pins.map((l) => parsePinLine(l)!.verdict)).toEqual(["isolated"]);
    const record = fake.user()[0]!.record;
    expect(record.verdicts.find((v) => v.host === "omx-clap-host")).toMatchObject({ rating: "conditional", deciding: "hosting.rt-safety.violations-in-run" });
    expect(record.rejudged?.figures.measuredAt).toBe(record.measuredAt);
  });

  it("that never took the latency figure is not taken: the plugin is measured here", async () => {
    const m = machine("no-latency");
    const fake = fakeStore({ base: [edited(storedFixture(m.clap), (r) => ({ ...r, measurements: stripLatency(r.measurements) }))] });
    const { summary, lines } = await sync(m.settings, fake);
    expect(lines.some((l) => /its record never took the latency figure \(a probe from before that pass\); measured here/.test(l)), lines.join("\n")).toBe(true);
    expect(summary.distributed).toBe(0);
  });

  it("a record of the user layer that never took the latency figure is measured again, its bytes unchanged", async () => {
    const m = machine("owed-here");
    const fake = fakeStore({ base: [storedFixture(m.clap)] });
    expect((await sync(m.settings, fake)).summary.distributed).toBe(1);
    expect((await sync(m.settings, fake)).summary.skipped).toBe(1);
    const own = fake.user()[0]!;
    const at = fake.user().indexOf(own);
    expect(at).toBe(0);
    // the layer's record is replaced by one from before the latency pass
    new QualificationStore("user", { run: fake.run }).put(shadowKeyOf(own), { ...own.record, measurements: stripLatency(own.record.measurements) });
    const owed = await sync({ ...m.settings, distributed: false }, fake);
    expect(owed.lines.some((l) => /never took the latency figure \(a probe from before that pass\); measured again/.test(l)), owed.lines.join("\n")).toBe(true);
    expect(owed.summary.skipped).toBe(0);
  });

  it("a record measured at no cell the sync runs at is passed over with its cells, and the plugin is measured", async () => {
    const m = machine("cell-none", ["--grid", "192000/64"]);
    const fake = fakeStore({ base: [storedFixture(m.clap)] });
    const { summary, lines } = await sync(m.settings, fake);
    expect(lines.some((l) => l.startsWith(`stored: clap:${m.clap}#${FIXTURE_CLAP_ID}: measured at `) && l.includes("48000/128"))).toBe(true);
    expect(summary.distributed).toBe(0);
    expect(measured(summary)).toBeGreaterThan(0);
  });
});

describe("a store with no record at all", () => {
  it("is a normal state: the sync takes nothing, says nothing, and measures the plugin; no directory of records is read", async () => {
    const m = machine("empty");
    const fake = fakeStore();
    const { summary, lines } = await sync(m.settings, fake);
    expect(summary.distributed).toBe(0);
    expect(measured(summary)).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith("stored:"))).toBe(false);
    expect(fake.calls.every((c) => /^(read|write) /.test(c))).toBe(true);
  });

  it("the re-judge, the prune and the counts answer from it with nothing owed", async () => {
    const m = machine("empty-maintenance");
    const fake = fakeStore();
    const lines: string[] = [];
    const summary = await runSync(m.settings, { rejudge: true, env: {}, log: (l) => lines.push(l), qualificationStore: new QualificationStore("user", { run: fake.run }) });
    expect(summary?.rejudge).toEqual({ changed: 0, unchanged: 0, owing: 0 });
  });
});
