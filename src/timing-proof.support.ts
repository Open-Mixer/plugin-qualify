// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Tests only. A timing proof reads the load AT THE MEASUREMENT (ruling 2026-11-11; the timing-proof rule, openmixer
 * R-103, whose thresholds and environment names this support keeps): a cost a test measures holds its bounds on a quiet
 * node, and on a loaded node the scheduler decides it, not the plugin. So {@link timing} runs a proof's timing
 * comparisons, and on a miss judges the node's load over the test's own window:
 *
 * - held: the test goes on;
 * - missed on a LOADED node: a `TIMING-WARN` line on stderr naming the miss and the load, and the test is SKIPPED with
 *   that note: its figures were not measured, so it is neither a pass nor a red (the gate reruns it on a quiet node);
 * - missed on a QUIET node: `TIMING-FAIL`, the miss rethrown with the load named.
 *
 * The load: the CPU pressure share over the test's window (`/proc/pressure/cpu`, `some … total=<us>`, the share of the
 * wall time some task waited for a CPU: at or above {@link LOADED_PRESSURE_PCT} % is loaded), or, where pressure is not
 * readable, the one-minute load average per core (at or above {@link LOADED_LOAD_PER_CORE} is loaded). A load that cannot
 * be measured is quiet: a miss fails, never a silent pass. The window opens before each test of a file that imports this
 * support (its own beforeEach) and closes at the miss. `OMX_TIMING_PROOF_LOAD=loaded|quiet` stands in for the node (the
 * rule's own tests, a red-first run, the sabotage); `OMX_TIMING_PRESSURE_FILE` names another pressure file.
 *
 * The old rule called a node quiet up to a 1-minute load average equal to its cores, read when the miss was caught, and
 * passed a loaded miss: ci.yml run 46099457363 failed two LV2 curve proofs at 1.85 and 1.94 on 4 cores, a vitest pool
 * beside them, as "quiet node" misses. Put only timing comparisons in a proof, last in its test: what a measurement says
 * about its own shape fails on any node. Every test file that imports this support carries the line `verify: timing-proof`.
 */
import { readFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { beforeEach } from "vitest";

/** The CPU pressure share (`some`, percent of the window) at or above which the node is loaded: the gate's figure. */
export const LOADED_PRESSURE_PCT = 10;
/** The one-minute load average per core at or above which the node is loaded, where pressure is not readable. */
export const LOADED_LOAD_PER_CORE = 0.5;
/** `loaded` or `quiet`: the fixture that stands in for the node. */
export const LOAD_FIXTURE_ENV = "OMX_TIMING_PROOF_LOAD";
/** Another pressure file than /proc/pressure/cpu (tests). */
export const PRESSURE_FILE_ENV = "OMX_TIMING_PRESSURE_FILE";

type Env = Readonly<Record<string, string | undefined>>;

export interface NodeLoad {
  /** The one verdict a proof reads. */
  readonly loaded: boolean;
  /** The pressure share over the window, percent; null when not measured. */
  readonly cpuSomePct: number | null;
  /** The one-minute load average per core; NaN when not readable. */
  readonly loadPerCore: number;
  readonly cores: number;
  /** Where the verdict came from. */
  readonly source: "fixture" | "pressure" | "loadavg" | "unmeasured";
}

/** The `some … total=<us>` counter of the pressure file, or null when it cannot be read. */
function pressureTotalUs(env: Env): number | null {
  try {
    const m = /^some .*total=(\d+)/m.exec(readFileSync(env[PRESSURE_FILE_ENV] ?? "/proc/pressure/cpu", "utf8"));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** The node's load from the figures given (or read now): the fixture, then pressure, then the load average, else unmeasured. */
export function nodeLoad(
  given: { readonly cpuSomePct?: number | null; readonly loadavg1?: number; readonly cores?: number } = {},
  env: Env = process.env,
): NodeLoad {
  const cores = given.cores ?? availableParallelism();
  const fixture = env[LOAD_FIXTURE_ENV];
  if (fixture === "loaded") return { loaded: true, cpuSomePct: 100, loadPerCore: Number.POSITIVE_INFINITY, cores, source: "fixture" };
  if (fixture === "quiet") return { loaded: false, cpuSomePct: 0, loadPerCore: 0, cores, source: "fixture" };
  const load1 = given.loadavg1 ?? loadavg()[0]!;
  const loadPerCore = cores > 0 ? load1 / cores : Number.NaN;
  const pct = given.cpuSomePct ?? null;
  if (pct !== null && Number.isFinite(pct)) return { loaded: pct >= LOADED_PRESSURE_PCT, cpuSomePct: pct, loadPerCore, cores, source: "pressure" };
  if (Number.isFinite(loadPerCore)) return { loaded: loadPerCore >= LOADED_LOAD_PER_CORE, cpuSomePct: null, loadPerCore, cores, source: "loadavg" };
  return { loaded: false, cpuSomePct: null, loadPerCore, cores, source: "unmeasured" };
}

/** Open a window now; the function returned closes it and reads the load over it (`wallMs`, `loadavg1`, `cores`: tests). */
export function pressureWindow(
  env: Env = process.env,
): (end?: { readonly wallMs?: number; readonly loadavg1?: number; readonly cores?: number }) => NodeLoad {
  const t0 = Date.now();
  const p0 = pressureTotalUs(env);
  return (end = {}) => {
    const wallMs = end.wallMs ?? Date.now() - t0;
    const p1 = pressureTotalUs(env);
    const pct = p0 !== null && p1 !== null && wallMs > 0 ? ((p1 - p0) / (wallMs * 1000)) * 100 : null;
    return nodeLoad({ cpuSomePct: pct, loadavg1: end.loadavg1, cores: end.cores }, env);
  };
}

/** The load named in a line. */
export function said(l: NodeLoad): string {
  const pct = l.cpuSomePct === null ? "unmeasured" : `${l.cpuSomePct.toFixed(1)}%`;
  const per = Number.isFinite(l.loadPerCore) ? l.loadPerCore.toFixed(2) : "unmeasured";
  return `cpu some ${pct}, load ${per} per core, ${String(l.cores)} cores, ${l.source}`;
}

// the running test's window and its skip: opened before each test of the file that imports this support
let current: { readonly window: () => NodeLoad; readonly skip: (note: string) => never } | undefined;
beforeEach((ctx) => {
  const window = pressureWindow();
  current = { window: () => window(), skip: (note) => ctx.skip(note) };
});

/**
 * Run `proof`, the timing comparisons of the test `name`: "held" when they hold. A miss on a loaded node writes a
 * TIMING-WARN line and skips the test (`skip`, the running test's by default; with none, or null, the miss fails, never a
 * pass);
 * on a quiet node the miss is rethrown as TIMING-FAIL with the load named. `load` reads the load (the test's window by
 * default).
 */
export function timing(
  name: string,
  proof: () => void,
  options: { readonly load?: () => NodeLoad; readonly skip?: ((note: string) => never) | null } = {},
): "held" {
  try {
    proof();
    return "held";
  } catch (e) {
    const load = (options.load ?? current?.window ?? (() => nodeLoad()))();
    const message = e instanceof Error ? e.message : String(e);
    const first = message.split("\n")[0] ?? message;
    const skip = options.skip === undefined ? current?.skip : options.skip;
    if (load.loaded && skip) {
      const line = `TIMING-WARN ${name}: ${first} on a loaded node (${said(load)}): not measured, the test is skipped`;
      process.stderr.write(`${line}\n`);
      return skip(line);
    }
    const verdict = load.loaded ? "on a loaded node with no test to skip" : "on a quiet node";
    const text = `TIMING-FAIL ${name}: ${message} (${verdict}: ${said(load)})`;
    if (e instanceof Error) {
      e.message = text;
      throw e;
    }
    throw new Error(text);
  }
}
