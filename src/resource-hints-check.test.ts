// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A plugin's declared resource hints against what plugin-qualify measured (#198): the comparison per hint, the scan's
 * `resource_hints` read into a target, and the comparison carried into the qualification record.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { OMX_CLAP_HOST_PROFILE } from "./host-profiles.js";
import { clapLoader } from "./clap-loader.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { fixtureText } from "./probe-output-fixtures.js";
import { readProbeOutput, type ProbeGridPoint } from "./probe-output.js";
import { buildQualificationRecord } from "./qualification-record.js";
import { RESOURCE_HINT_MEMORY_SLACK_KB, RESOURCE_HINT_MEMORY_TOLERANCE } from "./qualify-declarations.js";
import { checkResourceHints, memoryWithinHint, readScanResourceHints, type ResourceHintRow } from "./resource-hints-check.js";

const MIB = 1024 * 1024;

/** omx-clap-scan's `resource_hints`, as its `put_resource_hints` prints it: every hint, null when unknown. */
function scanHints(figures: Partial<Record<string, number | boolean>>, refused?: string): Record<string, unknown> {
  const units: Record<string, string> = {
    "footprint-at-rest": "bytes", "footprint-per-voice": "bytes", "shared-load": "bytes", "threads-spawned": "count",
    "streams-from-disk": "flag", "opens-sockets": "flag", "activate-time": "ms",
  };
  const out: Record<string, unknown> = { declared: Object.keys(figures).length, ...(refused === undefined ? {} : { refused }) };
  for (const [word, unit] of Object.entries(units)) out[word] = { unit, figure: figures[word] ?? null };
  return out;
}

const cell = (rate: number, quantum: number, extra: Partial<ProbeGridPoint>): ProbeGridPoint => ({ rate, quantum, outcome: "probe.ok", ...extra });

const row = (rows: readonly ResourceHintRow[], hint: string): ResourceHintRow | undefined => rows.find((r) => r.hint === hint);

describe("a declared hint against its measurement", () => {
  const grid = [
    cell(48000, 128, { memory: { atRestKb: 2048, notesHeldKb: 2048 + 4 * 512, notesHeld: 4 }, rtSafety: { interposer: true, ownThreads: 1 } }),
    cell(96000, 128, { memory: { atRestKb: 3072 }, rtSafety: { interposer: true, ownThreads: 2 } }),
  ];

  it("a figure the measurement bears out agrees, at the cell that took the largest figure", () => {
    const d = readScanResourceHints(scanHints({ "footprint-at-rest": 3 * MIB, "footprint-per-voice": 512 * 1024, "threads-spawned": 2 }))!;
    const c = checkResourceHints(d, grid);
    expect(row(c.hints, "footprint-at-rest")).toEqual({ hint: "footprint-at-rest", unit: "bytes", declared: 3 * MIB, measured: 3 * MIB, verdict: "agrees", rate: 96000, quantum: 128 });
    expect(row(c.hints, "footprint-per-voice")).toMatchObject({ declared: 512 * 1024, measured: 512 * 1024, verdict: "agrees", rate: 48000 });
    expect(row(c.hints, "threads-spawned")).toMatchObject({ declared: 2, measured: 2, verdict: "agrees" });
  });

  it("a figure the measurement does not bear out exceeds: the finding", () => {
    const d = readScanResourceHints(scanHints({ "footprint-at-rest": 1 * MIB, "footprint-per-voice": 64 * 1024, "threads-spawned": 0 }))!;
    const c = checkResourceHints(d, grid);
    expect(row(c.hints, "footprint-at-rest")).toMatchObject({ declared: MIB, measured: 3 * MIB, verdict: "exceeds" });
    expect(row(c.hints, "footprint-per-voice")).toMatchObject({ verdict: "exceeds" });
    expect(row(c.hints, "threads-spawned")).toMatchObject({ declared: 0, measured: 2, verdict: "exceeds" });
  });

  it("memory is read with the declared tolerance and slack, threads exactly", () => {
    const declared = 4 * MIB;
    const edge = declared * (1 + RESOURCE_HINT_MEMORY_TOLERANCE) + RESOURCE_HINT_MEMORY_SLACK_KB * 1024;
    expect(memoryWithinHint(declared, edge)).toBe(true);
    expect(memoryWithinHint(declared, edge + 1)).toBe(false);
  });

  it("a hint the plugin does not state is unknown, never zero, whatever was measured", () => {
    const c = checkResourceHints(readScanResourceHints(scanHints({ "footprint-at-rest": 3 * MIB }))!, grid);
    expect(row(c.hints, "threads-spawned")).toEqual({ hint: "threads-spawned", unit: "count", declared: null, measured: null, verdict: "unknown" });
    expect(c.hints.map((r) => r.hint)).toEqual([
      "footprint-at-rest", "footprint-per-voice", "shared-load", "threads-spawned", "streams-from-disk", "opens-sockets", "activate-time",
    ]);
  });

  it("a stated hint plugin-qualify took no figure for is unmeasured, never agreed", () => {
    const d = readScanResourceHints(scanHints({ "shared-load": MIB, "streams-from-disk": false, "opens-sockets": true, "activate-time": 5, "threads-spawned": 0 }))!;
    const noInterposer = [cell(48000, 128, { rtSafety: { interposer: false, ownThreads: 3 } })];
    const c = checkResourceHints(d, noInterposer);
    for (const hint of ["shared-load", "streams-from-disk", "opens-sockets", "activate-time", "threads-spawned"]) {
      expect(row(c.hints, hint)).toMatchObject({ verdict: "unmeasured", measured: null });
    }
  });

  it("a cell that did not run to its end measures nothing", () => {
    const d = readScanResourceHints(scanHints({ "footprint-at-rest": MIB }))!;
    const c = checkResourceHints(d, [{ ...cell(48000, 128, { memory: { atRestKb: 9999 } }), outcome: "probe.crashed" }]);
    expect(row(c.hints, "footprint-at-rest")).toMatchObject({ verdict: "unmeasured" });
  });

  it("a declaration the host refused states nothing: no rows, the code kept", () => {
    const c = checkResourceHints(readScanResourceHints(scanHints({ "footprint-at-rest": MIB }, "hosting.resource-hints.unknown-hint"))!, grid);
    expect(c).toEqual({ declared: 1, refused: "hosting.resource-hints.unknown-hint", hints: [] });
  });
});

describe("the scan's hints reach the target, and the comparison the record", () => {
  const plugin = (extra: Record<string, unknown>) => ({
    id: "org.example.plate", name: "Plate", vendor: "", version: "1.4.2", description: "", url: "", features: [], params: [],
    audio_ports: { inputs: [], outputs: [] }, note_ports: { inputs: 0, outputs: 0 }, ...extra,
  });
  const scanOf = (p: Record<string, unknown>) => JSON.stringify({ scanner: "omx-clap-scan", version: "0", files: [{ path: "/x/plate.clap", plugins: [p] }] });

  const dir = mkdtempSync(join(tmpdir(), "resource-hints-"));
  writeFileSync(join(dir, "plate.clap"), "");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a scanned plugin that states hints carries them on its target; one that states none carries none", () => {
    const run = (out: string) => () => ({ status: 0, stdout: out });
    const hinted = clapLoader({ run: run(scanOf(plugin({ resource_hints: scanHints({ "threads-spawned": 1 }) }))) }).resolve(dir)!;
    expect(hinted[0]!.resourceHints?.hints["threads-spawned"]).toEqual({ unit: "count", figure: 1 });
    const bare = clapLoader({ run: run(scanOf(plugin({}))) }).resolve(dir)!;
    expect(bare[0]!.resourceHints).toBeUndefined();
  });

  it("the record holds the comparison its judgment carries, and none when the plugin stated no hint", () => {
    const doc = JSON.parse(fixtureText("success-msi"));
    for (const p of doc.grid) p.rtSafety.ownThreads = 2;
    const r = readProbeOutput(JSON.stringify(doc));
    if (!r.ok) throw new Error(r.problem);
    const plain = judgeProbeOutput(r.output, [OMX_CLAP_HOST_PROFILE]);
    const copy = { file: "f", sha256: "0".repeat(64), bytes: 1 };
    const check = checkResourceHints(readScanResourceHints(scanHints({ "threads-spawned": 0 }))!, r.output.grid);
    const record = buildQualificationRecord({ ...plain, resourceHints: check }, copy);
    expect(row(record.resourceHints!.hints, "threads-spawned")).toMatchObject({ declared: 0, measured: 2, verdict: "exceeds" });
    expect(buildQualificationRecord(plain, copy).resourceHints).toBeUndefined();
  });
});
