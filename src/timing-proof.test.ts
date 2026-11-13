// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A timing proof reads the load (ruling 2026-11-11, as plugin-hostd's tests do). A cost a test measures (ns per sample, a
 * voice curve) holds its bounds on a quiet node; on a node whose 1-minute load average is above its cores the scheduler,
 * not the plugin, decides it. So a timing proof that misses on a loaded node WARNS, naming the load (TIMING-WARN, for the
 * gate to rerun it on a quiet node), and on a quiet node it FAILS as any assertion does. Only the timing comparisons read
 * the load: what a measurement says about its shape (the counts it held, a p95 at or above its median) fails anywhere.
 */
import { readFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

import { LOAD_ENV, nodeLoad, timing } from "./timing-proof.support.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOADED = { loadavg1: 67.25, cores: 8 };
const QUIET = { loadavg1: 0.5, cores: 8 };

afterEach(() => vi.restoreAllMocks());

describe("a timing proof", () => {
  test("held: it passes whatever the load", () => {
    expect(timing("a bound held", () => expect(2).toBeGreaterThan(1), () => QUIET)).toBe("held");
    expect(timing("a bound held", () => expect(2).toBeGreaterThan(1), () => LOADED)).toBe("held");
  });

  test("missed on a loaded node: a warning naming the miss and the load, and the test passes", () => {
    const said = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(timing("the curve grows", () => expect(1).toBeGreaterThan(2), () => LOADED)).toBe("warned");
    const out = said.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(/^TIMING-WARN the curve grows: expected 1 to be greater than 2 \(loaded node: 1-min load 67\.25 on 8 cores\)$/m);
  });

  test("missed on a quiet node: a failure, naming the load", () => {
    expect(() => timing("the curve grows", () => expect(1).toBeGreaterThan(2), () => QUIET)).toThrow(
      /expected 1 to be greater than 2 \(quiet node: 1-min load 0\.50 on 8 cores\)/,
    );
  });

  test("the load is the node's own, or the fake the environment names", () => {
    expect(nodeLoad({ [LOAD_ENV]: "12.5" })).toEqual({ loadavg1: 12.5, cores: availableParallelism() });
    const own = nodeLoad({});
    expect(own.cores).toBe(availableParallelism());
    expect(Math.abs(own.loadavg1 - loadavg()[0]!)).toBeLessThan(5);
  });

  test("sabotage: a load that is never read leaves a loaded node's miss a failure", () => {
    expect(() => timing("the curve grows", () => expect(1).toBeGreaterThan(2), () => QUIET)).toThrow();
    const said = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(timing("the curve grows", () => expect(1).toBeGreaterThan(2), () => LOADED)).toBe("warned");
    expect(said).toHaveBeenCalled();
  });
});

// A measured cost compared with a bound or with another measured cost: the lines a timing proof is made of.
const COMPARISON = /nsPerSample\w*\)?\.toBe(Greater|Less)Than|\b(one|eight|thirtyTwo|fortyEight|s1|s16|p16|curve16|plain16)!?\)\.toBe(Greater|Less)Than|Math\.abs\(fortyEight/;

/** The comparisons of `text` that are not inside a timing(...) proof: the nearest opening before each is timing(, not a test. */
function outsideTiming(text: string): string[] {
  const lines = text.split("\n");
  const bad: string[] = [];
  lines.forEach((line, i) => {
    if (!COMPARISON.test(line)) return;
    for (let j = i; j >= 0; j--) {
      if (/\btiming\(/.test(lines[j]!)) return;
      if (/^\s*(live|test|it)\(/.test(lines[j]!)) break;
    }
    bad.push(`${String(i + 1)}: ${line.trim()}`);
  });
  return bad;
}

describe("the cost tests' timing proofs read the load", () => {
  test("the LV2 voice curve's ns per sample (an instrument timed at each count) first, every LV2 cost comparison", () => {
    const text = readFileSync(join(HERE, "lv2-latency-cost.test.ts"), "utf8");
    expect(text).toMatch(/an instrument is timed at each count of the curve[\s\S]*?timing\(/);
    expect(outsideTiming(text)).toEqual([]);
  });

  test("every CLAP cost comparison", () => {
    expect(outsideTiming(readFileSync(join(HERE, "clap-cost.test.ts"), "utf8"))).toEqual([]);
  });

  test("sabotage: a comparison planted outside timing() is caught", () => {
    const planted = 'live("x", () => {\n  const one = 1, eight = 2;\n  expect(eight).toBeGreaterThan(one);\n});\n';
    expect(outsideTiming(planted)).toEqual(["3: expect(eight).toBeGreaterThan(one);"]);
    const held = 'live("x", () => {\n  timing("x", () => {\n    expect(eight).toBeGreaterThan(one);\n  });\n});\n';
    expect(outsideTiming(held)).toEqual([]);
  });
});
