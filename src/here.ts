// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify here --json`: the facts of this machine as `plugin-db query` takes them (plugin-db docs/design
 * records.md), read from exactly where the judged layer's writer reads them (`judged-layer.ts`,
 * `judgement-line.ts`), so a layer the sync just put is current under the facts this prints:
 *
 * - `machineClass` — the board's own from the device tree (`rpi5`), else the architecture's (`x86-64`); none on a
 *   machine neither names, and `here` prints why and exits 1.
 * - `hostName`/`hostingEpoch` — plugin-hostd's, `JUDGED_HOST`/`HOSTING_EPOCH` (`judged-layer.ts`).
 * - `hostVersion` — the probe runner's own version, the same `plugin-hostd-probe` a judged layer's `host.version`
 *   is (`versionOf`, `judged-layer.ts`): read live here by running it, never guessed from a record.
 * - `rules`/`recordSchema` — `judgementRules()` and `QUALIFICATION_RECORD_SCHEMA`.
 */
import { spawnSync } from "node:child_process";

import { hostClassOfBoard, hostClassOfMachine, readBoardModel, readMachine } from "./distributed-records.js";
import { HOSTING_EPOCH, JUDGED_HOST } from "./judged-layer.js";
import { judgementRules } from "./judgement-line.js";
import { PROBE_RUNNER_DEFAULT, PROBE_RUNNER_ENV } from "./qualify-declarations.js";
import { QUALIFICATION_RECORD_SCHEMA } from "./qualification-record.js";

export interface HereFacts {
  readonly machineClass: string;
  readonly hostName: string;
  readonly hostVersion: string;
  readonly hostingEpoch: number;
  readonly rules: string;
  readonly recordSchema: string;
}

/** What a program answers to `--version`: its status, and the text of stdout and stderr together. */
export type HereRun = (tool: string) => { readonly status: number | null; readonly stdout: string };

const SPAWNED_PROBE_VERSION: HereRun = (tool) => {
  const r = spawnSync(tool, ["--version"], { encoding: "utf8", timeout: 10000, killSignal: "SIGKILL" });
  return { status: r.status, stdout: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
};

const parseVersion = (text: string): string | undefined => /version:?\s+(\S+)/.exec(text)?.[1];

export type HereResult = { readonly ok: true; readonly facts: HereFacts } | { readonly ok: false; readonly reason: string };

/** The facts of this machine, or why they cannot all be said. */
export function hereFacts(
  env: Readonly<Record<string, string | undefined>> = process.env,
  boardModel: () => string | undefined = readBoardModel,
  machineArch: () => string | undefined = readMachine,
  run: HereRun = SPAWNED_PROBE_VERSION,
): HereResult {
  const machineClass = hostClassOfBoard(boardModel()) ?? hostClassOfMachine(machineArch());
  if (machineClass === undefined) return { ok: false, reason: "this machine's class is not known: no Raspberry Pi device-tree model, and no recognized machine architecture" };
  const tool = env[PROBE_RUNNER_ENV] ?? PROBE_RUNNER_DEFAULT;
  const r = run(tool);
  const hostVersion = r.status === 0 ? parseVersion(r.stdout) : undefined;
  if (hostVersion === undefined) return { ok: false, reason: `${tool} --version names no version, so here cannot say which host it is under` };
  return {
    ok: true,
    facts: { machineClass, hostName: JUDGED_HOST, hostVersion, hostingEpoch: HOSTING_EPOCH[JUDGED_HOST], rules: judgementRules(), recordSchema: QUALIFICATION_RECORD_SCHEMA },
  };
}

export interface HereArgs {
  readonly json: boolean;
}

export type ParsedHereArgs = { readonly ok: true; readonly args: HereArgs } | { readonly ok: true; readonly help: true } | { readonly ok: false; readonly error: string };

export function parseHereArgs(argv: readonly string[]): ParsedHereArgs {
  let json = false;
  for (const a of argv) {
    if (a === "--help" || a === "-h") return { ok: true, help: true };
    else if (a === "--json") json = true;
    else return { ok: false, error: `unknown option ${a}` };
  }
  return { ok: true, args: { json } };
}

export function hereHelpText(): string {
  return [
    "usage: plugin-qualify here [--json]",
    "",
    "Print the facts of this machine as plugin-db query takes them: machineClass, hostName, hostVersion, hostingEpoch,",
    "rules, recordSchema. They are read where the judged layer's writer reads them, so a layer the sync just put is",
    "current under the facts this prints. A machine with no class prints why and exits 1.",
    "",
  ].join("\n");
}
