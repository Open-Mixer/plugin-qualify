// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * What plugin-qualify's judgement declares once and writes into every record (and so into every judged layer): the
 * latency line and the rules a record was judged by (openmixer plugin-system design 7.15, plugin-db records.md).
 */
import { readFileSync } from "node:fs";

/** The latency line, in milliseconds: declared once, here, and written into every record and judged layer. */
export const LATENCY_LINE_MS = 5;

/** A measured latency in milliseconds at its rate, rounded to the microsecond. */
export const latencyMsOf = (frames: number, rate: number): number => Math.round((frames * 1e9) / rate) / 1e6;

const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** The rules a plugin-qualify of this version judges by: `plugin-qualify-rules/<major>.<minor>`. */
export function judgementRules(version: string = VERSION): string {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(version);
  if (m === null) throw new Error(`judgementRules: ${JSON.stringify(version)} is no version`);
  return `plugin-qualify-rules/${m[1]}.${m[2]}`;
}
