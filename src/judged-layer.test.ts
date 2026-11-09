// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The judged layer plugin-qualify writes for plugin-db, from a record: every field plugin-db's state function reads, the
 * latency line and the rules declared once, the verdict the pins file gives the same bytes. And the round trip: the
 * layer, given to plugin-db's own reader (its TypeScript twin, when a plugin-db checkout is named by PLUGIN_DB_DIR or
 * sits beside this one), answers qualified at a measured rate and quantum, and conditions-unmet at another.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OMX_CLAP_HOST_PROFILE, OPENMIXER_CONSOLE_PROFILE } from "./host-profiles.js";
import { HOSTING_EPOCH, JUDGED_HOST, judgedCells, judgedLayerOf, PLUGIN_DB_ENVELOPE, type JudgedLayer } from "./judged-layer.js";
import { judgementRules, LATENCY_LINE_MS, latencyMsOf } from "./judgement-line.js";
import { judgeProbeOutput } from "./probe-judge.js";
import { fixtureJson } from "./probe-output-fixtures.js";
import { readProbeOutput } from "./probe-output.js";
import { buildQualificationRecord, type QualificationRecord } from "./qualification-record.js";

const PIN = { files: "a".repeat(64), layout: `omx-layout/1:${"b".repeat(64)}` };

function recordOf(patch: (d: Record<string, any>) => void = () => {}): QualificationRecord {
  const d = fixtureJson("success-msi");
  patch(d);
  const r = readProbeOutput(JSON.stringify(d));
  if (!r.ok) throw new Error(r.problem);
  return buildQualificationRecord(judgeProbeOutput(r.output, [OPENMIXER_CONSOLE_PROFILE, OMX_CLAP_HOST_PROFILE]), { file: "x.probe.json", sha256: "0".repeat(64), bytes: 1 });
}

const layerOf = (rec: QualificationRecord, extra: Partial<Parameters<typeof judgedLayerOf>[1]> = {}) => judgedLayerOf(rec, { machineClass: "x86-64", pin: PIN, ...extra });
const mustLayer = (x: ReturnType<typeof judgedLayerOf>): JudgedLayer => {
  if (!("envelope" in x)) throw new Error(x.reason);
  return x;
};

describe("the declarations a record carries", () => {
  it("the latency line is 5 ms, and a record states it with the rules it was judged by", () => {
    expect(LATENCY_LINE_MS).toBe(5);
    const rec = recordOf();
    expect(rec.latencyLineMs).toBe(LATENCY_LINE_MS);
    expect(rec.rules).toBe(judgementRules());
    expect(judgementRules()).toMatch(/^plugin-qualify-rules\/\d+\.\d+$/);
  });

  it("the rules are the minor of the plugin-qualify that judged: a patch release changes none", () => {
    expect(judgementRules("0.19.1")).toBe("plugin-qualify-rules/0.19");
    expect(judgementRules("0.19.4")).toBe(judgementRules("0.19.1"));
    expect(judgementRules("0.20.0")).not.toBe(judgementRules("0.19.4"));
    expect(() => judgementRules("next")).toThrow();
  });

  it("each measured cell carries its latency in milliseconds at its rate", () => {
    expect(latencyMsOf(48, 48000)).toBe(1);
    expect(latencyMsOf(32, 96000)).toBeCloseTo(0.333333, 6);
    const rec = recordOf((d) => {
      d.grid[0].latency = { declaredFrames: 0, measuredFrames: 240 };
    });
    const at = rec.measurements.grid[0]!;
    expect(at.latencyMs).toBe(latencyMsOf(240, at.rate));
    const none = recordOf((d) => {
      delete d.grid[0].latency;
    });
    expect(none.measurements.grid[0]!.latencyMs).toBeUndefined();
  });
});

describe("a record's judged layer", () => {
  it("is plugin-db's envelope, written by plugin-qualify for the pin it is given, at <format>:<id>", () => {
    const rec = recordOf();
    const l = mustLayer(layerOf(rec));
    expect(l.envelope).toBe(PLUGIN_DB_ENVELOPE);
    expect(l.layer).toBe("judged");
    expect(l.writer).toBe("plugin-qualify");
    expect(l.pin).toEqual(PIN);
    expect(l.address).toBe(`${rec.plugin.format}:${rec.plugin.id}`);
    expect(mustLayer(layerOf(rec, { address: "clap@x:y" })).address).toBe("clap@x:y");
  });

  it("carries every field the state function reads, from the record and the declarations", () => {
    const rec = recordOf();
    const b = mustLayer(layerOf(rec)).body;
    expect(Object.keys(b).sort()).toEqual(["cells", "conditions", "host", "latencyLineMs", "machineClass", "recordSchema", "rules", "verdict"]);
    expect(b.machineClass).toBe("x86-64");
    expect(b.host).toEqual({ name: JUDGED_HOST, version: /plugin-hostd-probe (\S+)/.exec(Object.values(rec.tool).join(" "))?.[1], hostingEpoch: HOSTING_EPOCH[JUDGED_HOST] });
    expect(b.rules).toBe(rec.rules);
    expect(b.recordSchema).toBe(rec.schema);
    expect(b.latencyLineMs).toBe(LATENCY_LINE_MS);
    expect(b.cells).toEqual(judgedCells(rec));
    expect(b.cells.length).toBe(rec.measurements.grid.filter((p) => p.outcome === "probe.ok").length);
  });

  it("its verdict is the pins file's for the same bytes: omx-clap-host's rating in plugin-hostd's words", () => {
    const rec = recordOf();
    const under = rec.verdicts.find((v) => v.host === "omx-clap-host")!;
    const want = { suitable: "in-process", conditional: "isolated", unsuitable: "refused" }[under.rating];
    expect(mustLayer(layerOf(rec)).body.verdict).toBe(want);
    for (const [rating, word] of [["suitable", "in-process"], ["conditional", "isolated"], ["unsuitable", "refused"]] as const) {
      const r = { ...rec, verdicts: rec.verdicts.map((v) => (v.host === "omx-clap-host" ? { ...v, rating, measured: true } : v)) };
      expect(mustLayer(layerOf(r)).body.verdict).toBe(word);
    }
  });

  it("is not written when the verdict was not measured, and says why", () => {
    const rec = recordOf();
    const r = { ...rec, verdicts: rec.verdicts.map((v) => (v.host === "omx-clap-host" ? { ...v, measured: false, rating: "unknown", deciding: "probe.timeout" } : v)) };
    expect(layerOf(r)).toEqual({ layer: null, reason: "omx-clap-host: not measured (probe.timeout)" });
    const gone = { ...rec, verdicts: rec.verdicts.filter((v) => v.host !== "omx-clap-host") };
    expect((layerOf(gone) as { reason: string }).reason).toMatch(/no verdict under omx-clap-host/);
  });

  it("a record from before the rules were stated takes them from the plugin-qualify that judged its set, or has no layer", () => {
    const { rules: _r, latencyLineMs: _l, ...old } = recordOf();
    expect((layerOf(old as QualificationRecord) as { reason: string }).reason).toMatch(/no rules/);
    const l = mustLayer(layerOf(old as QualificationRecord, { judgedBy: "0.19.1" }));
    expect(l.body.rules).toBe("plugin-qualify-rules/0.19");
    expect(l.body.latencyLineMs).toBe(LATENCY_LINE_MS);
  });

  it("a record with no plugin-hostd-probe version has no layer: the host version is never guessed", () => {
    const rec = { ...recordOf(), tool: { runner: "something-else 1.0" } };
    expect((layerOf(rec) as { reason: string }).reason).toMatch(/plugin-hostd-probe/);
  });
});

/** plugin-db's twin, from a checkout: PLUGIN_DB_DIR, else a sibling `plugin-db` of this tree or of its parent. */
function pluginDbReader(): string | undefined {
  const here = new URL("..", import.meta.url).pathname;
  const c = [process.env.PLUGIN_DB_DIR, join(here, "..", "plugin-db"), join(here, "..", "..", "plugin-db")].filter((x): x is string => !!x);
  return c.map((d) => join(d, "ts", "src", "reader.ts")).find((p) => existsSync(p) && readFileSync(p, "utf8").includes("export function read("));
}

const reader = pluginDbReader();

describe.skipIf(reader === undefined)("the round trip through plugin-db's reader", () => {
  it("the layer answers qualified at a measured cell, with the figure against the line, and conditions-unmet at another", async () => {
    const { read } = (await import(/* @vite-ignore */ reader!)) as { read: (e: unknown, h: unknown) => Record<string, any> };
    const rec = recordOf((d) => {
      for (const p of d.grid) p.latency = { declaredFrames: 0, measuredFrames: 96 };
    });
    const r0 = { ...rec, verdicts: rec.verdicts.map((v) => (v.host === "omx-clap-host" ? { ...v, rating: "suitable", measured: true } : v)) };
    const l = mustLayer(layerOf(r0));
    const cell = l.body.cells[0]!;
    const entry = { files: "same", currentLayout: PIN.layout, pinned: { pin: PIN, body: {} }, judged: { pin: l.pin, body: l.body }, reference: null, warnedOverride: null };
    const here = { machineClass: "x86-64", hostName: JUDGED_HOST, hostVersion: l.body.host.version, hostingEpoch: HOSTING_EPOCH[JUDGED_HOST], rules: judgementRules(), recordSchema: rec.schema, rate: cell.rate, quantum: cell.quantum, facts: [] };
    const a = read(entry, here);
    expect([a.state, a.runs, a.reason, a.source, a.tier]).toEqual(["qualified", "shared", "verdict-allows", "local", "in-process"]);
    expect(a.figures).toEqual({ rate: cell.rate, quantum: cell.quantum, latencyMs: latencyMsOf(96, cell.rate), lineMs: LATENCY_LINE_MS, standing: "within" });
    expect(read(entry, { ...here, quantum: 7 }).state).toBe("conditions-unmet");
    expect(read(entry, { ...here, machineClass: "rpi5" }).state).not.toBe("qualified");
  });
});

describe("plugin-qualify judged-layer", () => {
  it("parses a record, the class word and the pin; refuses a pin that is no digest and a missing class", async () => {
    const { parseJudgedLayerArgs } = await import("./judged-layer.js");
    const ok = parseJudgedLayerArgs(["r.json", "--machine-class", "x86-64", "--files", PIN.files, "--layout", PIN.layout, "--body"]);
    expect(ok).toEqual({ ok: true, args: { record: "r.json", machineClass: "x86-64", files: PIN.files, layout: PIN.layout, body: true } });
    expect(parseJudgedLayerArgs(["r.json", "--files", PIN.files])).toEqual({ ok: false, error: "--machine-class is required" });
    expect(parseJudgedLayerArgs(["r.json", "--machine-class", "x", "--files", "abc"]).ok).toBe(false);
    expect(parseJudgedLayerArgs(["r.json", "--machine-class", "x", "--files", PIN.files, "--layout", "nope"]).ok).toBe(false);
    expect(parseJudgedLayerArgs(["--machine-class", "x", "--files", PIN.files]).ok).toBe(false);
  });

  it("the built command prints the layer, the body for plugin-db put, and exits 1 with the reason for no layer", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { spawnSync } = await import("node:child_process");
    const bin = new URL("../bin/plugin-qualify.mjs", import.meta.url).pathname;
    if (!existsSync(new URL("../dist/index.js", import.meta.url))) return expect.fail("dist/ is not built: npm run build");
    const dir = mkdtempSync(join(tmpdir(), "pq-judged-"));
    const rec = recordOf();
    const good = { ...rec, verdicts: rec.verdicts.map((v) => (v.host === "omx-clap-host" ? { ...v, rating: "suitable", measured: true } : v)) };
    writeFileSync(join(dir, "good.json"), JSON.stringify(good));
    const run = (...a: string[]) => spawnSync(process.execPath, [bin, "judged-layer", ...a], { encoding: "utf8" });
    const out = run(join(dir, "good.json"), "--machine-class", "x86-64", "--files", PIN.files);
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(mustLayer(layerOf(good, { pin: { files: PIN.files, layout: null } })));
    const body = run(join(dir, "good.json"), "--machine-class", "x86-64", "--files", PIN.files, "--body");
    expect(JSON.parse(body.stdout).verdict).toBe("in-process");
    const bad = { ...rec, verdicts: rec.verdicts.map((v) => (v.host === "omx-clap-host" ? { ...v, measured: false, rating: "unknown", deciding: "probe.timeout" } : v)) };
    writeFileSync(join(dir, "bad.json"), JSON.stringify(bad));
    const none = run(join(dir, "bad.json"), "--machine-class", "x86-64", "--files", PIN.files);
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/no judged layer: omx-clap-host: not measured \(probe\.timeout\)/);
  });
});
