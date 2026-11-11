// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * plugin-qualify's own verdict and reason sentences, as codes (omx-contract#2, "codes then catalogs", owner
 * ruling 2026-11-09: a code carries its identifier, its arguments and one source sentence in English with named
 * placeholders; translations live in catalogs the owner ships, keyed by code, checked for placeholders against the
 * code's `args`; a surface looks up the sentence for the user's locale and falls back to this source sentence).
 *
 * plugin-qualify is the owner of these codes (the hosting.* codes of {@link ../hosting-codes.js} are omx-clap-core's
 * instead, and that package owns their catalogs). `catalogs/ca.json` and `catalogs/es.json`, read by
 * {@link ../text-catalog.js}, are this table's translations; `src/text-catalog-conformance.test.ts` turns red on a
 * code here without a catalog entry in each language, or a catalog entry whose placeholder is not one of its code's
 * `args`.
 */

interface TextCode {
  readonly code: string;
  readonly doc: string;
  readonly text: { readonly en: string };
  readonly args: readonly string[];
}

/** One English source sentence per code, with its placeholders named in `args`: the shape omx-contract's own tables use. */
export const TEXT_CODES = Object.freeze({
  kind: "codes",
  codes: {
    compareHostNotInstalled: {
      code: "qualify.compare.host-not-installed",
      doc: "a comparison host is not installed, and the observation named no reason of its own",
      text: { en: "{program} is not installed" },
      args: ["program"],
    },
    compareHostDidNotStart: {
      code: "qualify.compare.host-did-not-start",
      doc: "a comparison host failed to start, and the observation named no reason of its own",
      text: { en: "{program} did not start" },
      args: ["program"],
    },
    compareHostNotAsked: {
      code: "qualify.compare.host-not-asked",
      doc: "a reference host a publishable comparison needs was left out of --hosts",
      text: { en: "not asked for with --hosts" },
      args: [],
    },
    compareHostDidNotRun: {
      code: "qualify.compare.host-did-not-run",
      doc: "a directory of comparison records holds no row, of any status, for this host",
      text: { en: "{program} did not run" },
      args: ["program"],
    },
    compareFormatNotTaken: {
      code: "qualify.compare.format-not-taken",
      doc: "a host was asked to run a plugin whose format it never takes",
      text: { en: "{program} takes no {format} plugin" },
      args: ["program", "format"],
    },
  } satisfies Readonly<Record<string, TextCode>>,
} as const);

/** {@link TEXT_CODES}'s codes, flattened to `key: code`, for a call site that only needs the identifier. */
export const TEXT_CODE: Readonly<Record<keyof typeof TEXT_CODES.codes, string>> = Object.fromEntries(
  Object.entries(TEXT_CODES.codes).map(([key, c]) => [key, c.code]),
) as Readonly<Record<keyof typeof TEXT_CODES.codes, string>>;

/** A code of {@link TEXT_CODE} with the arguments its source sentence names. A reader renders it; it is never prose itself. */
export interface TextRef {
  readonly code: string;
  readonly args?: Readonly<Record<string, string | number>>;
}

/**
 * A reason as plugin-qualify writes it: its own sentence as a {@link TextRef}, or another tool's own words passed
 * through unclassified (the shape `UnmeasuredFigure.detail` already uses elsewhere: a prober's raw text is never
 * coded, since nothing here can translate words it did not write).
 */
export type ReasonText = TextRef | string;
