// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Whether a plugin shares a worker (D20, plugin-qualify#53): a suitable plugin does, and so does a conditional one whose
 * only conditional reasons are groupable. Only an RT-unsafe reason isolates; a plugin that started threads of its own
 * (hosting.rt-safety.own-threads) is not RT-unsafe. The one rule the pin, the judgment's hosting and the tiers read.
 */
import { qualificationDomain } from "./qualification-domain.js";

/** The item of the qualification domain that declares the groupable codes, once, for this package and the store's reader. */
export const GROUPABLE_CODES_ITEM = "QUALIFICATION_GROUPABLE_CONDITIONAL_CODES";

let held: { readonly domain: ReturnType<typeof qualificationDomain>; readonly codes: ReadonlySet<string> } | undefined;

/** The conditional reasons that leave a plugin groupable: the words of the domain's item, read at the first use and kept. */
export function groupableConditionalCodes(): ReadonlySet<string> {
  const domain = qualificationDomain();
  if (held?.domain !== domain) held = { domain, codes: new Set(domain.words(GROUPABLE_CODES_ITEM)) };
  return held.codes;
}

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
  return conditional.length > 0 && conditional.every((r) => groupableConditionalCodes().has(r.code));
}
