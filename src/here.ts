// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify here` (#56): the facts of this machine a plugin-db query is asked with, by plugin-db's own keys
 * (python3-plugin-db's query, `machineClass`, `hostName`, `hostVersion`, `hostingEpoch`, `rules`, `recordSchema`). Each
 * is its owner's and read where the sync and the judged layer read it, never restated: the host class the sync reads
 * distributed records by, the host a judged layer is written for and the version it answers installed, that host's
 * hosting epoch, the rules of this plugin-qualify and the qualification record's schema. A fact that cannot be read
 * is absent, never guessed. The rate and the quantum are the audio server's, not plugin-qualify's.
 */
import { hostClassOf, readBoardModel, readMachine } from "./distributed-records.js";
import { HOSTING_EPOCH, JUDGED_HOST } from "./judged-layer.js";
import { judgementRules } from "./judgement-line.js";
import { QUALIFICATION_RECORD_SCHEMA } from "./qualification-record.js";
import { TEXT_CODE, type TextRef } from "./text-codes.js";

/** The facts of here, by plugin-db's keys. */
export interface HereFacts {
  readonly machineClass?: string;
  readonly hostName: string;
  readonly hostVersion?: string;
  readonly hostingEpoch: number;
  readonly rules: string;
  readonly recordSchema: string;
}

/** What the facts are read from: the settings file (its host_class), the board and machine readers, the host's version. */
export interface HereInput {
  readonly file: ReadonlyMap<string, string>;
  readonly boardModel?: () => string | undefined;
  readonly machineArch?: () => string | undefined;
  readonly hostdVersion: string | undefined;
}

export function hereFacts(input: HereInput): HereFacts {
  const machineClass = hostClassOf(input.file.get("host_class"), input.boardModel ?? readBoardModel, input.machineArch ?? readMachine);
  return {
    ...(machineClass === undefined ? {} : { machineClass }),
    hostName: JUDGED_HOST,
    ...(input.hostdVersion === undefined ? {} : { hostVersion: input.hostdVersion }),
    hostingEpoch: HOSTING_EPOCH[JUDGED_HOST],
    rules: judgementRules(),
    recordSchema: QUALIFICATION_RECORD_SCHEMA,
  };
}

/** The facts as text: one `<key> <value>` line each, in the JSON's order. */
export function hereText(facts: HereFacts): string {
  return Object.entries(facts).map(([k, v]) => `${k} ${String(v)}\n`).join("");
}

export interface HereArgs {
  readonly json: boolean;
  /** `--config`: the settings file, as plugin-qualify-sync takes it. */
  readonly config?: string;
}

export function parseHereArgs(argv: readonly string[]): { ok: true; args: HereArgs } | { ok: false; error: TextRef } {
  let json = false;
  let config: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") json = true;
    else if (a === "--config") {
      config = argv[++i];
      if (config === undefined) return { ok: false, error: { code: TEXT_CODE.hereConfigFile } };
    } else return { ok: false, error: { code: TEXT_CODE.cliUnknownOption, args: { option: a } } };
  }
  return { ok: true, args: { json, ...(config === undefined ? {} : { config }) } };
}

export function hereHelpText(): string {
  return [
    "usage: plugin-qualify here [--json] [--config <file>]",
    "",
    "The facts of this machine a plugin-db query is asked with: machineClass (host_class, else the board's, else the",
    "machine's), hostName and hostVersion (plugin-hostd, as installed), hostingEpoch, rules and recordSchema. A fact that",
    "cannot be read is left out.",
    "",
    `  ${"--json".padEnd(20)}one JSON object, by plugin-db's keys`,
    `  ${"--config <file>".padEnd(20)}the settings file, as plugin-qualify-sync takes it`,
    "",
  ].join("\n");
}
