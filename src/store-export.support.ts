// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * What the qualification store holds of a record, as its reader exports it (`query --json --records`), built from a record
 * and its probe output by a test helper that follows the column map of the store's writer
 * (`plugin-db-qualification:tools/qualification_db.py`, `_record()` and `_cell()` at aee1ffda4): a leaf with no column is not in the export, a sentence is not in the export, and
 * a CLAP record's `hostExtensions` is the probe output's `offer.clapExtensions`. The store is the reader repository's; this
 * is the stand-in the row judge's proofs run on until its reader answers (`StoredRecord` is the wrapper section 6 documents).
 *
 * `omit` names one mapped column and drops it from the export: the sabotage of case C6b. Kept out of the test files so
 * each test reads the same helper.
 */
import type { ProbeOutput } from "./probe-output.js";
import type { QualificationRecord } from "./qualification-record.js";
import type { StoredRecord } from "./qualification-store.js";

type Json = Record<string, any>;

/**
 * The mapped columns of a cell (the thread counts as the probe reader and the record carry them: `otherThreads.allocations`,
 * `.locks`, `.syscalls`; the store writer names them `...InRun`, which no record holds) and where each lives in the cell's document, one sabotage a column (section 6.2). */
export const CELL_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "cell.latency_declared_frames": ["latency", "declaredFrames"],
  "cell.latency_measured_frames": ["latency", "measuredFrames"],
  "cell.cost_median": ["cost", "median"],
  "cell.cost_percentile_p": ["cost", "percentile", "p"],
  "cell.cost_percentile_value": ["cost", "percentile", "value"],
  "cell.voices_basis": ["cost", "voices", "basis"],
  "cell.voices_capacity": ["cost", "voices", "capacity"],
  "cell.voices_held": ["cost", "voices", "held"],
  "cell.mem_after_instantiate_kb": ["memory", "afterInstantiateKb"],
  "cell.mem_after_activate_kb": ["memory", "afterActivateKb"],
  "cell.mem_at_rest_kb": ["memory", "atRestKb"],
  "cell.mem_second_instance_kb": ["memory", "secondInstanceKb"],
  "cell.mem_notes_held_kb": ["memory", "notesHeldKb"],
  "cell.mem_unmeasured_reason": ["memory", "unmeasuredReason"],
  "cell.mem_limit_bytes": ["memoryLimit", "bytes"],
  "cell.mem_limit_mechanism": ["memoryLimit", "mechanism"],
  "cell.rt_interposer": ["rtSafety", "interposer"],
  "cell.rt_swept": ["rtSafety", "swept"],
  "cell.rt_sweep_applicable": ["rtSafety", "sweepApplicable"],
  "cell.rt_blocks": ["rtSafety", "blocks"],
  "cell.rt_allocations": ["rtSafety", "allocations"],
  "cell.rt_locks": ["rtSafety", "locks"],
  "cell.rt_syscalls": ["rtSafety", "syscalls"],
  "cell.rt_thread_violations": ["rtSafety", "threadViolations"],
  "cell.rt_process_errors": ["rtSafety", "processErrors"],
  "cell.rt_own_threads": ["rtSafety", "ownThreads"],
  "cell.rt_other_allocations": ["rtSafety", "otherThreads", "allocations"],
  "cell.rt_other_locks": ["rtSafety", "otherThreads", "locks"],
  "cell.rt_other_syscalls": ["rtSafety", "otherThreads", "syscalls"],
  "cell.note_sweep_applicable": ["noteSweep", "applicable"],
  "cell.note_sweep_dialect": ["noteSweep", "dialect"],
  "cell.note_sweep_allocations": ["noteSweep", "allocations"],
  "cell.note_sweep_locks": ["noteSweep", "locks"],
  "cell.note_sweep_syscalls": ["noteSweep", "syscalls"],
};

/** The record-level columns the judge reads, and where each lives in the export. */
export const RECORD_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "record_extension": ["hostExtensions"],
  "record.probe_outcome": ["probe", "outcome"],
  "record.run_id": ["run", "id"],
  "record.tested_version": ["testedVersion"],
  "record.binary_path": ["binary", "path"],
  "record.layout_scheme": ["binary", "layout", "scheme"],
  "record.layout_sha256": ["binary", "layout", "sha256"],
};

/** Every column a sabotage is run for. */
export const MAPPED_COLUMNS: readonly string[] = [...Object.keys(CELL_COLUMNS), ...Object.keys(RECORD_COLUMNS)];

const CELL_LEAVES = new Set(Object.values(CELL_COLUMNS).map((p) => p.join(".")));

const dropAt = (doc: Json, path: readonly string[]): void => {
  let at: Json | undefined = doc;
  for (const k of path.slice(0, -1)) {
    at = at?.[k];
    if (at === undefined || typeof at !== "object") return;
  }
  if (at !== undefined) delete at[path[path.length - 1]!];
};

/** One cell of the export: the leaves that have a column, and `rate`, `quantum`, `outcome`; `events` as the store gives them. */
function cellOf(p: Json): Json {
  const out: Json = { rate: p.rate, quantum: p.quantum, outcome: p.outcome };
  for (const path of CELL_LEAVES) {
    const keys = path.split(".");
    let from: any = p;
    for (const k of keys) from = from?.[k];
    if (from === undefined) continue;
    let to = out;
    for (const k of keys.slice(0, -1)) to = to[k] ??= {};
    to[keys[keys.length - 1]!] = from;
  }
  if (p.latencyMs !== undefined) out.latencyMs = p.latencyMs;
  // the latency and cost words of a cell the run could not measure (`code`) and the events are rows too
  if (p.latency?.code !== undefined) (out.latency ??= {}).code = p.latency.code;
  if (p.memory?.basis !== undefined) (out.memory ??= {}).basis = p.memory.basis;
  if (p.memory?.firstInstanceKb !== undefined) (out.memory ??= {}).firstInstanceKb = p.memory.firstInstanceKb;
  if (p.memory?.perInstanceKb !== undefined) (out.memory ??= {}).perInstanceKb = p.memory.perInstanceKb;
  if (p.cost?.blocks !== undefined) (out.cost ??= {}).blocks = p.cost.blocks;
  if (p.cost?.warmupBlocks !== undefined) (out.cost ??= {}).warmupBlocks = p.cost.warmupBlocks;
  if (p.rtSafety !== undefined) (out.rtSafety ??= {}).events = p.rtSafety.events ?? [];
  return out;
}

/**
 * The export of a record: the record's grid cut to the cells' columns, the prose left out (the sentences of the store's
 * map), the probe output's offer extensions for a CLAP record, and the offer as the wrapper carries it. `omit` is one
 * mapped column of {@link MAPPED_COLUMNS}, left out of every cell and of the record.
 */
export function storeExport(record: QualificationRecord, probe: ProbeOutput, omit?: string, hostClass = "x86-64"): StoredRecord {
  const doc: Json = JSON.parse(JSON.stringify(record));
  // `record.run_id` is a required column: a record from before the steps holds the probe output's run id there
  doc.run ??= { id: probe.run.id, steps: [] };
  doc.notMeasured ??= [];
  delete doc.provenance;
  delete doc.history;
  delete doc.tiers?.dimmed;
  for (const s of doc.run?.steps ?? []) delete s.detail;
  for (const u of doc.measurements?.unmeasured ?? []) delete u.detail;
  delete doc.binary.unpinnable;
  // the records are written with the binary's path below the install root, never an absolute one (section 3.7)
  doc.binary.path = String(doc.binary.path).slice(String(doc.binary.path).lastIndexOf("/") + 1);
  doc.measurements.grid = doc.measurements.grid.map(cellOf);
  if (record.plugin.format === "clap" && probe.offer.clapExtensions !== undefined) doc.hostExtensions = [...probe.offer.clapExtensions];
  else delete doc.hostExtensions;
  const cell = omit === undefined ? undefined : CELL_COLUMNS[omit];
  if (cell !== undefined) for (const p of doc.measurements.grid) dropAt(p, cell);
  const rec = omit === undefined ? undefined : RECORD_COLUMNS[omit];
  if (rec !== undefined) dropAt(doc, rec);
  return { layer: "user", sha256: record.binary.sha256, format: record.plugin.format, uri: record.plugin.id, offer: probe.offer.id, host_class: hostClass, record: doc as QualificationRecord };
}
