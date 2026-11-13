// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The figures a qualification record holds at one rate and quantum: what plugin-qualify's own
 * menus and the zynthian-ui fork both need to show, read from `plugin-qualify.qualification-record/1`
 * (`qualification-record.ts`) rather than re-derived.
 *
 * `tools/record_figures.py` is the same reader for a Python console (zynthian-ui): the two are
 * held equal over the same fixtures (`record-figures-python-conformance.test.ts`), figure for
 * figure, word for word and code for code.
 *
 * This reader takes no side on the plugin: no tier, no state, no verdict. A figure plugin-qualify
 * did not take is absent here, never a zero and never guessed — that is plugin-db's reader
 * (plugin-db#4) and the tiers already in the record (`RecordTiers`).
 */
import type { QualificationRecord } from "./qualification-record.js";

/** The latency frames this cell holds: what the plugin declared, and what the run measured, when either was taken. */
export interface RecordLatencyFigures {
  readonly declaredFrames?: number;
  readonly measuredFrames?: number;
}

/** The interposer's RT-safety counts for this cell, as the probe wrote them — never re-summed. */
export interface RecordRtSafetyFigures {
  /** The interposer was loaded; a count below is zero from a real run, not from no interposer. */
  readonly interposer?: boolean;
  readonly swept?: boolean;
  readonly sweepApplicable?: boolean;
  readonly allocations?: number;
  readonly locks?: number;
  readonly syscalls?: number;
  readonly threadViolations?: number;
  readonly processErrors?: number;
  /** How many events the interposer logged (`malloc ? ?`, ...); the words themselves are for a log, not this reader. */
  readonly events?: number;
}

/** The figures of one qualification record at one rate and quantum. */
export interface RecordFigures {
  readonly latency?: RecordLatencyFigures;
  /** The median cost of this cell, in nanoseconds per sample (`ProbeCost.median`'s own unit). */
  readonly costNsPerSampleMedian?: number;
  readonly rtSafety?: RecordRtSafetyFigures;
  /** Whether the continuous soak ran at this rate; `false` when the record never names a soak reading here. */
  readonly soakRan: boolean;
  /** This cell's own outcome code, carried verbatim, exactly when it is a crash. */
  readonly crashCode?: string;
  /** This cell's own outcome code, carried verbatim, exactly when it is a supervisor timeout. */
  readonly timeoutCode?: string;
}

const PROBE_CRASHED = "probe.crashed";
const PROBE_TIMEOUT = "probe.timeout";

function rtSafetyFiguresOf(rtSafety: QualificationRecord["measurements"]["grid"][number]["rtSafety"]): RecordRtSafetyFigures | undefined {
  if (rtSafety === undefined) return undefined;
  return {
    ...(rtSafety.interposer === undefined ? {} : { interposer: rtSafety.interposer }),
    ...(rtSafety.swept === undefined ? {} : { swept: rtSafety.swept }),
    ...(rtSafety.sweepApplicable === undefined ? {} : { sweepApplicable: rtSafety.sweepApplicable }),
    ...(rtSafety.allocations === undefined ? {} : { allocations: rtSafety.allocations }),
    ...(rtSafety.locks === undefined ? {} : { locks: rtSafety.locks }),
    ...(rtSafety.syscalls === undefined ? {} : { syscalls: rtSafety.syscalls }),
    ...(rtSafety.threadViolations === undefined ? {} : { threadViolations: rtSafety.threadViolations }),
    ...(rtSafety.processErrors === undefined ? {} : { processErrors: rtSafety.processErrors }),
    ...(rtSafety.events === undefined ? {} : { events: rtSafety.events.length }),
  };
}

function latencyFiguresOf(latency: QualificationRecord["measurements"]["grid"][number]["latency"]): RecordLatencyFigures | undefined {
  const declaredFrames = (latency as { declaredFrames?: number } | undefined)?.declaredFrames;
  const measuredFrames = (latency as { measuredFrames?: number } | undefined)?.measuredFrames;
  if (declaredFrames === undefined && measuredFrames === undefined) return undefined;
  return {
    ...(declaredFrames === undefined ? {} : { declaredFrames }),
    ...(measuredFrames === undefined ? {} : { measuredFrames }),
  };
}

/** Whether the record names a continuous soak reading at this rate (`measurements.behaviour.soak.perRate`). */
function soakRanAt(record: QualificationRecord, rate: number): boolean {
  const soak = record.measurements.behaviour?.soak as { readonly perRate?: Readonly<Record<string, unknown>> } | undefined;
  return soak?.perRate?.[String(rate)] !== undefined;
}

/**
 * The figures `plugin-qualify.qualification-record/1` holds at one rate and quantum: the cell the
 * record's grid names at that pair, else every per-cell figure is absent and `soakRan` alone still
 * answers for the rate.
 */
export function recordFigures(record: QualificationRecord, rate: number, quantum: number): RecordFigures {
  const point = record.measurements.grid.find((p) => p.rate === rate && p.quantum === quantum);
  return {
    ...(point === undefined ? {} : { ...wrapLatency(point.latency), ...wrapCost(point.cost), ...wrapRtSafety(point.rtSafety) }),
    soakRan: soakRanAt(record, rate),
    ...(point?.outcome === PROBE_CRASHED ? { crashCode: point.outcome } : {}),
    ...(point?.outcome === PROBE_TIMEOUT ? { timeoutCode: point.outcome } : {}),
  };
}

function wrapLatency(latency: QualificationRecord["measurements"]["grid"][number]["latency"]): Pick<RecordFigures, "latency"> | Record<string, never> {
  const l = latencyFiguresOf(latency);
  return l === undefined ? {} : { latency: l };
}

function wrapCost(cost: QualificationRecord["measurements"]["grid"][number]["cost"]): Pick<RecordFigures, "costNsPerSampleMedian"> | Record<string, never> {
  return cost === undefined ? {} : { costNsPerSampleMedian: cost.median };
}

function wrapRtSafety(rtSafety: QualificationRecord["measurements"]["grid"][number]["rtSafety"]): Pick<RecordFigures, "rtSafety"> | Record<string, never> {
  const rt = rtSafetyFiguresOf(rtSafety);
  return rt === undefined ? {} : { rtSafety: rt };
}
