// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A timing proof reads the load at the measurement (ruling 2026-11-11; openmixer R-103, the timing-proof rule). A cost a
 * test measures (ns per sample, a voice curve) holds its bounds on a quiet node; on a loaded node the scheduler, not the
 * plugin, decides it. So a timing proof that misses on a loaded node is NOT MEASURED: a TIMING-WARN line names the miss
 * and the load and the test is skipped with it, never passed; on a quiet node it FAILS (TIMING-FAIL) as any assertion
 * does. Loaded is a CPU pressure share of 10 % or more over the test's window, or where pressure is not readable a load
 * average of 0.5 per core or more; a load that cannot be measured is quiet. Only the timing comparisons read the load:
 * what a measurement says about its shape (the counts it held, a p95 at or above its median) fails anywhere.
 *
 * verify: timing-proof
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, test, vi, type RunnerTestCase } from "vitest";

import { LOAD_FIXTURE_ENV, LOADED_LOAD_PER_CORE, LOADED_PRESSURE_PCT, PRESSURE_FILE_ENV, nodeLoad, pressureWindow, timing } from "./timing-proof.support.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOADED = () => nodeLoad({ cpuSomePct: 40, loadavg1: 1, cores: 8 }, {});
const QUIET = () => nodeLoad({ cpuSomePct: 2, loadavg1: 1, cores: 8 }, {});
class Skipped extends Error {}
const skip = (note: string): never => {
  throw new Skipped(note);
};
const scratch = mkdtempSync(join(tmpdir(), "timing-proof-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe("a timing proof", () => {
  test("held: it passes whatever the load", () => {
    expect(timing("a bound held", () => expect(2).toBeGreaterThan(1), { load: QUIET, skip })).toBe("held");
    expect(timing("a bound held", () => expect(2).toBeGreaterThan(1), { load: LOADED, skip })).toBe("held");
  });

  test("missed on a loaded node: a warning naming the miss and the load, and the test is skipped, never passed", () => {
    const said = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => timing("the curve grows", () => expect(1).toBeGreaterThan(2), { load: LOADED, skip })).toThrow(Skipped);
    const out = said.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toMatch(
      /^TIMING-WARN the curve grows: expected 1 to be greater than 2 on a loaded node \(cpu some 40\.0%, load 0\.13 per core, 8 cores, pressure\): not measured, the test is skipped$/m,
    );
  });

  test("missed on a quiet node: a failure, naming the load", () => {
    expect(() => timing("the curve grows", () => expect(1).toBeGreaterThan(2), { load: QUIET, skip })).toThrow(
      /^TIMING-FAIL the curve grows: expected 1 to be greater than 2 \(on a quiet node: cpu some 2\.0%, load 0\.13 per core, 8 cores, pressure\)$/,
    );
  });

  test("missed on a loaded node with no test to skip: a failure, never a pass", () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(() => timing("the curve grows", () => expect(1).toBeGreaterThan(2), { load: LOADED, skip: null })).toThrow(
      /^TIMING-FAIL the curve grows: expected 1 to be greater than 2 \(on a loaded node with no test to skip: cpu some 40\.0%/,
    );
  });

  test("loaded is the pressure share over the window at 10 % or more, else the load average at 0.5 per core or more", () => {
    expect([LOADED_PRESSURE_PCT, LOADED_LOAD_PER_CORE]).toEqual([10, 0.5]);
    expect(nodeLoad({ cpuSomePct: 10, cores: 4 }, {}).loaded).toBe(true);
    expect(nodeLoad({ cpuSomePct: 9.9, loadavg1: 99, cores: 4 }, {}).loaded).toBe(false);
    // ci.yml run 46099457363: 1.94 on 4 cores, called quiet by the old rule's load-above-cores; pressure decides first
    expect(nodeLoad({ cpuSomePct: null, loadavg1: 1.94, cores: 4 }, {})).toMatchObject({ loaded: false, source: "loadavg" });
    expect(nodeLoad({ cpuSomePct: null, loadavg1: 2, cores: 4 }, {})).toMatchObject({ loaded: true, source: "loadavg" });
    expect(nodeLoad({ cpuSomePct: null, loadavg1: 2, cores: 0 }, {})).toMatchObject({ loaded: false, source: "unmeasured" });
  });

  test("the fixture stands in for the node", () => {
    expect(nodeLoad({ cpuSomePct: 0 }, { [LOAD_FIXTURE_ENV]: "loaded" })).toMatchObject({ loaded: true, source: "fixture", cores: availableParallelism() });
    expect(nodeLoad({ cpuSomePct: 99 }, { [LOAD_FIXTURE_ENV]: "quiet" })).toMatchObject({ loaded: false, source: "fixture" });
  });

  test("the window reads the pressure counter's growth as a share of its wall time, and no file is no pressure", () => {
    const file = join(scratch, "cpu");
    const env = { [PRESSURE_FILE_ENV]: file };
    writeFileSync(file, "some avg10=0.00 avg60=0.00 avg300=0.00 total=1000000\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n");
    const end = pressureWindow(env);
    writeFileSync(file, "some avg10=0.00 avg60=0.00 avg300=0.00 total=1250000\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n");
    expect(end({ wallMs: 1000, loadavg1: 0, cores: 4 })).toMatchObject({ loaded: true, cpuSomePct: 25, source: "pressure" });
    expect(pressureWindow({ [PRESSURE_FILE_ENV]: join(scratch, "none") })({ loadavg1: 0, cores: 4 })).toMatchObject({ cpuSomePct: null, source: "loadavg" });
  });

  let skipped: RunnerTestCase | undefined;
  test("a loaded miss in a running test skips that test, through the support's own window and skip", (ctx) => {
    skipped = ctx.task;
    vi.stubEnv(LOAD_FIXTURE_ENV, "loaded");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    timing("the curve grows", () => expect(1).toBeGreaterThan(2));
    throw new Error("timing() returned after a loaded miss: the test would have passed");
  });
  test("... and that test reads skipped, not passed", () => {
    vi.unstubAllEnvs();
    expect(skipped?.result?.state).toBe("skip");
    // the runner keeps ctx.skip's note on the result (vitest 4.1 has it at run time, not in TaskResult's type)
    expect((skipped?.result as { readonly note?: string } | undefined)?.note ?? "").toMatch(/^TIMING-WARN the curve grows: .* not measured, the test is skipped$/);
  });

  test("sabotage: a quiet fixture leaves the same miss a failure in a running test", () => {
    vi.stubEnv(LOAD_FIXTURE_ENV, "quiet");
    expect(() => timing("the curve grows", () => expect(1).toBeGreaterThan(2))).toThrow(/^TIMING-FAIL the curve grows: .*on a quiet node: cpu some 0\.0%.*fixture\)$/);
    vi.unstubAllEnvs();
  });
});

describe("every test file that imports the timing support says so for the gate", () => {
  test("verify: timing-proof", () => {
    for (const f of ["lv2-latency-cost.test.ts", "clap-cost.test.ts", "timing-proof.test.ts"]) {
      expect(readFileSync(join(HERE, f), "utf8"), f).toMatch(/^\s*(\*|\/\/) verify: timing-proof$/m);
    }
  });
});

// A measured cost compared with a bound or with another measured cost: the lines a timing proof is made of.
// A shape assertion (min <= median <= p95 <= max, a figure above 0) is no timing proof: OrEqual and a bare 0 stay out.
const COMPARISON = /\.toBe(Greater|Less)Than\((?=[^)]*(\*|nsPerSample|\b(one|eight|thirtyTwo|fortyEight|s1|s16|p16|plain16)\b))|Math\.abs\(fortyEight/;

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
