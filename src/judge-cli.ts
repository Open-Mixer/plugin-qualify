// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify judge <probe-output>...`: judge probe outputs already written (by
 * `plugin-hostd-probe run`, by plugin-hostd's `judge_cmd`, or by hand) and write the qualification
 * record beside a byte copy of each. `bin/plugin-qualify.mjs` only reads argv and prints.
 */
import { readFileSync } from "node:fs";

import type { HostProfile } from "./host-profiles.js";
import { judgeProbeOutput, judgmentVerdicts } from "./probe-judge.js";
import { readProbeOutput, sha256Hex } from "./probe-output.js";
import { buildQualificationRecord, probeCopyFileName, storedForm } from "./qualification-record.js";
import { StoreError, type QualificationStore, type ShadowKey } from "./qualification-store.js";
import { baseSteps } from "./qualify-isolated.js";
import type { QualifyVerdict } from "./qualify-cli.js";
import { EXIT_CODE, OUTPUT_FORMATS, type OutputFormat } from "./qualify-options.js";
import { OPENMIXER_CONSOLE_PROFILE } from "./host-profiles.js";
import { withContractPathHelp } from "./qualification-domain.js";

export interface JudgeArgs {
  readonly files: readonly string[];
  readonly hostProfiles: readonly string[];
  /** `--system`: the system scope's layer of the qualification store, else the user's. */
  readonly system: boolean;
  /** The host class the records are put under; the machine's own when absent. */
  readonly hostClass?: string;
  readonly format: OutputFormat;
  readonly help: boolean;
}

export type ParseJudgeResult = { ok: true; args: JudgeArgs } | { ok: false; error: string };

const VALUE_FLAGS = ["--host-profile", "--host-class", "--format"];

export function parseJudgeArgs(argv: readonly string[]): ParseJudgeResult {
  const files: string[] = [];
  const specs: string[] = [];
  let hostClass: string | undefined;
  let system = false;
  let format: string = "text";
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      files.push(a);
      continue;
    }
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
    else if (a === "--host-class") hostClass = v;
    else format = v;
  }
  if (!(OUTPUT_FORMATS as readonly string[]).includes(format)) return { ok: false, error: `--format must be one of ${OUTPUT_FORMATS.join(", ")}` };
  if (!help && files.length === 0) return { ok: false, error: "name at least one probe output" };
  return {
    ok: true,
    args: {
      files,
      hostProfiles: [...new Set(specs.length > 0 ? specs : [OPENMIXER_CONSOLE_PROFILE.id])],
      system,
      ...(hostClass === undefined ? {} : { hostClass }),
      format: format as OutputFormat,
      help,
    },
  };
}

export function judgeHelpText(): string {
  return withContractPathHelp(judgeHelpTextBody());
}

function judgeHelpTextBody(): string {
  return [
    "plugin-qualify judge — judge probe outputs and put the qualification records in the store",
    "",
    "  plugin-qualify judge [options] <probe-output.json>...",
    "",
    "  --host-profile <file|id>      judge against this host; repeat or comma-separate for one verdict per profile",
    `                                (default: ${OPENMIXER_CONSOLE_PROFILE.id})`,
    "  --system                      the system scope's layer of the qualification store (default: the user's)",
    "  --host-class <class>          the host class the records are put under (default: this machine's: rpi5, x86-64)",
    "  --format <json|text>          json = the records; text = plugin, verdict, deciding reason (default: text)",
    "",
    `exit ${EXIT_CODE.allQualified} all qualified / ${EXIT_CODE.someNotQualified} some not / ${EXIT_CODE.couldNotMeasure} something could not be read or judged`,
    "",
  ].join("\n");
}


export interface JudgeFilesResult {
  readonly verdicts: readonly QualifyVerdict[];
  /** The shadow key of each record put in the store. */
  readonly records: readonly ShadowKey[];
  /** Each file that was refused or could not be read, with the code or the reason. */
  readonly failures: readonly { readonly file: string; readonly problem: string }[];
}

/** Judge each file under every profile and put its record in the store; a file that does not read is a failure, and the others go on. */
export function judgeFiles(
  files: readonly string[],
  options: { profiles: readonly HostProfile[]; store: QualificationStore; hostClass: string; read?: (path: string) => Buffer },
): JudgeFilesResult {
  const read = options.read ?? ((p: string) => readFileSync(p));
  const verdicts: QualifyVerdict[] = [];
  const records: ShadowKey[] = [];
  const failures: { file: string; problem: string }[] = [];
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = read(file);
    } catch (e) {
      failures.push({ file, problem: `cannot read: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const r = readProbeOutput(bytes.toString("utf8"));
    if (!r.ok) {
      failures.push({ file, problem: `${r.code}: ${r.problem}` });
      continue;
    }
    const judgment = judgeProbeOutput(r.output, options.profiles);
    // the probe output is evidence the record names (file name, SHA-256, size); no copy of it is kept
    const made = buildQualificationRecord(judgment, { file: probeCopyFileName(r.output), sha256: sha256Hex(bytes), bytes: bytes.length });
    const record = storedForm({ ...made, run: { id: r.output.run.id, steps: baseSteps(made) } });
    const key: ShadowKey = { sha256: record.binary.sha256, format: record.plugin.format, uri: record.plugin.id, offer: r.output.offer.id, hostClass: options.hostClass };
    try {
      options.store.put(key, record);
    } catch (e) {
      if (!(e instanceof StoreError)) throw e;
      failures.push({ file, problem: e.message });
      continue;
    }
    records.push(key);
    verdicts.push(...judgmentVerdicts(judgment));
  }
  return { verdicts, records, failures };
}

/** 2 when a file could not be judged or a plugin was not measured, else 0 when every verdict qualifies, else 1. */
export function judgeExitCode(result: JudgeFilesResult): number {
  if (result.failures.length > 0 || result.verdicts.length === 0 || result.verdicts.some((v) => !v.measured)) return EXIT_CODE.couldNotMeasure;
  return result.verdicts.every((v) => v.qualified) ? EXIT_CODE.allQualified : EXIT_CODE.someNotQualified;
}
