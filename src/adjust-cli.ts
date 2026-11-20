// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify adjust --history <file>`: read the records of the scope's layer of the qualification store (through the reader), read
 * plugin-hostd's running history, and write a second verdict beside each measured one, for the host class of the history,
 * with a reason code (`history-adjust.ts` holds the rules). The measurement and the measured verdicts of a record are
 * never touched: the second verdict lives in the record's `history` block, one entry per host class. `--pins` writes the
 * adjusted verdict instead of the measured one. `bin/plugin-qualify.mjs` only reads argv and prints.
 */
import { join } from "node:path";

import { findHistory, historyClasses, readHistory, type HistoryRead, type HistoryRecord } from "./history-file.js";
import { adjustVerdict, summariseHistory, type Adjustment } from "./history-adjust.js";
import type { HostProfile } from "./host-profiles.js";
import { OPENMIXER_CONSOLE_PROFILE } from "./host-profiles.js";
import { clapPinUri, pinVerdictOf, type PinEntry, type PinVerdict } from "./pins-file.js";
import { type HistoryBlock, type QualificationRecord, type RecordVerdict } from "./qualification-record.js";
import { shadowKeyOf, type QualificationStore, type ShadowKey } from "./qualification-store.js";
import type { SyncItem } from "./qualify-sync.js";
import { EXIT_CODE, OUTPUT_FORMATS, type OutputFormat } from "./qualify-options.js";
import type { SuitabilityRating } from "./rating.js";
import { withContractPathHelp } from "./qualification-domain.js";

export interface AdjustArgs {
  readonly history: string;
  readonly hostProfiles: readonly string[];
  /** `--system`: the system scope's layer of the store, else the user's. */
  readonly system: boolean;
  readonly hostClass?: string;
  readonly pins?: string;
  /** UTC seconds the history is read at; the clock when absent. */
  readonly now?: number;
  readonly format: OutputFormat;
  readonly help: boolean;
}

export type ParseAdjustResult = { ok: true; args: AdjustArgs } | { ok: false; error: string };

const VALUE_FLAGS = ["--history", "--host-profile", "--host-class", "--pins", "--now", "--format"];

export function parseAdjustArgs(argv: readonly string[]): ParseAdjustResult {
  const specs: string[] = [];
  const got = new Map<string, string>();
  let help = false;
  let system = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) return { ok: false, error: `${a}: adjust takes options only; the records are the scope's, read through the reader` };
    if (a === "--help") {
      help = true;
      continue;
    }
    if (a === "--system") {
      system = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(a)) return { ok: false, error: `unknown option ${a}` };
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) return { ok: false, error: `${a} needs a value` };
    if (a === "--host-profile") specs.push(...v.split(",").map((t) => t.trim()).filter((t) => t !== ""));
    else got.set(a, v);
  }
  const format = got.get("--format") ?? "text";
  if (!(OUTPUT_FORMATS as readonly string[]).includes(format)) return { ok: false, error: `--format must be one of ${OUTPUT_FORMATS.join(", ")}` };
  const nowText = got.get("--now");
  const now = nowText === undefined ? undefined : Number(nowText);
  if (now !== undefined && !(Number.isInteger(now) && now >= 0)) return { ok: false, error: "--now must be UTC seconds, a whole number" };
  const history = got.get("--history");
  if (!help && history === undefined) return { ok: false, error: "name the history file with --history" };
  const hostClass = got.get("--host-class");
  const pins = got.get("--pins");
  return {
    ok: true,
    args: {
      history: history ?? "",
      hostProfiles: [...new Set(specs.length > 0 ? specs : [OPENMIXER_CONSOLE_PROFILE.id])],
      system,
      ...(hostClass === undefined ? {} : { hostClass }),
      ...(pins === undefined ? {} : { pins }),
      ...(now === undefined ? {} : { now }),
      format: format as OutputFormat,
      help,
    },
  };
}

export function adjustHelpText(): string {
  return withContractPathHelp(adjustHelpTextBody());
}

function adjustHelpTextBody(): string {
  return [
    "plugin-qualify adjust — write a second verdict beside each measured one from plugin-hostd's running history",
    "",
    "  plugin-qualify adjust --history <file> [options]",
    "",
    "  --history <file>              plugin-hostd's history file ($XDG_STATE_HOME/plugin-hostd/history); required",
    "  --system                      the system scope of the qualification store (default: the user's): its layer over the base; each record read gets a `history` block",
    "  --host-profile <file|id>      adjust the verdict of this host; repeat or comma-separate (default: openmixer-console)",
    "  --host-class <class>          read only this host class of the history (arch/cores/clock); default: every class the file holds",
    "  --pins <file>                 write the pins with the ADJUSTED verdict of the first host profile; needs exactly one host class",
    "  --now <seconds>               the UTC second the history is read at (default: the clock)",
    "  --format <json|text>          json = the records; text = one row per plugin, host and host class (default: text)",
    "",
    "The measured verdicts and the measurement are never changed. History can demote in-process to isolated (a crash, xruns when",
    "grouped), isolated to refused (three solo crashes), and promote isolated to in-process only when every reason against the",
    "plugin is a cost reason and it ran steady alone. It never lifts a real-time-safety, feature or unknown verdict, or a refused one.",
    "",
    `exit ${EXIT_CODE.allQualified} done / ${EXIT_CODE.couldNotMeasure} the history, a record or an option could not be read`,
    "",
  ].join("\n");
}

/** A record of the scope (its layer over the base), with the shadow key it is held under. */
export interface RecordFile {
  readonly key: ShadowKey;
  readonly record: QualificationRecord;
}

/** The codes of a record `adjust` leaves as it is. */
export const ADJUST_CODE = {
  /** No installed item holds the record's key: its history is keyed by where the plugin is installed, which is unknown. */
  notInstalled: "adjust.not-installed",
} as const;

/** Every record of the scope through the reader, the user layer over the base: a base record is adjusted and put in the scope's layer. */
export function readRecords(store: QualificationStore): { readonly records: readonly RecordFile[] } {
  return { records: store.scopeRecords().map((s) => ({ key: shadowKeyOf(s), record: s.record })) };
}

/**
 * The install root of the installed item that holds a record's key (the store spec's section 3.7): the item of the record's
 * format and plugin whose file at the record's `binary_path` hashes to the key. The absolute path of the plugin is that root
 * joined with `binary_path`; it is never stored and never an argument. `undefined` when no installed item holds the key.
 */
export function installedRootOf(items: readonly SyncItem[], key: ShadowKey, record: QualificationRecord, hashOf: (absolutePath: string) => string | undefined): string | undefined {
  const at = record.binary.path;
  const item = items.find((i) => i.format === key.format && (i.format === "clap" ? i.files.includes(at) : i.uri === key.uri) && hashOf(join(i.root, at)) === key.sha256);
  return item?.root;
}

/** plugin-hostd's key of a record's plugin: its uri (the installed `.clap`'s path is `root` and the record's relative path) and the digest of the first file of its pin (files sorted by path, as the pin lists them). `undefined` when the record holds no whole pin. */
export function historyKeyOf(record: QualificationRecord, root: string): { readonly uri: string; readonly digest: string } | undefined {
  const files = [...record.binary.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (files.length === 0 || record.binary.layout === undefined) return undefined;
  const uri = record.plugin.format === "clap" ? clapPinUri(join(root, record.binary.path), record.plugin.id) : record.plugin.id;
  return { uri, digest: files[0]!.sha256 };
}

/** The pin verdict of a record's verdict row: `unknown` and an unmeasured row have none. */
function measuredPinVerdict(v: RecordVerdict): PinVerdict | undefined {
  return v.measured ? pinVerdictOf(v.rating as SuitabilityRating, v.reasons) : undefined;
}

/** The `history` block of one record for one host class. */
export function historyBlock(
  record: QualificationRecord,
  history: readonly HistoryRecord[],
  hostClass: string,
  profiles: readonly HostProfile[],
  options: { file: string; now: number; root: string },
): HistoryBlock {
  const key = historyKeyOf(record, options.root);
  const found = key === undefined ? undefined : findHistory(history, key.uri, key.digest, hostClass);
  const verdicts = profiles.flatMap((profile) => {
    const row = record.verdicts.find((v) => v.host === profile.id);
    if (row === undefined) return [];
    const a: Adjustment = adjustVerdict({
      measured: measuredPinVerdict(row),
      reasons: row.reasons.map((r) => ({ code: r.code, rating: r.rating })),
      record: found,
      profile,
      now: options.now,
    });
    return [{ host: profile.id, ...a }];
  });
  return {
    hostClass,
    file: options.file,
    at: new Date(options.now * 1000).toISOString(),
    ...(key === undefined ? {} : { key }),
    found: found !== undefined,
    ...(found === undefined
      ? {}
      : {
          windows: { solo: found.windowsSolo, grouped: found.windowsGrouped },
          summary: summariseHistory(found, options.now),
          ...(Object.keys(found.unknownKeys).length === 0 ? {} : { unknownKeys: found.unknownKeys }),
        }),
    verdicts,
  };
}

export interface AdjustedRecord {
  readonly key: ShadowKey;
  readonly record: QualificationRecord;
}

export type AdjustResult =
  | {
      readonly ok: true;
      readonly records: readonly AdjustedRecord[];
      /** The host classes read. */
      readonly hostClasses: readonly string[];
      readonly ignored: Extract<HistoryRead, { ok: true }>["ignored"];
      /** The records left as they are because no installed item holds their key. */
      readonly notInstalled: readonly { readonly key: ShadowKey; readonly code: typeof ADJUST_CODE.notInstalled }[];
    }
  | { readonly ok: false; readonly problem: string };

/**
 * Each record with its `history` block replaced by the blocks of the host classes read (an earlier block of a class not read
 * is kept, so two histories of two classes can be applied one after the other). The measured fields are copied as they are.
 */
export function adjustRecords(
  records: readonly RecordFile[],
  historyText: string,
  options: { profiles: readonly HostProfile[]; file: string; now: number; hostClass?: string; rootOf: (key: ShadowKey, record: QualificationRecord) => string | undefined },
): AdjustResult {
  const read = readHistory(historyText);
  if (!read.ok) return { ok: false, problem: `${options.file}: ${read.problem}` };
  const hostClasses = options.hostClass === undefined ? historyClasses(read.records) : [options.hostClass];
  if (hostClasses.length === 0) return { ok: false, problem: `${options.file} holds no record, so there is no host class to adjust for` };
  const notInstalled: { key: ShadowKey; code: typeof ADJUST_CODE.notInstalled }[] = [];
  const adjusted: AdjustedRecord[] = [];
  for (const { key, record } of records) {
    const root = options.rootOf(key, record);
    if (root === undefined) {
      notInstalled.push({ key, code: ADJUST_CODE.notInstalled });
      continue;
    }
    const fresh = hostClasses.map((c) => historyBlock(record, read.records, c, options.profiles, { file: options.file, now: options.now, root }));
    const kept = (record.history ?? []).filter((b) => !hostClasses.includes(b.hostClass));
    adjusted.push({ key, record: { ...record, history: [...kept, ...fresh].sort((a, b) => (a.hostClass < b.hostClass ? -1 : a.hostClass > b.hostClass ? 1 : 0)) } });
  }
  return { ok: true, records: adjusted, hostClasses, ignored: read.ignored, notInstalled };
}

/** The adjusted verdict of a record's host for a host class: the pin verdict, `null` when it has none, `undefined` when the record holds no block for the pair. */
export function adjustedVerdictOf(record: QualificationRecord, hostClass: string, host: string): PinVerdict | null | undefined {
  return record.history?.find((b) => b.hostClass === hostClass)?.verdicts.find((v) => v.host === host)?.adjusted;
}

/**
 * The pin entries of adjusted records for one host and one host class: the integrity is the record's, the verdict is the
 * ADJUSTED one. A record with no verdict row for the host is pinned without a verdict word, as a run without one is.
 */
export function adjustedPinEntries(records: readonly AdjustedRecord[], hostClass: string, host: string): PinEntry[] {
  return records.flatMap(({ record }) => {
    const key = record.history?.find((b) => b.hostClass === hostClass)?.key;
    if (key === undefined) return [];
    const adjusted = adjustedVerdictOf(record, hostClass, host);
    return [
      {
        uri: key.uri,
        integrity: {
          ...(record.testedVersion === undefined ? {} : { version: record.testedVersion }),
          files: [...record.binary.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
          layout: record.binary.layout!,
        },
        ...(adjusted === null || adjusted === undefined ? {} : { verdict: adjusted }),
      },
    ];
  });
}

/** One row per plugin, host and host class: the measured verdict, the adjusted one, the reason. */
export function adjustTable(records: readonly AdjustedRecord[]): string {
  const rows = records.flatMap(({ record }) =>
    (record.history ?? []).flatMap((b) =>
      b.verdicts.map((v) => [record.plugin.id, v.host, b.hostClass, v.measured ?? "-", v.adjusted ?? "-", v.reason]),
    ),
  );
  const head = ["plugin", "host", "host class", "measured", "adjusted", "reason"];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: readonly string[]): string => r.map((c, i) => c.padEnd(width[i]!)).join("  ").trimEnd();
  return [line(head), ...rows.map(line), ""].join("\n");
}
