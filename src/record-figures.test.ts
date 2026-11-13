// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `recordFigures` reads what a qualification record states at one rate and quantum: latency, cost,
 * the interposer's RT-safety counts, whether a soak ran at the rate, and a cell's own crash or
 * timeout code. Nothing here is a tier, a state or a verdict.
 */
import { describe, expect, it } from "vitest";

import { OMX_CLAP_HOST_PROFILE } from "./host-profiles.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { fixtureJson } from "./probe-output-fixtures.js";
import { readProbeOutput } from "./probe-output.js";
import { buildQualificationRecord, type QualificationRecord } from "./qualification-record.js";
import { recordFigures } from "./record-figures.js";

function recordOf(patch: (d: Record<string, any>) => void): QualificationRecord {
  const d = fixtureJson("success-msi");
  patch(d);
  const r = readProbeOutput(JSON.stringify(d));
  if (!r.ok) throw new Error(r.problem);
  return buildQualificationRecord(judgeProbeOutput(r.output, [OMX_CLAP_HOST_PROFILE]), { file: "x.probe.json", sha256: "0".repeat(64), bytes: 1 });
}

describe("recordFigures", () => {
  it("reads the cell's declared and measured latency frames, and its RT-safety counts, verbatim", () => {
    const rec = recordOf(() => {});
    const figures = recordFigures(rec, 48000, 128);
    expect(figures.latency).toEqual({ declaredFrames: 0, measuredFrames: 0 });
    expect(figures.rtSafety).toEqual({
      interposer: true,
      swept: true,
      sweepApplicable: true,
      allocations: 0,
      locks: 0,
      syscalls: 0,
      threadViolations: 0,
      processErrors: 0,
      events: 0,
    });
  });

  it("reads the cell's median cost in ns per sample", () => {
    const rec = recordOf(() => {});
    expect(recordFigures(rec, 48000, 128).costNsPerSampleMedian).toBe(41.2);
    expect(recordFigures(rec, 96000, 128).costNsPerSampleMedian).toBe(40.7);
  });

  it("counts the interposer's events rather than carrying their words", () => {
    const rec = recordOf((d) => {
      d.grid[0].rtSafety.events = ["malloc ? ?", "free ? ?", "malloc ? ?"];
    });
    expect(recordFigures(rec, 48000, 128).rtSafety?.events).toBe(3);
  });

  it("a rate and quantum the grid never names carries no per-cell figure, and no soak", () => {
    const rec = recordOf(() => {});
    const figures = recordFigures(rec, 192000, 2048);
    expect(figures.latency).toBeUndefined();
    expect(figures.costNsPerSampleMedian).toBeUndefined();
    expect(figures.rtSafety).toBeUndefined();
    expect(figures.soakRan).toBe(false);
    expect(figures.crashCode).toBeUndefined();
    expect(figures.timeoutCode).toBeUndefined();
  });

  it("names a cell's own crash or timeout code verbatim, never the other", () => {
    const crashed = recordOf((d) => {
      d.grid[0].outcome = "probe.crashed";
    });
    expect(recordFigures(crashed, 48000, 128).crashCode).toBe("probe.crashed");
    expect(recordFigures(crashed, 48000, 128).timeoutCode).toBeUndefined();

    const timedOut = recordOf((d) => {
      d.grid[0].outcome = "probe.timeout";
    });
    expect(recordFigures(timedOut, 48000, 128).timeoutCode).toBe("probe.timeout");
    expect(recordFigures(timedOut, 48000, 128).crashCode).toBeUndefined();
  });

  it("says a soak ran at a rate exactly when the record's behaviour names a soak reading there", () => {
    const soaked = recordOf((d) => {
      d.behaviour = { ...d.behaviour, soak: { sweptParams: true, perRate: { "48000": { seconds: 120, windows: 10 } } } };
    });
    expect(recordFigures(soaked, 48000, 128).soakRan).toBe(true);
    expect(recordFigures(soaked, 96000, 128).soakRan).toBe(false);

    const unsoaked = recordOf(() => {});
    expect(recordFigures(unsoaked, 48000, 128).soakRan).toBe(false);
  });
});
