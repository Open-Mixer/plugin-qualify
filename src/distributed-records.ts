// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * What the sync and its commands share about the machine's own records: the host class a record is read and written
 * under, the outcome a verdict makes, and the cells a record holds. The records themselves are the qualification store's
 * (`qualification-store.ts`): its BASE holds the records another device of the same machine class measured for a plugin
 * set, installed read-only, and its USER layer (the system layer under `--system`) holds the sync's own, which shadow the
 * base's of the same key. The sync takes a plugin from a stored record only when the files plugin-hostd names for it are
 * exactly the record's list (`pin-match.ts`); the name of a plugin finds its record and never decides anything.
 */
import { readFileSync, readdirSync } from "node:fs";
import { machine } from "node:os";
import { join, resolve } from "node:path";

import { cellKey, type GridCell } from "./measurement-grid.js";
import { clapPinUri, pinVerdictOf, type PinEntry } from "./pins-file.js";
import { integrityOfProbeOutput } from "./probe-judge.js";
import { readProbeOutput, sha256Hex } from "./probe-output.js";
import { QUALIFICATION_RECORD_SCHEMA, type QualificationRecord, type RecordVerdict } from "./qualification-record.js";
import type { FileDigest, SyncItem, SyncOutcome, SyncPlugin } from "./qualify-sync.js";
import type { SuitabilityRating } from "./rating.js";
import { writeFileWhole } from "./whole-file.js";

/** Where a system's packages install the distributed records. */
export const DISTRIBUTED_DIR_SYSTEM = "/usr/share/omx/qualification";

/** The file of a set that says where its records come from. */
export const DISTRIBUTED_PROVENANCE_FILE = "provenance.json";
export const DISTRIBUTED_PROVENANCE_SCHEMA = "plugin-qualify.distributed-provenance/1";

/** Where the records of a set come from. The keys below are always there; the rest is what the builder was given. */
export interface DistributedProvenance {
  readonly schema: typeof DISTRIBUTED_PROVENANCE_SCHEMA;
  readonly set: string;
  readonly hostClass: string;
  /** The package that installed the set. */
  readonly package: { readonly name: string; readonly version: string };
  /** The day the package was built (YYYY-MM-DD). */
  readonly date: string;
  readonly [key: string]: unknown;
}

/** The device tree's model file, where a board names itself. */
export const BOARD_MODEL_FILE = "/proc/device-tree/model";

/** The board's own model, or `undefined` on a machine without a device tree. */
export function readBoardModel(): string | undefined {
  try {
    return readFileSync(BOARD_MODEL_FILE, "utf8");
  } catch {
    return undefined;
  }
}

/** The host class of a board the layer knows by its device-tree model: `rpi5` for a Raspberry Pi 5 or its compute module. */
export function hostClassOfBoard(model: string | undefined): string | undefined {
  if (model === undefined) return undefined;
  const m = /^Raspberry Pi (?:Compute Module )?(\d)(?:\s|$)/.exec(model.replace(/\0/g, "").trim());
  return m === null ? undefined : `rpi${m[1]!}`;
}

/** The architecture `uname -m` names, or `undefined` when it cannot be read. */
export function readMachine(): string | undefined {
  try {
    return machine();
  } catch {
    return undefined;
  }
}

/** The host class of a machine with no board name, by `uname -m`: `x86-64` for an x86_64 one; none for an architecture without a class. */
export function hostClassOfMachine(arch: string | undefined): string | undefined {
  return arch?.trim() === "x86_64" ? "x86-64" : undefined;
}

/**
 * The host class of this machine: the one a setting names, else the board's, else the machine's; `undefined` for a
 * machine of no class. The sync reads distributed records by it, and plugin-qualify here prints it (#56).
 */
export function hostClassOf(
  named: string | undefined,
  boardModel: () => string | undefined = readBoardModel,
  machineArch: () => string | undefined = readMachine,
): string | undefined {
  return named !== undefined && named !== "" ? named : hostClassOfBoard(boardModel()) ?? hostClassOfMachine(machineArch());
}

/** One distributed record, read: where it is, what it says, and the set it came with. */
export interface DistributedRecord {
  readonly path: string;
  readonly record: QualificationRecord;
  readonly set: string;
  readonly provenance: DistributedProvenance;
}

/** What the sync's own judgment would make of the record's verdict for the host, as `outcomeOf` reads a run. */
export function outcomeOfVerdict(v: Pick<RecordVerdict, "measured" | "rating" | "deciding">): SyncOutcome {
  if (!v.measured) return v.deciding === "probe.crashed" ? "crashed" : v.deciding === "probe.timeout" ? "hung" : "unmeasured";
  if (v.rating === "suitable" || v.rating === "conditional") return "qualified";
  return v.rating === "unsuitable" ? "refused" : "unmeasured";
}

/** The cells a record's grid holds, by rate then quantum: where the set it came in was measured. */
export function recordCells(record: Pick<QualificationRecord, "measurements">): GridCell[] {
  const seen = new Map<string, GridCell>();
  for (const p of record.measurements?.grid ?? []) seen.set(cellKey(p), { rate: p.rate, quantum: p.quantum });
  return [...seen.values()].sort((a, b) => a.rate - b.rate || a.quantum - b.quantum);
}
