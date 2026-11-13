// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A PASS GIVES ITS MEMORY BACK (#28). Surge XT's LV2, with its content loaded, takes hundreds of MB an instance and
 * the process keeps them after the instance is gone; lv2-measure made every pass's instance in one process, so on a
 * 4 GB Raspberry Pi 5 it grew past the box in 9 s and the kernel killed it. Ruling (coordinator, 11-11): a pass gives
 * its memory back or runs in a fresh process, bounded by the run's memory limit, and a pass that reaches the bound is
 * a code in the record, never the end of the run.
 *
 * The fixture `keeps-memory.lv2` takes 64 MiB at every instantiate and never frees it. Under the runner's bound (a data
 * limit, the interposer told to exit `MEMORY_BOUND_EXIT_STATUS` on a refused allocation, as plugin-hostd-probe runs it):
 *   - a bound every pass fits and the passes together do not: every pass is measured, the run ends with its document;
 *   - a bound one pass does not fit (three lifecycle cycles, 192 MiB, under 160 MiB): the document is still written,
 *     that pass carries the `memory-bound` code, and the passes after it are measured.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MEMORY_BOUND_EXIT_ENV, MEMORY_BOUND_EXIT_STATUS } from "./qualify-declarations.js";

const NATIVE = join(dirname(fileURLToPath(import.meta.url)), "..", "native");
const BUILD = join(NATIVE, "build");
const MEASURE = join(BUILD, "lv2_measure");
const INTERPOSER = join(BUILD, "rt_interpose.so");
const FAULTY = join(BUILD, "fixtures-faulty", "lv2");
const KEEPS = "urn:plugin-qualify:fixture:lv2-keeps-memory";
const LV2 = join(BUILD, "fixtures", "lv2");
const CRASH = "urn:plugin-qualify:fixture:lv2-synth-crash";
const BUILT = [MEASURE, INTERPOSER, join(FAULTY, "keeps-memory.lv2", "gain.so"), join(LV2, "synth-crash.lv2", "synth.so")].every((p) => existsSync(p));
const MIB = 1024;

function live(name: string, body: () => void): void {
  it(name, (ctx) => {
    if (!BUILT) {
      if (process.env["CI"]) throw new Error("native/build is missing: CI builds it with make -C native deps all");
      ctx.skip("native/build is missing: make -C native deps all");
    }
    body();
  }, 120_000);
}

/** lv2-measure on the fixture under a data limit of `limitMib`, the interposer told to exit on a refused allocation. */
function bounded(limitMib: number): { status: number | null; doc: Record<string, unknown> | undefined; stderr: string } {
  const r = spawnSync("bash", ["-c", `ulimit -d ${String(limitMib * MIB)}; exec "$0" "$@"`, MEASURE, KEEPS, "48000", "64", "3", "2"], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"], LD_LIBRARY_PATH: process.env["LD_LIBRARY_PATH"], LV2_PATH: FAULTY, LD_PRELOAD: INTERPOSER, [MEMORY_BOUND_EXIT_ENV]: "1" },
  });
  let doc: Record<string, unknown> | undefined;
  try {
    doc = JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    doc = undefined;
  }
  return { status: r.status, doc, stderr: r.stderr };
}

describe("lv2-measure, live — a pass gives its memory back (#28)", () => {
  live("a pass after the verdict's that crashes ends alone: probe-crashed in the record, the run goes on and writes its whole document", () => {
    // what Surge XT's LV2 did on a Pi (#61): every pass up to the rates measured, then SIGSEGV in a voice-curve child,
    // and the parent died of the same signal with the document cut. synth-crash.lv2 dies when one block strikes more
    // than 32 notes: the curve's 48 does, nothing before it
    const r = spawnSync(MEASURE, [CRASH, "48000", "64", "2", "1"], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"], LD_LIBRARY_PATH: process.env["LD_LIBRARY_PATH"], LV2_PATH: LV2, OMX_PROBE_NOTES: "2", OMX_PROBE_NOTES_CURVE: "1,48" },
    });
    expect(r.status, `exit ${String(r.status)} ${String(r.signal)}`).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, Record<string, unknown>>;
    expect(doc["latency"]!["unmeasuredReason"]).toBeUndefined();
    const at = (doc["cost"]!["perRate"] as Record<string, Record<string, unknown>>)["48000"]!;
    expect(at["unmeasuredReason"]).toBeUndefined();
    const curve = at["voiceCurve"] as { held: number; unmeasuredReason?: string }[];
    expect(curve.map((e) => e.held)).toEqual([1, 48]);
    expect(curve[0]!.unmeasuredReason).toBeUndefined();
    expect(curve[1]!.unmeasuredReason).toBe("probe-crashed");
  });

  live("unbounded, the measurer never holds more than one pass's instances: its peak stays under 320 MiB (the fixture keeps 64 MiB an instance)", () => {
    const r = spawnSync("/usr/bin/time", ["-f", "%M", MEASURE, KEEPS, "48000", "64", "3", "2"], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"], LD_LIBRARY_PATH: process.env["LD_LIBRARY_PATH"], LV2_PATH: FAULTY, LD_PRELOAD: INTERPOSER },
    });
    expect(r.status).toBe(0);
    const peakKib = Number(r.stderr.trim().split("\n").at(-1));
    // the parent never holds more than the instances of one pass at a time
    expect(peakKib).toBeLessThan(320 * MIB);
  });

  live("under a bound every pass fits and the passes together exceed: every pass is measured and the run ends with its document", () => {
    const r = bounded(320);
    expect(r.status, `exited ${String(r.status)}: ${r.stderr.slice(-400)}`).not.toBe(MEMORY_BOUND_EXIT_STATUS);
    expect(r.status).toBe(0);
    expect(r.doc).toBeDefined();
    expect(r.doc!["lifecycle"]).toMatchObject({ cycles: 3, instantiated: 3, failed: 0 });
    expect(r.doc!["rtSafety"]).toBeDefined();
    expect(r.doc!["latency"]).toBeDefined();
    expect(r.doc!["cost"]).toBeDefined();
  });

  live("under a bound one pass does not fit: the document is written, that pass carries memory-bound, the passes after it are measured", () => {
    const r = bounded(160);
    expect(r.status, `exited ${String(r.status)}: ${r.stderr.slice(-400)}`).not.toBe(MEMORY_BOUND_EXIT_STATUS);
    expect(r.doc).toBeDefined();
    expect(r.doc!["lifecycle"]).toMatchObject({ unmeasuredReason: "memory-bound" });
    expect(r.doc!["latency"]).toBeDefined();
    expect(r.doc!["cost"]).toBeDefined();
  });
});
