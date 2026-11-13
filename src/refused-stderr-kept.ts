// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * #6's conformance check: a refused row's cause must be readable from the record directory itself,
 * not summed to a byte count in the probe copy's `logs` entry. #311 copies a child's stderr beside
 * its record (`stderrCopyFileName`) so the bytes `logs` counts can still be read back; this walks a
 * records directory and names every refused row where that reading still fails: the count is zero
 * (nothing was ever captured) or the count is positive but no copy answers it (the count was kept,
 * the words were not).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readProbeOutput, sha256Hex, PROBE_OK } from "./probe-output.js";
import { stderrCopyFileName, type QualificationRecord } from "./qualification-record.js";

export type StderrKeptProblem = "empty-stderr" | "log-line-not-kept";

export interface StderrKeptFinding {
  readonly record: string;
  readonly plugin: string;
  readonly problem: StderrKeptProblem;
  readonly detail: string;
}

interface ProbeLogEntry {
  readonly name?: string;
  readonly sha256?: string;
  readonly bytes?: number;
}

const isRefused = (record: QualificationRecord): boolean => record.probe.outcome !== PROBE_OK || record.verdicts.some((v) => !v.qualified);

/** Every `*.qualification.json` in `dir`, refused rows only, with its parsed record. */
function refusedRecords(dir: string): { readonly file: string; readonly record: QualificationRecord }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".qualification.json"))
    .map((file) => ({ file, record: JSON.parse(readFileSync(join(dir, file), "utf8")) as QualificationRecord }))
    .filter((r) => isRefused(r.record));
}

/**
 * Every refused row in `dir` whose child's own words are not readable back from disk: a row whose every run's stderr
 * was never kept, and a row whose `logs` count bytes a copy beside the record does not answer.
 */
export function checkStderrKept(dir: string): StderrKeptFinding[] {
  const findings: StderrKeptFinding[] = [];
  for (const { file, record } of refusedRecords(dir)) {
    const probePath = join(dir, record.probe.file);
    if (!existsSync(probePath)) {
      findings.push({ record: file, plugin: record.plugin.id, problem: "empty-stderr", detail: `${record.probe.file}: the probe copy named by the record is not beside it` });
      continue;
    }
    const probeText = readFileSync(probePath, "utf8");
    const read = readProbeOutput(probeText);
    if (!read.ok) {
      findings.push({ record: file, plugin: record.plugin.id, problem: "empty-stderr", detail: `${record.probe.file}: ${read.problem}` });
      continue;
    }
    const probeDoc = JSON.parse(probeText) as { readonly logs?: readonly ProbeLogEntry[] };
    const logs: readonly ProbeLogEntry[] = Array.isArray(probeDoc.logs) ? probeDoc.logs : [];
    const written = logs.filter((l) => (l.bytes ?? 0) > 0);
    if (written.length === 0) {
      findings.push({ record: file, plugin: record.plugin.id, problem: "empty-stderr", detail: "refused, and no run's child printed anything on stderr" });
      continue;
    }
    for (const entry of written) {
      const name = entry.name ?? "stderr";
      if (entry.sha256 === undefined) {
        findings.push({ record: file, plugin: record.plugin.id, problem: "log-line-not-kept", detail: `${name}: ${String(entry.bytes)} bytes counted, no SHA-256 to find a copy by` });
        continue;
      }
      const copyPath = join(dir, stderrCopyFileName(read.output, entry.sha256));
      if (!existsSync(copyPath)) {
        findings.push({ record: file, plugin: record.plugin.id, problem: "log-line-not-kept", detail: `${name}: ${String(entry.bytes)} bytes counted, no copy at ${stderrCopyFileName(read.output, entry.sha256)}` });
        continue;
      }
      const copied = readFileSync(copyPath);
      if (copied.length === 0 || sha256Hex(copied) !== entry.sha256) {
        findings.push({ record: file, plugin: record.plugin.id, problem: "log-line-not-kept", detail: `${name}: the copy at ${stderrCopyFileName(read.output, entry.sha256)} is empty or does not match the count` });
      }
    }
  }
  return findings;
}
