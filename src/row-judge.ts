// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The judge's input from the store's rows (the store spec's section 6.2): `qualify-rejudge` judges a record from what
 * `plugin-qualification-db query --json --records` exports of it, and from nothing else. Probe bytes are never kept beside
 * the store, so every field the judge reads has a column; a record whose rows lack one is not judged again, and nothing is
 * guessed from a missing field.
 */
import type { ProbeGridPoint, ProbeOutput } from "./probe-output.js";
import type { StoredRecord } from "./qualification-store.js";

/**
 * Why a record's rows cannot be judged again, or `undefined` when they can: a cell under an interposer with a NULL count the
 * judge reads. The words are the columns'. A NULL `host_extensions` is no gap: a CLAP record whose probe ended before the offer
 * holds none, and the judge reads a missing list as an empty one, as it does the probe output's.
 */
export function rowsUnreadable(s: StoredRecord): string | undefined {
  const r = s.record;
  for (const p of r.measurements.grid) {
    if (p.outcome !== "probe.ok" || p.rtSafety?.interposer !== true) continue;
    for (const [column, value] of [["rt_allocations", p.rtSafety.allocations], ["rt_locks", p.rtSafety.locks], ["rt_syscalls", p.rtSafety.syscalls]] as const) {
      if (value === undefined) return `cell ${String(p.rate)}/${String(p.quantum)}: ${column} is NULL under an interposer`;
    }
  }
  return undefined;
}

/** A cell of the record as the probe's grid point the judge reads: the figures with a column, and no latency without a figure. */
function pointOf(cell: StoredRecord["record"]["measurements"]["grid"][number]): ProbeGridPoint {
  const { latency, ...rest } = cell as typeof cell & { latency?: { declaredFrames?: number; measuredFrames?: number } };
  const l = latency?.declaredFrames === undefined && latency?.measuredFrames === undefined ? undefined : { declaredFrames: latency.declaredFrames as number, ...(latency.measuredFrames === undefined ? {} : { measuredFrames: latency.measuredFrames }) };
  return { ...(rest as unknown as ProbeGridPoint), ...(l === undefined ? {} : { latency: l }) };
}

/**
 * The probe output the judge is handed, built from the rows. The steps are not stored and no verdict reads them; the
 * machine's class is evidence the judge does not read.
 */
export function outputOfRows(s: StoredRecord): ProbeOutput {
  const r = s.record;
  return {
    formatVersion: "1.0",
    run: { id: r.run?.id ?? "", startedAt: r.measuredAt, elapsedMs: 0, complete: r.probe.complete, outcome: r.probe.outcome, ...(r.probe.reason === undefined ? {} : { reason: r.probe.reason }), protocol: r.probe.protocol, tools: r.tool, via: "store" },
    plugin: { format: r.plugin.format as "clap" | "lv2", id: r.plugin.id, ...(r.plugin.name === undefined ? {} : { name: r.plugin.name }), ...(r.testedVersion === undefined ? {} : { version: r.testedVersion }) },
    binary: r.binary,
    machine: { class: r.probe.machineClass, profile: { governor: null, cpuidle: [], meetsProtocol: r.probe.meetsProtocol, unmet: [] }, pinnedCpus: "" },
    offer: { id: s.offer, ...(r.plugin.format === "clap" ? { clapExtensions: r.hostExtensions ?? [] } : {}) },
    steps: [],
    grid: r.measurements.grid.map(pointOf),
    ...(r.measurements.behaviour === undefined ? {} : { behaviour: r.measurements.behaviour }),
  };
}
