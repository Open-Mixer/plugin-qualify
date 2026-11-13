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
const BUILT = [MEASURE, INTERPOSER, join(FAULTY, "keeps-memory.lv2", "gain.so")].every((p) => existsSync(p));
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
