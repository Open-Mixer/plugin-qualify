// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The controlled vocabularies the interchange format speaks.
 *
 * This is the boring file that decides whether two projects' measurements can be merged
 * Everyone who has written an LV2 prober has invented their own
 * words for "there was nothing to measure here", so nobody's results combine. The words
 * are fixed here, each with the ONE property a merger actually needs to branch on —
 * whether the plugin has nothing to measure or whether OUR PROBE failed — and each with
 * a plain description a UI can render.
 *
 * Everything is a data table, not a switch. A consumer that meets a term it does not know
 * must be able to fall back on the `kind`, which is why the readers below return a term record
 * rather than a bare string.
 *
 * The WORDS are this package's (its `qualification` domain, contract.d/qualification/), read at
 * start-up from the installed document, in its order: a word is added there, once, and every consumer
 * reads it. What stays here is the prose, keyed by the word, so a word the document adds without a
 * description here, or a description for a word it lacks, is refused at start-up by the item's name.
 */

import { qualificationDomain, type QualificationDomain } from "../qualification-domain.js";
import { nonEmptyString } from "./guards.js";

/** Refuses, naming the item, when the code and the document do not speak the same words. */
function sameWords(item: string, words: readonly string[], known: readonly string[]): void {
  const missing = words.filter((w) => !known.includes(w));
  const extra = known.filter((w) => !words.includes(w));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${item}: the document and this build disagree on its words` +
        (missing.length > 0 ? `; the document declares ${missing.join(", ")}, which this build does not know` : "") +
        (extra.length > 0 ? `; this build knows ${extra.join(", ")}, which the document lacks` : ""),
    );
  }
}

/** Pairs each word of an item, in the document's order, with its description here. */
function described<Code extends string>(
  domain: QualificationDomain,
  item: string,
  descriptions: Readonly<Record<Code, string>>,
): readonly { readonly code: Code; readonly description: string }[] {
  const words = domain.words(item);
  sameWords(item, words, Object.keys(descriptions));
  return words.map((code) => ({ code: code as Code, description: descriptions[code as Code] }));
}

/** The words of an item, checked against the words this build writes or branches on. */
function checked<Word extends string>(domain: QualificationDomain, item: string, known: readonly Word[]): readonly Word[] {
  const words = domain.words(item);
  sameWords(item, words, known);
  return words as readonly Word[];
}

// ---------------------------------------------------------------------------
// Why a figure is absent
// ---------------------------------------------------------------------------

/**
 * What an absent figure means for a MERGE, and it is the only distinction that changes
 * behaviour:
 *
 * - `nothing-to-measure` — a property of the PLUGIN. An instrument has no audio input to
 *   drive; a meter has no audio output to read. Any prober on any machine reaches the
 *   same conclusion, so this outcome is as portable as a measurement and may override one.
 * - `probe-failed` — a property of THIS RUN. The plugin crashed the worker, timed out,
 *   refused to instantiate. It says nothing about the plugin's latency or cost, so it
 *   must NOT override a figure someone else managed to take.
 * - `not-attempted` — the run did not cover this plugin or this dimension at all. Neither
 *   a finding nor a failure; it is the shape a PARTIAL run has, and partial runs are
 *   first-class here.
 */
export type UnmeasuredKind = "nothing-to-measure" | "probe-failed" | "not-attempted";

/** The kinds, as this build branches on them: the document's item QUALIFICATION_MEASUREMENT_UNMEASURED_KINDS must declare these. */
const UNMEASURED_KINDS: readonly UnmeasuredKind[] = ["nothing-to-measure", "probe-failed", "not-attempted"];

/** One reason a figure may be absent: a word of the contract's MEASUREMENT_UNMEASURED_REASONS. */
export type UnmeasuredCode = keyof typeof UNMEASURED_DESCRIPTIONS;

/** One term of the "why is there no figure" vocabulary. */
export interface UnmeasuredTerm {
  readonly code: UnmeasuredCode;
  readonly kind: UnmeasuredKind;
  /** Plain description, English. A UI localises from `code`; this is for logs and specs. */
  readonly description: string;
}

/**
 * Every reason a figure may be absent, in plain English. These were derived from a sweep of 958
 * plugins — each one is an outcome that sweep actually produced, not a hypothetical. The words and
 * their kinds are the contract's.
 */
const UNMEASURED_DESCRIPTIONS = {
  "no-audio-in":
    "No audio input port: an instrument, a generator or an analyser. Nothing to drive.",
  "no-audio-out":
    "No audio output port: a meter or a sink. Nothing to read.",
  "silent-output":
    "Instantiated and driven, but emitted nothing under a stimulus that should have passed. " +
      "A convolver with no impulse response, a vocoder with no carrier, a gate that never opened.",
  "memory-bound":
    "A pass did not fit the memory bound the run set: that pass alone is unmeasured, the passes after it are measured.",
  "needs-content":
    "An instrument that is silent under notes until a sample, a sound font or an instrument file is loaded, which the prober did not load.",
  "needs-carrier":
    "Requires a second audio input (a carrier or side-chain) the prober did not supply.",
  "needs-impulse-response":
    "A convolver requiring an IR file the prober did not load.",
  "unpinnable":
    "The files the host loads cannot be pinned (plugin-qualify spec §11.1): a manifest using @base, a file name " +
      "longer than a pin path, or a CLAP plugin with more parameters than the host accepts. A name with a space or a " +
      "separator of pin_set is pinned percent-encoded. The plugin stays unpinned, never partly pinned.",
  "no-voices":
    "An instrument whose voice-info declares a voice capacity of 0: there is no voice to hold down, so its " +
      "cost with notes held cannot be taken.",
  "notes-unplayable":
    "An instrument whose note input reads no dialect the prober speaks (CLAP's or MIDI's): it cannot be played.",
  "voices-unknown":
    "An instrument that declares no voice capacity, measured by a run given no probe count (`--probe-notes`): " +
      "the run did not know how many notes to hold, so it timed none.",
  "refused-instantiation":
    "The plugin would not instantiate at this rate or block size.",
  "probe-crashed":
    "The probe worker died (signal or abort) while hosting this plugin.",
  "probe-timeout":
    "The probe exceeded its per-plugin time limit and was abandoned.",
  "non-finite-output":
    "Output contained NaN or infinity, so no onset or block time could be trusted.",
  "not-installed":
    "The URI was not present in this machine's LV2 world. A fact about this installation, " +
      "not about the plugin — another host may well have it.",
  "worker-nonconforming":
    "The plugin's LV2_Worker_Interface leaves work or work_response NULL, which the LV2 worker " +
      "specification does not allow: it was refused before any call, not measured.",
  "probe-error":
    "The probe reported a failure with no more specific term. Its own words are kept verbatim " +
      "in the measurement's `unmeasuredDetail`, so a coarse code never destroys the detail.",
  "not-attempted":
    "This run did not cover this plugin for this dimension. A partial run, not a finding.",
};

/** Every reason a figure may be absent, in the document's order, of the document's kind. */
function unmeasuredTermsOf(domain: QualificationDomain): readonly UnmeasuredTerm[] {
  const reasons = domain.entries("QUALIFICATION_MEASUREMENT_UNMEASURED_REASONS");
  const kinds = checked(domain, "QUALIFICATION_MEASUREMENT_UNMEASURED_KINDS", UNMEASURED_KINDS);
  sameWords("QUALIFICATION_MEASUREMENT_UNMEASURED_REASONS", reasons.map((r) => r.word), Object.keys(UNMEASURED_DESCRIPTIONS));
  return reasons.map((reason) => {
    const kind = kinds.find((k) => k === reason.group);
    if (kind === undefined) {
      throw new Error(`QUALIFICATION_MEASUREMENT_UNMEASURED_REASONS: ${reason.word} has the group ${String(reason.group)}, which is no kind this build knows`);
    }
    return { code: reason.word as UnmeasuredCode, kind, description: UNMEASURED_DESCRIPTIONS[reason.word as UnmeasuredCode] };
  });
}

// ---------------------------------------------------------------------------
// How latency moves with the sample rate
// ---------------------------------------------------------------------------

/**
 * The rate-scaling laws, DERIVED from readings at several rates and never assumed from
 * what a plugin is called. The population behind each term is in
 * `CATALOG_PROVENANCE.md`'s 2026-07-28 rows.
 */
export interface ScalingTerm {
  readonly code: string;
  readonly description: string;
}

/** A word of the document's QUALIFICATION_MEASUREMENT_LATENCY_SCALING. */
export type ScalingCode = keyof typeof SCALING_DESCRIPTIONS;

const SCALING_DESCRIPTIONS = {
  "fixed-frame": "Constant frame count at every rate — an FFT window. Milliseconds halve when the rate doubles.",
  "fixed-time": "Constant milliseconds at every rate — a look-ahead. Frames double when the rate doubles.",
  zero: "No latency a mix can notice at any measured rate.",
  nonconforming:
    "Fits neither law at a magnitude that reaches a mix: the plugin changes what it does with " +
    "the rate. Flagged rather than averaged; nothing may be projected from it.",
  "single-rate": "One usable reading, so no law can be fitted.",
  unmeasured: "No rate produced a figure.",
};

/**
 * Why a derived scaling class is not the naive fit over every reading — `below-budget`,
 * where the readings fit no law but are all small enough that the disagreement is the onset
 * detector's rather than the plugin's, and `informational-rate`, where only a reading below
 * the operational rates breaks the law (`lv2-measurement-interchange.md` §1a).
 */
const SCALING_NOTE_DESCRIPTIONS = {
  "below-budget":
    "The readings fit no law, but every one of them is inside the per-channel latency budget, " +
    "so the disagreement is measurement noise rather than plugin behaviour.",
  "informational-rate":
    "The readings together fit no law, but those at the operational rates (48 kHz and up) do; " +
    "the reading below them stays in perRate as information and does not flag the plugin.",
};

/** One of the {@link SCALING_NOTE_TERMS} codes — the words `latency.scalingNote` may carry. */
export type ScalingNoteCode = keyof typeof SCALING_NOTE_DESCRIPTIONS;

/**
 * Why one rate's reading was excluded from the fit and from every rate resolution. A
 * failed reading served as an exact answer is worse than no reading, because a zero reads
 * as confidence.
 */
const EXCLUSION_DESCRIPTIONS = {
  "impossible-zero":
    "Zero frames at this rate while another rate measured non-zero. Both scaling laws map zero " +
    "to zero, so no single latency produces this; the onset detector was defeated.",
};

// ---------------------------------------------------------------------------
// How a figure was taken
// ---------------------------------------------------------------------------

/** How a latency figure was taken: a word of the document's QUALIFICATION_MEASUREMENT_LATENCY_METHODS. */
export type LatencyMethodCode = keyof typeof LATENCY_METHOD_DESCRIPTIONS;

/** How a cost figure was taken: a word of the document's QUALIFICATION_MEASUREMENT_COST_METHODS. */
export type CostMethodCode = keyof typeof COST_METHOD_DESCRIPTIONS;

const LATENCY_METHOD_DESCRIPTIONS = {
  "impulse-onset":
    "Latency as the round-trip delay from a unit impulse to the first output sample above the " +
    "residual floor. Measures the plugin, not what it declares.",
  "declared-port": "Latency read from the plugin's own lv2:latency output port. What it CLAIMS.",
  "note-onset":
    "An instrument's latency: the delay from a note on to the first output sample above the " +
    "residual floor. Measures what the plugin does with a held note.",
};

const COST_METHOD_DESCRIPTIONS = {
  "block-time-percentile":
    "Cost as a percentile of per-block wall time under a sustained stimulus, warm-up blocks " +
    "discarded, normalised to nanoseconds per sample.",
};

/**
 * The measurable dimensions. A document declares which of them it covers.
 *
 * `latency` and `cost` are 1.0's. `stability`, `rtSafety` and `features` joined in 1.1 for the
 * hosting verdict — whether a plugin survives, whether its `run()` is RT-clean, what it
 * demands of a host — and merge under exactly the same per-plugin, per-DIMENSION precedence.
 */
export type MeasurementDimension = "latency" | "cost" | "stability" | "rtSafety" | "features";

/** The dimensions as this build branches on them: they are the keys of a measurement document. */
const DIMENSIONS: readonly MeasurementDimension[] = ["latency", "cost", "stability", "rtSafety", "features"];

/**
 * The dimensions the standalone prober (`scan.py` + `benchmark.py`, driven by `lv2-measure.mjs`
 * and the console's Setup analysis) can measure. The three hosting dimensions come from a
 * different tool — the native measurer `native/lv2-measure.c`, read by `sweep-jsonl.ts` — so a
 * run asked of the prober for `stability` would be asking it for something it cannot take.
 */
export const PROBED_DIMENSIONS = ["latency", "cost"] as const satisfies readonly MeasurementDimension[];

/**
 * The dimensions `lv2-measure.mjs`'s hosting pass measures: one run of the native measurer per
 * plugin, under the interposer, writes all three.
 */
export const HOSTING_PASS_DIMENSIONS = ["stability", "rtSafety", "features"] as const satisfies readonly MeasurementDimension[];

/**
 * The four ratings a verdict speaks (`lv2-measurement-interchange.md` §3b): the document's
 * QUALIFICATION_MEASUREMENT_VERDICT_RATINGS. The rating vocabulary (`rating.ts`) derives its type from it, so
 * the document and the classifier can never disagree on a word.
 */
export type VerdictRating = "suitable" | "conditional" | "unknown" | "unsuitable";

const RATINGS: readonly VerdictRating[] = ["suitable", "conditional", "unknown", "unsuitable"];

/** How a host runs its plugins: a word of the document's QUALIFICATION_RESOURCE_HOST_ISOLATIONS. */
export type HostIsolation = string;

/** Whether a host aligns on a plugin's reported latency (`compensated`) or only passes it on: a word of QUALIFICATION_RESOURCE_HOST_LATENCY_HANDLING. */
export type HostLatencyHandling = string;

/**
 * Where the number of notes an instrument's cost was measured with came from: `declared` is the voice
 * capacity the plugin declares (CLAP's voice-info, read after activate at that rate); `probe` is a count
 * the caller gave (`--probe-notes`, the console's `SYNTH_VOICE_PROBE_NOTES`), used when the plugin declares
 * none or when the caller asked for that count whatever it declares.
 */
export type VoiceBasis = string;

/** Every term and word list of the vocabulary, built from one opened domain. */
export function buildVocabulary(domain: QualificationDomain) {
  const unmeasured = unmeasuredTermsOf(domain);
  const method = [
    ...described(domain, "QUALIFICATION_MEASUREMENT_LATENCY_METHODS", LATENCY_METHOD_DESCRIPTIONS),
    ...described(domain, "QUALIFICATION_MEASUREMENT_COST_METHODS", COST_METHOD_DESCRIPTIONS),
  ];
  const scaling = described(domain, "QUALIFICATION_MEASUREMENT_LATENCY_SCALING", SCALING_DESCRIPTIONS);
  return {
    UNMEASURED_TERMS: unmeasured,
    UNMEASURED_BY_CODE: new Map<string, UnmeasuredTerm>(unmeasured.map((term) => [term.code, term])),
    SCALING_TERMS: scaling as readonly ScalingTerm[],
    SCALING_CODES: new Set<string>(scaling.map((t) => t.code)),
    SCALING_NOTE_TERMS: described(domain, "QUALIFICATION_MEASUREMENT_LATENCY_SCALING_NOTES", SCALING_NOTE_DESCRIPTIONS),
    EXCLUSION_TERMS: described(domain, "QUALIFICATION_MEASUREMENT_LATENCY_EXCLUSIONS", EXCLUSION_DESCRIPTIONS) as readonly ScalingTerm[],
    METHOD_TERMS: method as readonly ScalingTerm[],
    METHOD_CODES: new Set<string>(method.map((t) => t.code)),
    MEASUREMENT_DIMENSIONS: checked(domain, "QUALIFICATION_MEASUREMENT_DIMENSIONS", DIMENSIONS),
    VERDICT_RATINGS: checked(domain, "QUALIFICATION_MEASUREMENT_VERDICT_RATINGS", RATINGS),
    HOST_ISOLATIONS: domain.words("QUALIFICATION_RESOURCE_HOST_ISOLATIONS"),
    HOST_LATENCY_HANDLING: domain.words("QUALIFICATION_RESOURCE_HOST_LATENCY_HANDLING"),
    VOICE_BASES: domain.words("QUALIFICATION_MEASUREMENT_VOICE_BASES"),
  };
}

type Vocabulary = ReturnType<typeof buildVocabulary>;
let built: { readonly domain: QualificationDomain; readonly vocabulary: Vocabulary } | undefined;

/** The vocabulary of the domain in use (handed or installed), built at the first use and kept. */
function vocabulary(): Vocabulary {
  const domain = qualificationDomain();
  if (built?.domain !== domain) built = { domain, vocabulary: buildVocabulary(domain) };
  return built.vocabulary;
}

/**
 * A word list that reads the vocabulary when first used, not when this module loads, so a page may import it and then
 * hand its document with `init`; used before that, it refuses by name.
 */
function lazy<T extends readonly unknown[]>(pick: (v: Vocabulary) => T): T {
  const forward = (prop: string | symbol) => Reflect.get(pick(vocabulary()), prop, pick(vocabulary())) as unknown;
  return new Proxy([] as unknown as T, {
    get: (_t, prop) => forward(prop),
    has: (_t, prop) => prop in pick(vocabulary()),
    ownKeys: () => Reflect.ownKeys(pick(vocabulary())),
    getOwnPropertyDescriptor: (_t, prop) => {
      const d = Reflect.getOwnPropertyDescriptor(pick(vocabulary()), prop);
      return d === undefined ? undefined : { ...d, configurable: true };
    },
  });
}

export const UNMEASURED_TERMS: readonly UnmeasuredTerm[] = lazy((v) => v.UNMEASURED_TERMS);
export const SCALING_TERMS: readonly ScalingTerm[] = lazy((v) => v.SCALING_TERMS);
export const SCALING_NOTE_TERMS = lazy((v) => v.SCALING_NOTE_TERMS);
export const EXCLUSION_TERMS: readonly ScalingTerm[] = lazy((v) => v.EXCLUSION_TERMS);
/** The measurement methods the format has names for: the latency methods, then the cost methods. */
export const METHOD_TERMS: readonly ScalingTerm[] = lazy((v) => v.METHOD_TERMS);
export const MEASUREMENT_DIMENSIONS: readonly MeasurementDimension[] = lazy((v) => v.MEASUREMENT_DIMENSIONS);
export const VERDICT_RATINGS: readonly VerdictRating[] = lazy((v) => v.VERDICT_RATINGS);
export const HOST_ISOLATIONS: readonly HostIsolation[] = lazy((v) => v.HOST_ISOLATIONS);
export const HOST_LATENCY_HANDLING: readonly HostLatencyHandling[] = lazy((v) => v.HOST_LATENCY_HANDLING);
export const VOICE_BASES: readonly VoiceBasis[] = lazy((v) => v.VOICE_BASES);

/**
 * The vocabulary term for a code, or `undefined` when the code is not one of ours.
 *
 * A third-party document carrying an unknown reason is not an error — the format is meant
 * to be extended by people we will never meet. {@link unmeasuredKind} is what a merger
 * should consult, and it is deliberately conservative about strangers.
 */
export function unmeasuredTerm(code: string | undefined): UnmeasuredTerm | undefined {
  return code === undefined ? undefined : vocabulary().UNMEASURED_BY_CODE.get(code);
}

/**
 * How a merger must treat an absence reason. An UNKNOWN code resolves to `probe-failed`,
 * the conservative answer: a reason we cannot interpret must never be allowed to delete
 * somebody else's real measurement, and treating it as a plugin property would do exactly
 * that.
 */
export function unmeasuredKind(code: string | undefined): UnmeasuredKind {
  if (code === undefined) return "not-attempted";
  return vocabulary().UNMEASURED_BY_CODE.get(code)?.kind ?? "probe-failed";
}

/** True when `code` is a scaling term this version of the format defines. */
export function isKnownScalingCode(code: string): boolean {
  return vocabulary().SCALING_CODES.has(code);
}

/** True when `code` is a method term this version of the format defines. */
export function isKnownMethodCode(code: string): boolean {
  return vocabulary().METHOD_CODES.has(code);
}

/** `value` as a dimension, or `undefined` when it is not one. */
export function readDimension(value: unknown): MeasurementDimension | undefined {
  const text = nonEmptyString(value);
  return MEASUREMENT_DIMENSIONS.find((d) => d === text);
}

export function isVoiceBasis(value: unknown): value is VoiceBasis {
  return VOICE_BASES.some((b) => b === value);
}
