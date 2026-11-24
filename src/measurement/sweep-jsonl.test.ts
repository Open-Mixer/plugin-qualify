// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The hosting sweep's three passes → the format's three hosting dimensions, and those
 * dimensions through the merge: a TRANSLATION with no rule in it, and the same per-plugin,
 * per-DIMENSION precedence `latency` and `cost` obey.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMeasurementDocument, readMeasurementDocument, serialiseMeasurementDocument } from "./format.js";
import { mergeMeasurements } from "./merge.js";
import { buildRun } from "./provenance.js";
import { measuredPluginsFromSweep, parseJsonl } from "./sweep-jsonl.js";

const QUICK = {
  uri: "urn:swept",
  instantiated: true,
  rate: 192000,
  block: 512,
  audioInputs: 1,
  audioOutputs: 1,
  cvPorts: 0,
  controlInputs: 3,
  requiredFeatures: ["http://lv2plug.in/ns/ext/urid#map"],
  optionalFeatures: [],
  lifecycle: { cycles: 30, instantiated: 30, failed: 0 },
  threads: { before: 1, afterFirstInstantiate: 1, afterAllFreed: 1, leaked: 0 },
  rtSafety: {
    interposer: true,
    blocks: 512,
    repeats: 3,
    swept: true,
    sweepApplicable: true,
    allocationsInRun: 0,
    allocationsMin: 0,
    variable: false,
    locksInRun: 0,
    syscallsInRun: 0,
  },
  exit: 0,
};
const DEEP = { ...QUICK, lifecycle: { cycles: 1000, instantiated: 1000, failed: 0 } };
const SOAK = {
  uri: "urn:swept",
  perRate: {
    "96000": { instantiated: true, seconds: 10800, rate: 96000, block: 512, windows: 10828, nonFiniteWindows: 0, silentWindows: 0, firstRmsDbfs: -30, lastRmsDbfs: -31 },
    "192000": { died: true },
  },
};

describe("the sweep's passes become one plugin's three blocks — translated, never judged", () => {
  const [plugin] = measuredPluginsFromSweep({ measurements: [QUICK], lifecycle: [DEEP], soak: [SOAK] });

  it("the deep lifecycle pass supersedes the quick one", () => {
    expect(plugin?.stability?.lifecycle).toEqual({ cycles: 1000, instantiated: 1000, failed: 0 });
  });

  it("the soak lands per rate, raw — a dead rate is written as dead and judged by nobody here", () => {
    expect(plugin?.stability?.soak?.sweptParams).toBe(true);
    expect(plugin?.stability?.soak?.perRate["192000"]).toEqual({ died: true });
    expect(plugin?.stability?.soak?.perRate["96000"]).toMatchObject({ seconds: 10800, blockFrames: 512, lastRmsDbfs: -31 });
  });

  it("the interposer's counts carry the pair they were taken at", () => {
    expect(plugin?.rtSafety).toMatchObject({ rate: 192000, blockFrames: 512, allocationsInRun: 0, swept: true });
  });

  it("the features are the instance's, with its CV-port count", () => {
    expect(plugin?.features).toEqual({ required: ["http://lv2plug.in/ns/ext/urid#map"], optional: [], cvPorts: 0 });
  });

  it("a signal exit is written as the signal; anything else is not a crash this reader can name", () => {
    const [segv] = measuredPluginsFromSweep({ measurements: [{ ...QUICK, crashed: true, exit: 139 }] });
    expect(segv?.stability?.crashes).toEqual([{ signal: "SIGSEGV" }]);
    const [timeout] = measuredPluginsFromSweep({ measurements: [{ ...QUICK, crashed: true, exit: 124 }] });
    expect(timeout?.stability?.crashes).toEqual([]);
  });

  it("a plugin the tool never instantiated has no topology, so no entry — nothing is invented", () => {
    const out = measuredPluginsFromSweep({ measurements: [{ uri: "urn:gone", exit: 139, crashed: true }, QUICK] });
    expect(out.map((p) => p.uri)).toEqual(["urn:swept"]);
  });

  it("parseJsonl keeps object lines and skips a plugin's banner", () => {
    expect(parseJsonl('using block size: 0\n{"uri":"a"}\n\n{"uri":"b"}\n')).toEqual([{ uri: "a" }, { uri: "b" }]);
  });
});

const HOST = { hostname: "ref-desk", realtimePriority: false, memoryLocked: false };

function doc(id: string, plugins: ReturnType<typeof measuredPluginsFromSweep>) {
  return buildMeasurementDocument(
    buildRun({
      id,
      measuredAt: "2026-09-07T04:29:53+02:00",
      dimensions: ["stability", "rtSafety", "features"],
      rates: [96000, 192000],
      tool: { name: "lv2-measure", version: "test" },
      host: HOST,
    }),
    plugins,
  );
}

describe("the hosting dimensions through the format and the merge", () => {
  const swept = measuredPluginsFromSweep({ measurements: [QUICK], lifecycle: [DEEP], soak: [SOAK] });

  it("a v1.1 document round-trips its three blocks through the reader", () => {
    const written = doc("shipped", swept);
    expect(written.formatVersion).toBe("1.7");
    const read = readMeasurementDocument(JSON.parse(serialiseMeasurementDocument(written)));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.document.plugins[0]?.stability).toEqual(swept[0]?.stability);
    expect(read.document.plugins[0]?.rtSafety).toEqual(swept[0]?.rtSafety);
    expect(read.document.plugins[0]?.features).toEqual(swept[0]?.features);
  });

  it("the shipped run resolves each hosting dimension, with its source named", () => {
    const merged = mergeMeasurements(doc("shipped", swept), undefined);
    expect(merged.sourceOf("urn:swept", "stability")).toBe("shipped");
    expect(merged.sourceOf("urn:swept", "rtSafety")).toBe("shipped");
    expect(merged.sourceOf("urn:swept", "features")).toBe("shipped");
    expect(merged.get("urn:swept")?.stability?.rates).toEqual([96000, 192000]);
    expect(merged.summary().bySource.stability).toEqual({ local: 0, shipped: 1 });
  });

  it("a local run replaces a WHOLE dimension and leaves the others shipped", () => {
    const local = measuredPluginsFromSweep({
      measurements: [{ ...QUICK, rtSafety: { ...QUICK.rtSafety, allocationsInRun: 7 } }],
    });
    // The local run covers rt-safety only: the dimensions it never asked stay shipped.
    const onlyRt = local.map(({ stability: _s, features: _f, ...rest }) => rest);
    const merged = mergeMeasurements(doc("shipped", swept), doc("local", onlyRt));
    expect(merged.sourceOf("urn:swept", "rtSafety")).toBe("local");
    expect(merged.get("urn:swept")?.rtSafety?.value.allocationsInRun).toBe(7);
    expect(merged.sourceOf("urn:swept", "stability")).toBe("shipped");
    expect(merged.get("urn:swept")?.stability?.value.lifecycle?.instantiated).toBe(1000);
  });

  it("a local probe that FAILED does not delete the shipped stability figure", () => {
    const failed = [{ uri: "urn:swept", topology: { audioInputs: 1, audioOutputs: 1 }, stability: { unmeasuredReason: "probe-crashed" } }];
    const merged = mergeMeasurements(doc("shipped", swept), doc("local", failed));
    expect(merged.sourceOf("urn:swept", "stability")).toBe("shipped");
    expect(merged.get("urn:swept")?.localProbeFailed).toEqual({ stability: "probe-crashed" });
  });
});

describe("the pin lv2-measure printed travels with the plugin (spec §11.3)", () => {
  const integrity = {
    version: "1.2",
    files: [
      { path: "swept.so", sha256: "a".repeat(64) },
      { path: "manifest.ttl", sha256: "b".repeat(64) },
    ],
    layout: { scheme: "omx-layout/1", sha256: "c".repeat(64) },
  };

  it("is carried as the prober printed it, its files sorted by path, and survives the reader", () => {
    const [plugin] = measuredPluginsFromSweep({ measurements: [{ ...QUICK, version: "1.2", integrity }] });
    expect(plugin?.version).toBe("1.2");
    expect(plugin?.integrity?.files?.map((f) => f.path)).toEqual(["manifest.ttl", "swept.so"]);
    const run = buildRun({
      id: "r",
      measuredAt: "2026-10-12T00:00:00Z",
      dimensions: ["stability"],
      rates: [192000],
      tool: { name: "lv2-measure", version: "1" },
      host: { hostname: "h", realtimePriority: false, memoryLocked: false },
    });
    const read = readMeasurementDocument(JSON.parse(serialiseMeasurementDocument(buildMeasurementDocument(run, [plugin!]))));
    expect(read.ok && read.document.plugins[0]?.integrity).toEqual(plugin?.integrity);
  });

  it("a line with no pin carries none", () => {
    const [plugin] = measuredPluginsFromSweep({ measurements: [QUICK] });
    expect(plugin?.integrity).toBeUndefined();
  });
});

describe("the note sweep lv2-measure printed travels in rtSafety (format 1.5)", () => {
  const sweep = { applicable: true, dialect: "midi", blocks: 512, blockFrames: 512, noteEvents: 6144, processErrors: 0, nonFinite: false,
    interposer: true, allocationsInRun: 4608, locksInRun: 0, syscallsInRun: 0, events: [{ kind: "malloc", module: "?", symbol: "?" }] };

  it("an instrument's sweep is kept, its counts by value, and survives the document's round trip", () => {
    const [plugin] = measuredPluginsFromSweep({ measurements: [{ ...QUICK, rtSafety: { ...QUICK.rtSafety, noteSweep: sweep } }] });
    const { events: _e, ...counted } = sweep;
    expect(plugin?.rtSafety?.noteSweep).toEqual(counted);
    const read = readMeasurementDocument(JSON.parse(serialiseMeasurementDocument(doc("synth", [plugin!]))));
    expect(read.ok && read.document.plugins[0]?.rtSafety?.noteSweep).toEqual(counted);
  });

  it("an effect's sweep reads not applicable, and a count it cannot vouch for is left out", () => {
    const [effect] = measuredPluginsFromSweep({ measurements: [{ ...QUICK, rtSafety: { ...QUICK.rtSafety, noteSweep: { applicable: false } } }] });
    expect(effect?.rtSafety?.noteSweep).toEqual({ applicable: false });
    const [bad] = measuredPluginsFromSweep({ measurements: [{ ...QUICK, rtSafety: { ...QUICK.rtSafety, noteSweep: { ...sweep, allocationsInRun: -1 } } }] });
    expect(bad?.rtSafety?.noteSweep?.allocationsInRun).toBeUndefined();
    const [none] = measuredPluginsFromSweep({ measurements: [QUICK] });
    expect(none?.rtSafety?.noteSweep).toBeUndefined();
  });
});

// fixtures/sweep-memory/lines.jsonl: lv2_measure's own memory-only lines, plugin-qualify 0.21.2, one per plugin and rate
const MEMORY_LINES = parseJsonl(readFileSync(new URL("../../fixtures/sweep-memory/lines.jsonl", import.meta.url), "utf8"));
const COMPRESSOR = "http://calf.sourceforge.net/plugins/Compressor";
const SAMPLER = "http://lsp-plug.in/plugins/lv2/sampler_mono";
const CRASHED = "http://www.drowaudio.co.uk/audio/audio_plugins/reverb";
const TOPOLOGY = [COMPRESSOR, SAMPLER, CRASHED].map((uri) => ({ uri, audioInputs: 2, audioOutputs: 2 }));
const sweptMemory = () => measuredPluginsFromSweep({ measurements: TOPOLOGY, cost: MEMORY_LINES }, ["cost"]);
const costOf = (uri: string) => sweptMemory().find((p) => p.uri === uri)?.cost;

describe("the cost pass lands cost and memory, one line per plugin and rate", () => {
  it("presence control: the fixture holds three plugins at three rates", () => {
    expect(MEMORY_LINES).toHaveLength(9);
  });

  it("a memory-only line lands its footprint at its rate, with the reason its timing is not there", () => {
    expect(Object.keys(costOf(COMPRESSOR)!.perRate)).toEqual(["48000", "96000", "192000"]);
    expect(costOf(COMPRESSOR)!.perRate["192000"]).toEqual({
      unmeasuredReason: "not-attempted",
      unmeasuredDetail: "a memory-only run takes the footprint alone",
      memory: { afterInstantiateKb: 10408, afterActivateKb: 10408, atRestKb: 10708, secondInstanceKb: 40 },
    });
  });

  it("an instrument's footprint carries the notes held and their basis", () => {
    expect(costOf(SAMPLER)!.perRate["192000"]!.memory).toMatchObject({ notesHeld: 1, basis: "probe" });
  });

  it("a footprint child that died keeps its reason and no figure", () => {
    expect(costOf(CRASHED)!.perRate["192000"]!.memory).toEqual({
      unmeasuredReason: "probe-crashed",
      unmeasuredDetail: "the footprint's child gave no figure (status 139)",
    });
  });

  it("a timed line lands its timing beside the footprint, under the document's names", () => {
    const memory = { atRestKb: 10 };
    const timed = { nsPerSampleMedian: 4, nsPerSampleP95: 6, nsPerSampleMin: 3, nsPerSampleMax: 9, blocks: 100, memory };
    const row = { ...QUICK, cost: { blockFrames: 512, perRate: { "192000": timed } } };
    expect(measuredPluginsFromSweep({ measurements: [row] }, ["cost"])[0]?.cost?.perRate["192000"]).toEqual({
      nsPerSampleMedian: 4, nsPerSamplePercentile: 6, nsPerSampleMin: 3, nsPerSampleMax: 9, blocks: 100, blockFrames: 512, memory,
    });
  });

  it("a later line of the same plugin and rate supersedes the earlier one", () => {
    const line = (kb: number) => ({ uri: COMPRESSOR, cost: { perRate: { "48000": { memory: { atRestKb: kb } } } } });
    const [plugin] = measuredPluginsFromSweep({ measurements: TOPOLOGY.slice(0, 1), cost: [line(1), line(2)] }, ["cost"]);
    expect(plugin?.cost?.perRate["48000"]?.memory).toEqual({ atRestKb: 2 });
  });

  it("a run emits the dimensions it covers and no other", () => {
    expect(Object.keys(sweptMemory()[0]!).sort()).toEqual(["cost", "topology", "uri"]);
    expect(measuredPluginsFromSweep({ measurements: [QUICK], cost: MEMORY_LINES })[0]).not.toHaveProperty("cost");
  });

  it("the document keeps a memory-only rate through a write and a read", () => {
    const written = buildMeasurementDocument(
      buildRun({ id: "mem", measuredAt: "2026-11-24T19:41:00+01:00", dimensions: ["cost"], rates: [48000, 96000, 192000], tool: { name: "lv2_measure", version: "0.21.2" }, host: doc("h", []).run.host }),
      sweptMemory(),
    );
    const read = readMeasurementDocument(JSON.parse(serialiseMeasurementDocument(written)));
    expect(read.ok && read.document.plugins).toEqual(written.plugins);
  });

  it("a memory-only block is no cost reading: the merge keeps the timed one and resolves none by itself", () => {
    const timed = { perRate: { "192000": { nsPerSampleMedian: 4, nsPerSamplePercentile: 6, blocks: 100, blockFrames: 512 } } };
    const memoryOnly = sweptMemory().filter((p) => p.uri === COMPRESSOR);
    const shipped = doc("shipped", [{ ...memoryOnly[0]!, cost: timed }]);
    expect(mergeMeasurements(shipped, doc("local", memoryOnly)).get(COMPRESSOR)?.cost?.value).toEqual(timed);
    expect(mergeMeasurements(doc("shipped", memoryOnly), undefined).get(COMPRESSOR)?.cost).toBeUndefined();
  });
});
