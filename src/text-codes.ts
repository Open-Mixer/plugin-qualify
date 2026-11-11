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

export interface TextCode {
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
    compareRtNotReported: {
      code: "qualify.compare.rt-not-reported",
      doc: "no process of the host reported to rt_watch.so at all",
      text: { en: "no process of the host reported (rt_watch.so was not loaded, or the host was gone)" },
      args: [],
    },
    compareRtNoCallback: {
      code: "qualify.compare.rt-no-callback",
      doc: "a process of the host reported, but none set a JACK process callback rt_watch.so could wrap",
      text: { en: "no process of the host set a JACK process callback that rt_watch.so could wrap" },
      args: [],
    },
    compareRtNoWarmUp: {
      code: "qualify.compare.rt-no-warm-up",
      doc: "the process callback reported, but never ran a cycle past its warm-up window",
      text: { en: "the process callback never ran past its warm-up" },
      args: [],
    },
    compareRtTrylocksOnly: {
      code: "qualify.compare.rt-trylocks-only",
      doc: "the audio thread took no allocation, lock or syscall, but tried a lock that never waits",
      text: { en: "{trylocks} try-locks on the audio thread over {cycles} cycles; a try-lock never waits" },
      args: ["trylocks", "cycles"],
    },
    compareRtUnsafe: {
      code: "qualify.compare.rt-unsafe",
      doc: "the audio thread took an allocation, a lock or a syscall over the armed cycles",
      text: { en: "on the audio thread over {cycles} cycles: {allocations} allocations, {locks} locks, {syscalls} system calls" },
      args: ["cycles", "allocations", "locks", "syscalls"],
    },
    compareLoadHostEnded: {
      code: "qualify.compare.load-host-ended",
      doc: "the host ended while a plugin was loading",
      text: { en: "the host ended ({died})" },
      args: ["died"],
    },
    compareLoadResp: {
      code: "qualify.compare.load-resp",
      doc: "the host answered a load with a reply code, not ok",
      text: { en: "resp {resp}" },
      args: ["resp"],
    },
    compareLoadTimeout: {
      code: "qualify.compare.load-timeout",
      doc: "the host gave no answer to a load within the timeout",
      text: { en: "no answer in time" },
      args: [],
    },
    compareNotLoaded: {
      code: "qualify.compare.not-loaded",
      doc: "a check that needs the plugin loaded, when it did not",
      text: { en: "it did not load" },
      args: [],
    },
    compareNoPort: {
      code: "qualify.compare.no-port",
      doc: "the plugin loaded, but no port of it appeared on the JACK graph",
      text: { en: "no port of the plugin appeared on the graph" },
      args: [],
    },
    compareNotRunning: {
      code: "qualify.compare.not-running",
      doc: "a check that needs the plugin running (loaded with a port on the graph), when it was not",
      text: { en: "it is not running" },
      args: [],
    },
    compareNoAudioOutput: {
      code: "qualify.compare.no-audio-output",
      doc: "the output check on a plugin with no audio output port",
      text: { en: "the plugin has no audio output" },
      args: [],
    },
    compareOutputNotFinite: {
      code: "qualify.compare.output-not-finite",
      doc: "the output held a NaN or infinite sample",
      text: { en: "the output is not finite ({count} NaN or infinite samples)" },
      args: ["count"],
    },
    compareNoStimulusSilent: {
      code: "qualify.compare.no-stimulus-silent",
      doc: "a plugin that takes no audio or MIDI input, so no stimulus is possible, and its output was silent regardless",
      text: { en: "no stimulus this plugin takes (no audio or MIDI input), and its output was silent" },
      args: [],
    },
    compareSilentUnderStimulus: {
      code: "qualify.compare.silent-under-stimulus",
      doc: "a plugin that takes a stimulus but gave no audible output under it",
      text: { en: "silent under {stimulus}" },
      args: ["stimulus"],
    },
    compareCyclesNotRun: {
      code: "qualify.compare.cycles-not-run",
      doc: "the load and unload cycles did not run, so the check is not-run rather than pass or fail",
      text: { en: "the cycles did not run" },
      args: [],
    },
    compareCycleHostEnded: {
      code: "qualify.compare.cycle-host-ended",
      doc: "the host ended during one of the load and unload cycles",
      text: { en: "the host ended at cycle {cycle} ({died})" },
      args: ["cycle", "died"],
    },
    compareCycleFailed: {
      code: "qualify.compare.cycle-failed",
      doc: "one load and unload cycle failed, with no named step",
      text: { en: "cycle {cycle} failed" },
      args: ["cycle"],
    },
    compareCycleFailedAt: {
      code: "qualify.compare.cycle-failed-at",
      doc: "one load and unload cycle failed at a named step",
      text: { en: "cycle {cycle} failed at {step}" },
      args: ["cycle", "step"],
    },
    compareSoakHostEnded: {
      code: "qualify.compare.soak-host-ended",
      doc: "the host ended during the soak, with a named reason",
      text: { en: "the host ended during the soak ({died})" },
      args: ["died"],
    },
    compareSoakEnded: {
      code: "qualify.compare.soak-ended",
      doc: "the host ended during the soak, with no named reason",
      text: { en: "the host ended during the soak" },
      args: [],
    },
    compareLatencyPortObservable: {
      code: "qualify.compare.latency-port-observable",
      doc: "a host (omx-clap-host, jalv) that sets a JACK latency callback itself",
      text: { en: "the host sets a JACK latency callback: the plugin's latency is on its output port's capture range" },
      args: [],
    },
    compareLatencyHostdPortObservable: {
      code: "qualify.compare.latency-hostd-port-observable",
      doc: "plugin-hostd: its worker (omx-clap-host) sets the JACK latency callback on its behalf",
      text: { en: "its worker (omx-clap-host) sets a JACK latency callback" },
      args: [],
    },
    compareLatencyNotObservableModHost: {
      code: "qualify.compare.latency-not-observable-mod-host",
      doc: "mod-host sets no JACK latency callback, so this host's reported latency is never observable",
      text: { en: "mod-host sets no JACK latency callback, so a plugin's latency is not on its ports" },
      args: [],
    },
    compareLatencyUnreadable: {
      code: "qualify.compare.latency-unreadable",
      doc: "a host whose latency is observable in principle, but the output port's latency could not be read this run",
      text: { en: "the output port's latency could not be read" },
      args: [],
    },
    compareSkippedReason: {
      code: "qualify.compare.skipped-reason",
      doc: "the summary table's row for a host it skipped, with that host's own reason already rendered",
      text: { en: "skipped: {reason}" },
      args: ["reason"],
    },
    compareDoesBetterOn: {
      code: "qualify.compare.does-better-on",
      doc: "the summary table's line naming how many plugins a host does better on, with the rendered beat list",
      text: { en: "{host} does better on {count}: {detail}" },
      args: ["host", "count", "detail"],
    },
    compareBeatDescription: {
      code: "qualify.compare.beat-description",
      doc: "one plugin of a does-better-on list, with the hosts it beat",
      text: { en: "{id} ({on} over {over})" },
      args: ["id", "on", "over"],
    },
    compareNotPublishableWithMissing: {
      code: "qualify.compare.not-publishable-with-missing",
      doc: "the summary table's closing line when --publish was asked for but a reference host is missing",
      text: { en: "not publishable: {missing}" },
      args: ["missing"],
    },
    compareNotPublishableNoFlag: {
      code: "qualify.compare.not-publishable-no-flag",
      doc: "the summary table's closing line when --publish was never asked for",
      text: { en: "not publishable (no --publish)" },
      args: [],
    },
    pinHostdNotInstalled: {
      code: "qualify.pin.hostd-not-installed",
      doc: "plugin-hostd --pin-files could not run because plugin-hostd is not installed",
      text: { en: "plugin-hostd is not installed: the files of a pin are plugin-hostd's to name" },
      args: [],
    },
    pinHostdNoPinFiles: {
      code: "qualify.pin.hostd-no-pin-files",
      doc: "the installed plugin-hostd predates --pin-files (0.15.0)",
      text: { en: "this plugin-hostd has no --pin-files (plugin-hostd 0.15.0 or later names the files of a pin)" },
      args: [],
    },
    pinHostdExited: {
      code: "qualify.pin.hostd-exited",
      doc: "plugin-hostd --pin-files exited with no stderr line to say why",
      text: { en: "plugin-hostd --pin-files exited {status}" },
      args: ["status"],
    },
    pinHostdNoRootOrFile: {
      code: "qualify.pin.hostd-no-root-or-file",
      doc: "plugin-hostd --pin-files exited ok, but its output named no root or no file",
      text: { en: "plugin-hostd --pin-files printed no root or no file" },
      args: [],
    },
    pinFileUnreadable: {
      code: "qualify.pin.file-unreadable",
      doc: "a file plugin-hostd named for the pin could not be read (and so hashed) from the bundle",
      text: { en: "a file plugin-hostd names cannot be read: {error}" },
      args: ["error"],
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
