// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A plugin's resource hints against what plugin-qualify measured (#198). A hint is a claim the plugin makes about its own
 * footprint (`org.openmixer.resource-hints.draft/0`, omx-contract's `RESOURCE_HINTS`); omx-contract's
 * `docs/resource-hints.md` says plugin-qualify measures the same resource and a declared figure the measurement does not
 * bear out is a finding. This module is that comparison, pure: the declared side is what omx-clap-scan printed
 * (`resource_hints` in `--json`), the measured side a probe output's grid.
 *
 * Each hint comes out as one row, declared and measured side by side, with one of four verdicts:
 *
 * - `agrees`: the measurement is within the declared figure (memory with the declared tolerance, threads exactly).
 * - `exceeds`: the measurement is above it: the finding.
 * - `unknown`: the plugin does not state this hint. Never read as zero.
 * - `unmeasured`: the plugin states it and plugin-qualify took no figure for it, either because no cell measured it or
 *   because plugin-qualify does not measure that resource at all (`shared-load`, `streams-from-disk`, `opens-sockets`,
 *   `activate-time` today).
 *
 * What is measured, per hint, is the largest figure any cell that ran to its end took:
 * `footprint-at-rest` the resident set one instance grew by, activated and idle (`memory.atRestKb`);
 * `footprint-per-voice` what the notes held added over the rest figure, per note (`memory.notesHeldKb`, `notesHeld`);
 * `threads-spawned` the threads the plugin started itself while the interposer watched (`rtSafety.ownThreads`).
 */
import type { ProbeGridPoint } from "./probe-output.js";
import { probeOk } from "./probe-output.js";
import { RESOURCE_HINT_MEMORY_SLACK_KB, RESOURCE_HINT_MEMORY_TOLERANCE } from "./qualify-declarations.js";

/** The hints, by omx-contract's word, in the declaration's order. */
export const RESOURCE_HINT_WORDS = [
  "footprint-at-rest",
  "footprint-per-voice",
  "shared-load",
  "threads-spawned",
  "streams-from-disk",
  "opens-sockets",
  "activate-time",
] as const;
export type ResourceHintWord = (typeof RESOURCE_HINT_WORDS)[number];

/** One hint as the scan printed it: its unit and its figure, `null` when the plugin does not state it. */
export interface DeclaredResourceHint {
  readonly unit: string;
  readonly figure: number | boolean | null;
}

/** What omx-clap-scan printed for a plugin's `resource_hints`: the mask, each hint, or the code the host refused it with. */
export interface DeclaredResourceHints {
  readonly declared: number;
  readonly refused?: string;
  readonly hints: Readonly<Partial<Record<ResourceHintWord, DeclaredResourceHint>>>;
}

export type ResourceHintVerdict = "agrees" | "exceeds" | "unknown" | "unmeasured";

/** One hint, declared against measured. A figure in the hint's own unit (bytes, a count); `null` for none. */
export interface ResourceHintRow {
  readonly hint: ResourceHintWord;
  readonly unit: string;
  readonly declared: number | boolean | null;
  readonly measured: number | null;
  readonly verdict: ResourceHintVerdict;
  /** The cell the measured figure was taken at. */
  readonly rate?: number;
  readonly quantum?: number;
}

/** The comparison as a record carries it. A refused declaration states no hint, so it has no rows. */
export interface ResourceHintsCheck {
  readonly declared: number;
  readonly refused?: string;
  readonly hints: readonly ResourceHintRow[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => Object.prototype.toString.call(v) === "[object Object]";

/**
 * The scan's `resource_hints` object, or `undefined` when it is absent (the plugin states none) or is not that object.
 * A hint whose figure is not a number, a boolean or null is not read; a hint the scan did not print is not stated.
 */
export function readScanResourceHints(value: unknown): DeclaredResourceHints | undefined {
  if (!isRecord(value) || typeof value["declared"] !== "number") return undefined;
  const hints: Partial<Record<ResourceHintWord, DeclaredResourceHint>> = {};
  for (const word of RESOURCE_HINT_WORDS) {
    const h = value[word];
    if (!isRecord(h) || typeof h["unit"] !== "string") continue;
    const f = h["figure"];
    if (f === null || typeof f === "boolean" || (typeof f === "number" && Number.isFinite(f))) hints[word] = { unit: h["unit"], figure: f };
  }
  return { declared: value["declared"], ...(typeof value["refused"] === "string" ? { refused: value["refused"] } : {}), hints };
}

interface Measured {
  readonly figure: number;
  readonly rate: number;
  readonly quantum: number;
}

/** The largest figure `of` takes over the cells that ran to their end, with its cell. */
function largest(grid: readonly ProbeGridPoint[], of: (p: ProbeGridPoint) => number | undefined): Measured | undefined {
  let best: Measured | undefined;
  for (const p of grid) {
    if (p.outcome !== probeOk()) continue;
    const figure = of(p);
    if (figure === undefined || !Number.isFinite(figure)) continue;
    if (best === undefined || figure > best.figure) best = { figure, rate: p.rate, quantum: p.quantum };
  }
  return best;
}

/** Bytes in one KB of the footprint (the resident set is read in KB). */
const KB = 2 ** 10;

/** What plugin-qualify measures for each hint it can measure, in the hint's unit; a hint absent here is not measured. */
const MEASURERS: Readonly<Partial<Record<ResourceHintWord, (p: ProbeGridPoint) => number | undefined>>> = {
  "footprint-at-rest": (p) => (p.memory?.unmeasuredReason === undefined && p.memory?.atRestKb !== undefined ? p.memory.atRestKb * KB : undefined),
  "footprint-per-voice": (p) => {
    const m = p.memory;
    if (m === undefined || m.unmeasuredReason !== undefined || m.notesHeldKb === undefined || m.atRestKb === undefined) return undefined;
    if (m.notesHeld === undefined || m.notesHeld <= 0) return undefined;
    return (Math.max(m.notesHeldKb - m.atRestKb, 0) * KB) / m.notesHeld;
  },
  "threads-spawned": (p) => (p.rtSafety?.interposer === true ? p.rtSafety.ownThreads : undefined),
};

/** Whether a measured byte figure is within a declared one: the declared tolerance above it, and the declared slack. */
export function memoryWithinHint(declaredBytes: number, measuredBytes: number): boolean {
  return measuredBytes <= declaredBytes * (1 + RESOURCE_HINT_MEMORY_TOLERANCE) + RESOURCE_HINT_MEMORY_SLACK_KB * KB;
}

function verdictOf(hint: ResourceHintWord, declared: number, measured: number): ResourceHintVerdict {
  if (hint === "threads-spawned") return measured <= declared ? "agrees" : "exceeds";
  return memoryWithinHint(declared, measured) ? "agrees" : "exceeds";
}

/** The declared hints against the grid's measurements, one row per hint in the declaration's order. */
export function checkResourceHints(declared: DeclaredResourceHints, grid: readonly ProbeGridPoint[]): ResourceHintsCheck {
  if (declared.refused !== undefined) return { declared: declared.declared, refused: declared.refused, hints: [] };
  const hints = RESOURCE_HINT_WORDS.map((hint): ResourceHintRow => {
    const d = declared.hints[hint];
    const unit = d?.unit ?? "";
    const figure = d?.figure ?? null;
    if (figure === null) return { hint, unit, declared: null, measured: null, verdict: "unknown" };
    const measurer = MEASURERS[hint];
    const m = measurer === undefined ? undefined : largest(grid, measurer);
    if (m === undefined || typeof figure !== "number") return { hint, unit, declared: figure, measured: null, verdict: "unmeasured" };
    return { hint, unit, declared: figure, measured: Math.round(m.figure), verdict: verdictOf(hint, figure, m.figure), rate: m.rate, quantum: m.quantum };
  });
  return { declared: declared.declared, hints };
}
