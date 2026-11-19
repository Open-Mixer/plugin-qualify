// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Whether a plugin shares a worker (D20, plugin-qualify#53): a suitable plugin does, and so does a conditional one whose
 * only conditional reasons are groupable. Only an RT-unsafe reason isolates; a plugin that started threads of its own
 * (hosting.rt-safety.own-threads) is not RT-unsafe. The one rule the pin, the judgment's hosting and the tiers read.
 */
import { HOSTING_CODE } from "./hosting-codes.generated.js";

/** The conditional reasons that leave a plugin groupable. */
export const GROUPABLE_CONDITIONAL_CODES: ReadonlySet<string> = new Set([HOSTING_CODE.rtSafetyOwnThreads]);

/** A reason as the rule reads it: its contributed rating and its code. */
export interface GroupingReason {
  readonly rating?: string;
  readonly code: string;
}

/** Whether a verdict of `rating` with these reasons shares a worker; a conditional one with no reasons given does not. */
export function sharesAWorker(rating: string, reasons?: readonly GroupingReason[]): boolean {
  if (rating === "suitable") return true;
  if (rating !== "conditional") return false;
  const conditional = (reasons ?? []).filter((r) => r.rating === "conditional");
  return conditional.length > 0 && conditional.every((r) => GROUPABLE_CONDITIONAL_CODES.has(r.code));
}
