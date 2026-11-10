// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { fixtureJson } from "./probe-output-fixtures.js";
import { PROBE_OK, readProbeOutput } from "./probe-output.js";
import { stderrCopyFileName } from "./qualification-record.js";
import { checkStderrKept } from "./refused-stderr-kept.js";

const scratch = mkdtempSync(join(tmpdir(), "refused-stderr-kept-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** `plugin-crash`'s document (a refused run with steps but no figures), its `logs` replaced with `logs`. */
function crashProbeText(logs: unknown): string {
  const doc = fixtureJson("plugin-crash");
  if (logs === undefined) delete doc["logs"];
  else doc["logs"] = logs;
  return JSON.stringify(doc);
}

/** The fields `checkStderrKept` reads from a `*.qualification.json`; the rest of the record does not matter to it. */
function fakeRecord(probeFile: string, opts: { outcome?: string; qualified?: boolean } = {}): unknown {
  return {
    schema: "qualification-record/1",
    plugin: { format: "lv2", id: "test.plugin" },
    verdicts: [{ host: "omx-clap-host", measured: true, rating: "unknown", qualified: opts.qualified ?? false, hosting: "isolated", reasons: [] }],
    probe: { file: probeFile, sha256: "0".repeat(64), bytes: 0, protocol: { name: "p", version: 1 }, outcome: opts.outcome ?? "probe.crashed", complete: false, machineClass: {}, meetsProtocol: false },
  };
}

function makeCase(name: string, probeText: string, record: unknown): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "p.json"), probeText);
  writeFileSync(join(dir, "p.qualification.json"), JSON.stringify(record));
  return dir;
}

describe("checkStderrKept: a refused row whose child's own words are not readable back from disk", () => {
  it("finds nothing when the stderr a refused row's logs count is kept beside the record", () => {
    const content = Buffer.from("boom at rate 48000, quantum 128\n");
    const digest = sha(content);
    const text = crashProbeText([{ name: "stderr", sha256: digest, bytes: content.length }]);
    const output = readProbeOutput(text);
    if (!output.ok) throw new Error(output.problem);
    const dir = makeCase("clean", text, fakeRecord("p.json"));
    writeFileSync(join(dir, stderrCopyFileName(output.output, digest)), content);
    expect(checkStderrKept(dir)).toEqual([]);
  });

  it("skips a row that was not refused, even with no stderr kept at all", () => {
    const dir = makeCase("not-refused", crashProbeText([]), fakeRecord("p.json", { outcome: PROBE_OK, qualified: true }));
    expect(checkStderrKept(dir)).toEqual([]);
  });

  it("names empty-stderr when the refused row's probe copy is not beside the record", () => {
    const dir = makeCase("missing-probe", crashProbeText([]), fakeRecord("absent.json"));
    unlinkSync(join(dir, "p.json"));
    expect(checkStderrKept(dir)).toEqual([
      { record: "p.qualification.json", plugin: "test.plugin", problem: "empty-stderr", detail: expect.stringContaining("not beside it") },
    ]);
  });

  it("names empty-stderr when the probe copy is not a probe output the reader accepts", () => {
    const dir = makeCase("bad-json", "not json at all", fakeRecord("p.json"));
    const findings = checkStderrKept(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ problem: "empty-stderr", detail: expect.stringContaining("not JSON") });
  });

  it("names empty-stderr when no run's child printed anything on stderr", () => {
    const dir = makeCase("no-logs", crashProbeText(undefined), fakeRecord("p.json"));
    expect(checkStderrKept(dir)).toEqual([
      { record: "p.qualification.json", plugin: "test.plugin", problem: "empty-stderr", detail: "refused, and no run's child printed anything on stderr" },
    ]);
  });

  it("names log-line-not-kept when a byte count has no SHA-256 to find a copy by", () => {
    const dir = makeCase("no-sha", crashProbeText([{ name: "stderr", bytes: 12 }]), fakeRecord("p.json"));
    expect(checkStderrKept(dir)).toEqual([
      { record: "p.qualification.json", plugin: "test.plugin", problem: "log-line-not-kept", detail: expect.stringContaining("no SHA-256 to find a copy by") },
    ]);
  });

  it("names log-line-not-kept when the copy the SHA-256 names is not on disk", () => {
    const content = Buffer.from("never written\n");
    const digest = sha(content);
    const text = crashProbeText([{ name: "stderr", sha256: digest, bytes: content.length }]);
    const dir = makeCase("missing-copy", text, fakeRecord("p.json"));
    expect(checkStderrKept(dir)).toEqual([
      { record: "p.qualification.json", plugin: "test.plugin", problem: "log-line-not-kept", detail: expect.stringContaining("no copy at") },
    ]);
  });

  it("names log-line-not-kept when the copy on disk does not match the count", () => {
    const content = Buffer.from("the real words\n");
    const digest = sha(content);
    const text = crashProbeText([{ name: "stderr", sha256: digest, bytes: content.length }]);
    const output = readProbeOutput(text);
    if (!output.ok) throw new Error(output.problem);
    const dir = makeCase("mismatched-copy", text, fakeRecord("p.json"));
    writeFileSync(join(dir, stderrCopyFileName(output.output, digest)), Buffer.from("not what was counted"));
    expect(checkStderrKept(dir)).toEqual([
      { record: "p.qualification.json", plugin: "test.plugin", problem: "log-line-not-kept", detail: expect.stringContaining("empty or does not match") },
    ]);
  });

  it("names log-line-not-kept when the copy on disk is empty", () => {
    const content = Buffer.from("the real words\n");
    const digest = sha(content);
    const text = crashProbeText([{ name: "stderr", sha256: digest, bytes: content.length }]);
    const output = readProbeOutput(text);
    if (!output.ok) throw new Error(output.problem);
    const dir = makeCase("empty-copy", text, fakeRecord("p.json"));
    writeFileSync(join(dir, stderrCopyFileName(output.output, digest)), Buffer.alloc(0));
    expect(checkStderrKept(dir)).toEqual([
      { record: "p.qualification.json", plugin: "test.plugin", problem: "log-line-not-kept", detail: expect.stringContaining("empty or does not match") },
    ]);
  });
});
