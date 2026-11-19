// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * THE OTHER THREADS CROSS THE CHILD (D20, #53). Each rt-safety repeat of lv2-measure runs in a child process of its own
 * (#28), and the interposer's counters live in that child: what the plugin's own threads did while the audio thread
 * was armed is read there and handed back with the audio thread's counts, or the record would never say it.
 *
 * The fixture `worker-allocates.lv2` is the rt-safe gain with a thread of its own that allocates every 100 us while
 * run() spins 2 ms with no call: the audio thread is clean, the other thread is not, and one thread is the plugin's.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BUILD = join(dirname(fileURLToPath(import.meta.url)), "..", "native", "build");
const MEASURE = join(BUILD, "lv2_measure");
const INTERPOSER = join(BUILD, "rt_interpose.so");
const LV2 = join(BUILD, "fixtures", "lv2");
const WORKER = "urn:plugin-qualify:fixture:lv2-worker-allocates";
const SAFE = "urn:plugin-qualify:fixture:lv2-rt-safe";
const BUILT = [MEASURE, INTERPOSER, join(LV2, "worker-allocates.lv2", "gain.so"), join(LV2, "rt-safe.lv2", "gain.so")].every((p) => existsSync(p));

type RtSafety = { allocationsInRun: number; ownThreads: number; otherThreads?: { allocationsInRun: number; locksInRun: number; syscallsInRun: number } };

function live(name: string, body: () => void): void {
  it(name, (ctx) => {
    if (!BUILT) {
      if (process.env["CI"]) throw new Error("native/build is missing: CI builds it with make -C native deps all");
      ctx.skip("native/build is missing: make -C native deps all");
    }
    body();
  }, 120_000);
}

function measured(uri: string): RtSafety {
  const r = spawnSync(MEASURE, [uri, "48000", "64", "3", "3"], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"], LD_LIBRARY_PATH: process.env["LD_LIBRARY_PATH"], LV2_PATH: LV2, LD_PRELOAD: INTERPOSER },
  });
  expect(r.status, r.stderr).toBe(0);
  return (JSON.parse(r.stdout) as { rtSafety: RtSafety }).rtSafety;
}

describe("lv2-measure, live — the other threads' counts come back from the rt-safety child (D20, #53)", () => {
  live("a plugin whose own thread allocates: the audio thread clean, the other thread counted, one thread its own", () => {
    const rt = measured(WORKER);
    expect(rt.allocationsInRun).toBe(0);
    expect(rt.ownThreads).toBe(1);
    expect(rt.otherThreads?.allocationsInRun ?? 0).toBeGreaterThan(0);
  });

  live("a plugin with no thread of its own: no own thread, and the other threads' counts are there and zero", () => {
    const rt = measured(SAFE);
    expect(rt.ownThreads).toBe(0);
    expect(rt.otherThreads).toEqual({ allocationsInRun: 0, locksInRun: 0, syscallsInRun: 0 });
  });
});
