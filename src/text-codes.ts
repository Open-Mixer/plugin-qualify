// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * plugin-qualify's own verdict and reason sentences, as codes (omx-contract#2, "codes then catalogs", owner
 * ruling 2026-11-09: a code carries its identifier, its arguments and one source sentence in English with named
 * placeholders; translations live in catalogs the owner ships, keyed by code, checked for placeholders against the
 * code's `args`; a surface looks up the sentence for the user's locale and falls back to this source sentence).
 *
 * plugin-qualify is the owner of these codes (the hosting.* codes of {@link ../hosting-codes.js} are omx-clap-core's
 * instead, and that package owns their catalogs). A code, its args and its source sentence are written once, in
 * `schema/codes.json`; {@link TEXT_CODE} is that file's `key: code` map, generated (`tools/gen-text-codes.mjs`), so a
 * call site names a code by its key and no sentence is written in a module. `catalogs/<lang>.json`, read by
 * {@link ../text-catalog.js}, hold each listed language's sentences; `src/text-catalog-conformance.test.ts` turns red
 * on a code without its source sentence or without an entry in a language, and on a sentence whose placeholders are
 * not its code's `args`.
 */
import { TEXT_CODE, TEXT_CODE_ARGS } from "./text-codes.generated.js";

export { TEXT_CODE, TEXT_CODE_ARGS };

/** A key of {@link TEXT_CODE}. */
export type TextCodeKey = keyof typeof TEXT_CODE;

/** A code of {@link TEXT_CODE} with the arguments its source sentence names. A reader renders it; it is never prose itself. */
export interface TextRef {
  readonly code: string;
  /** An argument may be another code, an inner problem said in the same language as the sentence it fills. */
  readonly args?: Readonly<Record<string, string | number | TextRef>>;
}

/**
 * A reason as plugin-qualify writes it: its own sentence as a {@link TextRef}, or another tool's own words passed
 * through unclassified (the shape `UnmeasuredFigure.detail` already uses elsewhere: a prober's raw text is never
 * coded, since nothing here can translate words it did not write).
 */
export type ReasonText = TextRef | string;
