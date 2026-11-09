// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The judged layer of a plugin-db entry, from a qualification record: plugin-qualify is that layer's one writer
 * (plugin-db docs/design/records.md). The reader never parses a record; it reads the layer this writes, so every field
 * the state function reads is set here, from the record and from what plugin-qualify declares once:
 *
 * - the latency line (`LATENCY_LINE_MS`), written beside each cell's figure (`latencyMs`), so a surface shows the
 *   figure within or over the line and keeps no tier word (openmixer plugin-system design 7.15);
 * - the rules the record was judged by (`judgementRules`), the minor of the plugin-qualify that judged it: a rule
 *   changes only in a minor, so a patch release leaves every record current;
 * - the hosting epoch of the host the verdict is for (`HOSTING_EPOCH`).
 *
 * One layer is one verdict under one host: the host plugin-hostd runs a plugin with. Its verdict is the one the pins
 * file gives the same bytes (`pinVerdictOf` of the isolated tier's host, omx-clap-host, which is plugin-hostd's
 * worker). A record whose verdict for that host was not measured has no judged layer: the reader then answers
 * unqualified, with its reason.
 */
import { judgementRules, latencyMsOf, LATENCY_LINE_MS } from "./judgement-line.js";
import { pinVerdictOf, type PinVerdict } from "./pins-file.js";
import { QUALIFICATION_RECORD_SCHEMA, ISOLATED_TIER_HOST, type QualificationRecord } from "./qualification-record.js";
import type { SuitabilityRating } from "./rating.js";

/** The host a judged layer is written for: the one that runs plugins, in workers of its own (PLUGIN_DB_ISOLATION_HOSTS). */
export const JUDGED_HOST = "plugin-hostd";

/**
 * The hosting epoch of each host a layer is written for. The epoch is the host owner's to move, when a release of it
 * changes how it hosts; plugin-hostd has declared no hosting change since records were written, so its epoch is 0.
 */
export const HOSTING_EPOCH = { [JUDGED_HOST]: 0 } as const satisfies Readonly<Record<string, number>>;

/** The plugin-db envelope version this writes (plugin-db data/store.schema.json). */
export const PLUGIN_DB_ENVELOPE = 1;

/** The pin a layer is written for, as plugin-db's pinned layer holds it. */
export interface LayerPin {
  /** The `omx-files/1` SHA-256 of the plugin's files. */
  readonly files: string;
  /** `<scheme>:<sha256>` of the parameter layout, or null when the pin holds none. */
  readonly layout: string | null;
}

export interface JudgedCell {
  readonly rate: number;
  readonly quantum: number;
  readonly latencyMs?: number;
}

export interface JudgedBody {
  readonly verdict: PinVerdict;
  readonly machineClass: string;
  readonly host: { readonly name: string; readonly version: string; readonly hostingEpoch: number };
  readonly rules: string;
  readonly recordSchema: string;
  readonly cells: readonly JudgedCell[];
  readonly conditions: Readonly<Record<string, string>>;
  readonly latencyLineMs: number;
}

export interface JudgedLayer {
  readonly envelope: typeof PLUGIN_DB_ENVELOPE;
  readonly layer: "judged";
  readonly address: string;
  readonly pin: LayerPin;
  readonly writer: "plugin-qualify";
  readonly body: JudgedBody;
}

/** What the converter is given beside the record: the class word, the pin, and the rules when the record states none. */
export interface JudgedLayerInput {
  /** The machine class word the record was measured on (`rpi5`, `x86-64`): the set's host class. */
  readonly machineClass: string;
  readonly pin: LayerPin;
  /** plugin-db's address; by default `<format>:<id>`. */
  readonly address?: string;
  /** The rules of a record that states none: the plugin-qualify version that judged its set (the set's provenance). */
  readonly judgedBy?: string;
}

/** Why a record has no judged layer, when it has none. */
export type NoLayer = { readonly layer: null; readonly reason: string };

/** The version of a tool named `<name> <version>` in the record's `tool`. */
function versionOf(record: QualificationRecord, name: string): string | undefined {
  for (const v of Object.values(record.tool)) {
    const m = new RegExp(`^${name.replace(/[-.]/g, "\\$&")} (\\S+)$`).exec(v);
    if (m) return m[1];
  }
  return undefined;
}

/** The cells of the record: each measured rate and quantum, with its latency in milliseconds when one was measured. */
export function judgedCells(record: QualificationRecord): JudgedCell[] {
  return record.measurements.grid
    .filter((p) => p.outcome === "probe.ok")
    .map((p) => {
      const frames = (p.latency as { measuredFrames?: number }).measuredFrames;
      return { rate: p.rate, quantum: p.quantum, ...(frames === undefined ? {} : { latencyMs: latencyMsOf(frames, p.rate) }) };
    });
}

/**
 * The judged layer of a record, or why there is none. The verdict is the isolated tier host's, as the pins file gives
 * it; the host is plugin-hostd at the probe runner's version, which is plugin-hostd's.
 */
export function judgedLayerOf(record: QualificationRecord, input: JudgedLayerInput): JudgedLayer | NoLayer {
  if (record.schema !== QUALIFICATION_RECORD_SCHEMA) return { layer: null, reason: `record schema ${JSON.stringify(record.schema)} is not ${QUALIFICATION_RECORD_SCHEMA}` };
  const tierHost = ISOLATED_TIER_HOST[record.plugin.format];
  const v = record.verdicts.find((r) => r.host === tierHost);
  if (v === undefined) return { layer: null, reason: `no verdict under ${tierHost ?? `a host for ${record.plugin.format}`}` };
  const verdict = v.measured ? pinVerdictOf(v.rating as SuitabilityRating) : undefined;
  if (verdict === undefined) return { layer: null, reason: `${tierHost}: not measured (${v.deciding ?? v.rating})` };
  const hostVersion = versionOf(record, "plugin-hostd-probe");
  if (hostVersion === undefined) return { layer: null, reason: "the record names no plugin-hostd-probe version" };
  const rules = record.rules ?? (input.judgedBy === undefined ? undefined : judgementRules(input.judgedBy));
  if (rules === undefined) return { layer: null, reason: "the record states no rules, and no judgedBy was given" };
  return {
    envelope: PLUGIN_DB_ENVELOPE,
    layer: "judged",
    address: input.address ?? `${record.plugin.format}:${record.plugin.id}`,
    pin: input.pin,
    writer: "plugin-qualify",
    body: {
      verdict,
      machineClass: input.machineClass,
      host: { name: JUDGED_HOST, version: hostVersion, hostingEpoch: HOSTING_EPOCH[JUDGED_HOST] },
      rules,
      recordSchema: record.schema,
      cells: judgedCells(record),
      conditions: {},
      latencyLineMs: record.latencyLineMs ?? LATENCY_LINE_MS,
    },
  };
}

export interface JudgedLayerArgs {
  readonly record: string;
  readonly machineClass: string;
  readonly files: string;
  readonly layout: string | null;
  readonly judgedBy?: string;
  readonly address?: string;
  /** Print the body only, as `plugin-db put <address> judged --writer plugin-qualify` reads it from stdin. */
  readonly body: boolean;
}

export function judgedLayerHelpText(): string {
  return [
    "usage: plugin-qualify judged-layer <record.qualification.json> --machine-class <word> --files <sha256>",
    "                                   [--layout <scheme>:<sha256>] [--judged-by <version>] [--address <address>] [--body]",
    "",
    "Print the plugin-db judged layer of a qualification record, for the pin plugin-db holds (its files digest and",
    "layout). --judged-by names the plugin-qualify that judged a record stating no rules (the set's provenance). --body",
    "prints the body only, for `plugin-db put <address> judged --writer plugin-qualify`. A record whose verdict under",
    "plugin-hostd's worker was not measured has no layer: the reason is printed and the exit status is 1.",
    "",
  ].join("\n");
}

export type ParsedJudgedLayerArgs = { ok: true; args: JudgedLayerArgs } | { ok: true; help: true } | { ok: false; error: string };

export function parseJudgedLayerArgs(argv: readonly string[]): ParsedJudgedLayerArgs {
  const opts: Record<string, string> = {};
  const files: string[] = [];
  let body = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return { ok: true, help: true };
    if (a === "--body") body = true;
    else if (["--machine-class", "--files", "--layout", "--judged-by", "--address"].includes(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return { ok: false, error: `${a} needs a value` };
      opts[a] = v;
    } else if (a.startsWith("--")) return { ok: false, error: `unknown option ${a}` };
    else files.push(a);
  }
  if (files.length !== 1) return { ok: false, error: "name one record" };
  const machineClass = opts["--machine-class"];
  const pinFiles = opts["--files"];
  if (machineClass === undefined) return { ok: false, error: "--machine-class is required" };
  if (pinFiles === undefined || !/^[0-9a-f]{64}$/.test(pinFiles)) return { ok: false, error: "--files must be the 64 hex digits of the files pin" };
  const layout = opts["--layout"] ?? null;
  if (layout !== null && !/^[^:]+:[0-9a-f]{64}$/.test(layout)) return { ok: false, error: "--layout must be <scheme>:<sha256>" };
  return {
    ok: true,
    args: {
      record: files[0]!,
      machineClass,
      files: pinFiles,
      layout,
      body,
      ...(opts["--judged-by"] === undefined ? {} : { judgedBy: opts["--judged-by"] }),
      ...(opts["--address"] === undefined ? {} : { address: opts["--address"] }),
    },
  };
}
