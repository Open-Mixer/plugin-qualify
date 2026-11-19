// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The row judge (the store spec's section 6.2, cases C6 and C6b): `qualify-rejudge` judges a record from what the store
 * exports of it, never from probe bytes. The proof is byte equality with today's probe judge over a corpus, with one
 * sabotage per mapped column: a column left out of the export makes the comparison differ on a record that holds it.
 *
 * The corpus is plugin-qualify's own fixtures, from the records of a Raspberry Pi written by two releases and the
 * example probe outputs, and variants of each with every figure the judge reads set. The store export is built by
 * `store-export.support.ts` from the store writer's column map; the oracle is the probe judge on the probe output.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fixtureJson } from "./probe-output-fixtures.js";
import { readProbeOutput, type ProbeOutput } from "./probe-output.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { shippedHostProfile, type HostProfile } from "./host-profiles.js";
import { QUALIFICATION_RECORD_SCHEMA, buildQualificationRecord, unmeasuredWordOf, type QualificationRecord } from "./qualification-record.js";
import { FIXTURES } from "./qualify-rejudge.support.js";
import { MAPPED_COLUMNS, storeExport } from "./store-export.support.js";

const PI = join(FIXTURES, "..", "records-rpi5-0.19.1");
const OPTIONS = { host: "omx-clap-host", by: "plugin-qualify test", at: "2026-11-19T00:00:00.000Z" };

/** The two judges, or the named reason they are not there yet. */
async function judges() {
  let rejudge: any;
  let rows: any;
  try {
    rejudge = await import("./qualify-rejudge.js");
    rows = await import("./row-judge.js");
  } catch (e) {
    throw new Error(`row judge missing: ${(e as Error).message}`);
  }
  if (typeof rejudge.rejudgeWithOutput !== "function") throw new Error("row judge missing: qualify-rejudge.ts exports no rejudgeWithOutput");
  if (typeof rejudge.rejudgeFromRows !== "function") throw new Error("row judge missing: qualify-rejudge.ts exports no rejudgeFromRows");
  if (typeof rows.rowsUnreadable !== "function" || typeof rows.outputOfRows !== "function") throw new Error("row judge missing: row-judge.ts exports no rowsUnreadable and outputOfRows");
  return {
    withOutput: rejudge.rejudgeWithOutput as (r: QualificationRecord, o: ProbeOutput, opt: typeof OPTIONS) => { record: QualificationRecord },
    fromRows: rejudge.rejudgeFromRows as (s: ReturnType<typeof storeExport>, opt: typeof OPTIONS) => { record: QualificationRecord },
    unreadable: rows.rowsUnreadable as (s: ReturnType<typeof storeExport>) => string | undefined,
    outputOfRows: rows.outputOfRows as (s: ReturnType<typeof storeExport>) => ProbeOutput,
  };
}

interface Entry {
  readonly name: string;
  readonly record: QualificationRecord;
  readonly probe: ProbeOutput;
}

const probeOf = (doc: unknown): ProbeOutput => {
  const r = readProbeOutput(JSON.stringify(doc));
  if (!r.ok) throw new Error(`${r.code}: ${r.problem}`);
  return r.output;
};

/** A probe output with every figure the judge reads set at its first measured cell (the fixtures hold a few of them each). */
function enriched(doc: Record<string, any>, memoryUnmeasured = false): Record<string, any> {
  const out = JSON.parse(JSON.stringify(doc));
  for (const p of out.grid ?? []) {
    if (p.outcome !== "probe.ok") continue;
    p.latency = { declaredFrames: 3, measuredFrames: 4, method: "impulse-onset" };
    p.cost = { unit: "ns-per-sample", median: 41.2, percentile: { p: 95, value: 47.9 }, min: 39, max: 112, iqr: 3, blocks: 100, warmupBlocks: 8, warmupMedian: 50, timingFloorNsPerBlock: 180, voices: { held: 8, basis: "declared", capacity: 16 } };
    p.memory = memoryUnmeasured ? { unmeasuredReason: unmeasuredWordOf("probe.crashed"), unmeasuredDetail: "the run ended probe.crashed" } : { afterInstantiateKb: 20_000, afterActivateKb: 21_000, atRestKb: 20_500, secondInstanceKb: 20_900, notesHeldKb: 22_000, notesHeld: 8, basis: "declared" };
    p.memoryLimit = { bytes: 2_147_483_648, mechanism: "rlimit-as" };
    p.rtSafety = { interposer: true, swept: true, sweepApplicable: true, blocks: 512, allocations: 1, locks: 2, syscalls: 3, threadViolations: 0, processErrors: 0, events: ["alloc"] };
    p.noteSweep = { applicable: true, dialect: "clap", allocations: 1, locks: 1, syscalls: 1 };
  }
  return out;
}

/** A record as the writer makes it from a probe output, under the host profiles the sync judges. */
function recordOf(output: ProbeOutput, bytes: Uint8Array): QualificationRecord {
  const judgment = judgeProbeOutput(output, ["openmixer-console", "omx-clap-host"].map((id) => shippedHostProfile(id)).filter((p): p is HostProfile => p !== undefined));
  return buildQualificationRecord(judgment, { file: "probe.json", sha256: "0".repeat(64), bytes: bytes.length });
}

function corpus(): Entry[] {
  const out: Entry[] = [];
  for (const dir of [FIXTURES, PI]) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".qualification.json"))) {
      const record = JSON.parse(readFileSync(join(dir, f), "utf8")) as QualificationRecord;
      const text = readFileSync(join(dir, f.replace(".qualification.json", ".probe.json")), "utf8");
      const probe = probeOf(JSON.parse(text));
      out.push({ name: f, record, probe });
      const doc = enriched(JSON.parse(text));
      const variant = probeOf(doc);
      out.push({ name: `${f} (every figure set)`, record: { ...record, ...rebuilt(variant, record) }, probe: variant });
    }
  }
  for (const name of ["success-msi", "plugin-crash", "memory-limit-refused"]) {
    const doc = fixtureJson(name);
    const bytes = Buffer.from(JSON.stringify(doc));
    for (const [label, d] of [[name, doc], [`${name} (every figure set)`, enriched(doc)], [`${name} (memory unmeasured)`, enriched(doc, true)]] as const) {
      const probe = probeOf(d);
      out.push({ name: label, record: recordOf(probe, bytes), probe });
    }
  }
  return out;
}

/** The record's grid, as the writer makes it from the probe output of the variant. */
function rebuilt(probe: ProbeOutput, record: QualificationRecord): Pick<QualificationRecord, "measurements"> {
  const made = recordOf(probe, Buffer.from("{}"));
  return { measurements: { ...record.measurements, grid: made.measurements.grid } };
}

/** The verdicts, tiers and cost as the record writes them: the text two judges are compared on. */
const judgedText = (r: QualificationRecord) => ({ verdicts: JSON.stringify(r.verdicts), tiers: JSON.stringify(r.tiers), cost: JSON.stringify(r.cost), runId: JSON.stringify(r.rejudged?.figures.runId ?? null) });

/** The first field of the judgment that differs between the two judges for one entry, or `undefined` when none does. */
async function firstDifference(e: Entry, omit?: string): Promise<string | undefined> {
  const j = await judges();
  const was = judgedText(j.withOutput(e.record, e.probe, OPTIONS).record);
  const stored = storeExport(e.record, e.probe, omit);
  let now;
  try {
    now = judgedText(j.fromRows(stored, OPTIONS).record);
  } catch (err) {
    return `rows: ${(err as Error).message}`;
  }
  for (const k of ["verdicts", "tiers", "cost", "runId"] as const) if (was[k] !== now[k]) { let i = 0; while (was[k][i] === now[k][i]) i++; return `${k} at ${String(i)}: ...${was[k].slice(Math.max(0, i - 80), i + 120)} != ...${now[k].slice(Math.max(0, i - 80), i + 120)}`; }
  // the rows reproduce the probe output the judge reads, field for field: a column left out shows here when it moves no verdict
  const view = (o: ProbeOutput) =>
    canon({
      run: o.run.outcome,
      plugin: { format: o.plugin.format, id: o.plugin.id, version: o.plugin.version ?? null },
      offer: o.offer.id,
      ext: o.plugin.format === "clap" ? (o.offer.clapExtensions ?? []) : null,
      grid: o.grid.map((p) => ({
        rate: p.rate, quantum: p.quantum, outcome: p.outcome,
        latency: p.latency === undefined ? null : { d: p.latency.declaredFrames ?? null, m: p.latency.measuredFrames ?? null },
        cost: p.cost === undefined ? null : { median: p.cost.median, percentile: p.cost.percentile, voices: p.cost.voices ?? null },
        rt: p.rtSafety ?? null,
        note: p.noteSweep ?? null,
        mem: p.memory === undefined ? null : { a: p.memory.afterInstantiateKb ?? null, b: p.memory.afterActivateKb ?? null, c: p.memory.atRestKb ?? null, d: p.memory.secondInstanceKb ?? null, e: p.memory.notesHeldKb ?? null, f: p.memory.unmeasuredReason ?? null },
        limit: p.memoryLimit ?? null,
      })),
      binary: { path: o.binary.path, files: o.binary.files, layout: o.binary.layout ?? null },
    });
  const rowsView = view(j.outputOfRows(stored));
  const probeView = view(probeWithRelativePath(e.probe));
  if (rowsView !== probeView) return `judge input: ${firstDiff(probeView, rowsView)}`;
  return undefined;
}

/** The probe's output as the store exports it: the binary's path below the install root, never the absolute one. */
const probeWithRelativePath = (o: ProbeOutput): ProbeOutput => ({ ...o, binary: { ...o.binary, path: o.binary.path.slice(o.binary.path.lastIndexOf("/") + 1) } });

/** JSON with its keys in order: two readers of one document may build their objects in another. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

const firstDiff = (a: string, b: string): string => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${String(i)}: probe ...${a.slice(Math.max(0, i - 20), i + 60)} / rows ...${b.slice(Math.max(0, i - 20), i + 60)}`;
};

describe("C6b: the row judge equals the probe judge over the corpus", () => {
  const entries = corpus();

  it("holds records of both formats, with the CLAP records' extensions and every figure the judge reads", () => {
    expect(entries.length).toBeGreaterThanOrEqual(20);
    expect(new Set(entries.map((e) => e.record.plugin.format))).toEqual(new Set(["clap", "lv2"]));
    expect(entries.every((e) => e.record.schema === QUALIFICATION_RECORD_SCHEMA)).toBe(true);
  });

  for (const e of entries) {
    it(`${e.name}: verdicts, tiers and cost are byte-equal`, async () => {
      expect(await firstDifference(e)).toBeUndefined();
    });
  }

  describe("one sabotage per mapped column", () => {
    for (const column of MAPPED_COLUMNS) {
      // ownThreads and otherThreads are not in the probe reader before the real-time probe change lands: no oracle holds them yet
      const pending119 = ["cell.rt_own_threads", "cell.rt_other_allocations", "cell.rt_other_locks", "cell.rt_other_syscalls"].includes(column);
      (pending119 ? it.skip : it)(`leaving out ${column} makes the comparison differ on a record that reads it`, async () => {
        const differing: string[] = [];
        for (const e of entries) {
          const d = await firstDifference(e, column);
          if (d !== undefined) differing.push(`${e.name}: ${d}`);
        }
        expect(differing.length, `no record of the corpus reads ${column}`).toBeGreaterThan(0);
      });
    }
  });
});

describe("C6: a record whose rows lack a figure the judge needs is not judged again", () => {
  const clap = () => corpus().find((e) => e.record.plugin.format === "clap" && e.name.includes("every figure set"))!;

  it("a CLAP record without host_extensions is no gap: the judge reads it as an empty list, as it reads the probe output's", async () => {
    const e = clap();
    const j = await judges();
    expect(j.unreadable(storeExport(e.record, e.probe, "record_extension"))).toBeUndefined();
    expect(j.outputOfRows(storeExport(e.record, e.probe, "record_extension")).offer.clapExtensions).toEqual([]);
  });

  it("a NULL cell.rt_syscalls under an interposer owes figures-unreadable", async () => {
    const e = clap();
    const j = await judges();
    expect(j.unreadable(storeExport(e.record, e.probe, "cell.rt_syscalls"))).toMatch(/rt_syscalls|syscalls/);
  });

  it("the probe columns decide nothing: a record whose probe_sha256 is altered is judged as it was", async () => {
    const e = clap();
    const j = await judges();
    const stored = storeExport(e.record, e.probe);
    const altered = { ...stored, record: { ...stored.record, probe: { ...stored.record.probe, sha256: "f".repeat(64), file: "gone.probe.json" } } };
    expect(judgedText(j.fromRows(altered, OPTIONS).record)).toEqual(judgedText(j.fromRows(stored, OPTIONS).record));
  });
});

describe("host_extensions NULL reads as an empty list, byte-equal to the probe judge", () => {
  /** A CLAP plugin whose probe crashed before the offer: no extension list, and every cell lost. */
  const crashed = (): Entry => {
    const doc = fixtureJson("success-msi");
    doc["run"] = { ...doc["run"], outcome: "probe.crashed", complete: false };
    doc["offer"] = { id: "default", realtime: "none" };
    doc["grid"] = doc["grid"].map((p: Record<string, unknown>) => ({ rate: p["rate"], quantum: p["quantum"], outcome: "probe.crashed" }));
    const probe = probeOf(doc);
    return { name: "a CLAP probe that crashed", probe, record: recordOf(probe, Buffer.from(JSON.stringify(doc))) };
  };

  it("the record writer leaves hostExtensions out of a CLAP record whose probe never reached the offer, and puts an empty list for a run that offered none", () => {
    const c = crashed();
    expect(c.probe.plugin.format).toBe("clap");
    expect(c.probe.offer.clapExtensions).toBeUndefined();
    expect(c.record.hostExtensions).toBeUndefined();
    const none = probeOf({ ...fixtureJson("success-msi"), offer: { id: "default", clapExtensions: [], realtime: "none" } });
    expect(recordOf(none, Buffer.from("{}")).hostExtensions).toEqual([]);
  });

  it("a CLAP probe that ended well but whose offer holds no list: the same, with the verdicts of an empty offer", async () => {
    const doc = fixtureJson("success-msi");
    doc["offer"] = { id: "default", realtime: "none" };
    const probe = probeOf(doc);
    const entry: Entry = { name: "a CLAP probe with no offer list", probe, record: recordOf(probe, Buffer.from(JSON.stringify(doc))) };
    expect(entry.record.hostExtensions).toBeUndefined();
    const j = await judges();
    expect(j.unreadable(storeExport(entry.record, probe))).toBeUndefined();
    expect(await firstDifference(entry)).toBeUndefined();
  });

  it("the row judge reads a crashed probe's record as it is: not unreadable, and equal to the probe judge", async () => {
    const c = crashed();
    const j = await judges();
    const stored = storeExport(c.record, c.probe);
    expect(stored.record.hostExtensions).toBeUndefined();
    expect(j.unreadable(stored)).toBeUndefined();
    expect(await firstDifference(c)).toBeUndefined();
  });

  it("an empty list and a NULL give the same judgment; a list that the run offered does not", async () => {
    const c = corpus().find((e) => e.name === "success-msi")!;
    const j = await judges();
    const stored = storeExport(c.record, c.probe);
    const text = (h: readonly string[] | undefined) => JSON.stringify(j.fromRows({ ...stored, record: { ...stored.record, hostExtensions: h } }, OPTIONS).record.verdicts);
    expect(text(undefined)).toBe(text([]));
    expect(text(c.probe.offer.clapExtensions)).not.toBe(text([]));
  });
});
