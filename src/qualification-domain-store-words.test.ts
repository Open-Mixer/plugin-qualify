// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The words the qualification record store checks (the store spec, section 3.4) are items of the qualification domain:
 * every word a real record holds, at the field that spec maps to a checked column, is a word of that column's item.
 * The fixture is a cover of the real records' words (fixtures/store-words/records.json), trimmed to those fields.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(readFileSync(join(PKG, "contract.d", "qualification", "qualification.json"), "utf8")) as {
  info: { version: string };
  components: { schemas: Record<string, { oneOf: { const: string; "x-from"?: unknown[] }[] }> };
};
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
const fixture = JSON.parse(readFileSync(join(PKG, "fixtures", "store-words", "records.json"), "utf8")) as {
  records: { dir: string; offer: string; record: Obj }[];
  provenance: Obj[];
};

const arr = (x: Json | undefined): Obj[] => (Array.isArray(x) ? (x as Obj[]) : []);
const obj = (x: Json | undefined): Obj => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : {});
const strs = (xs: (Json | undefined)[]): string[] => xs.filter((x): x is string => typeof x === "string");
const reasons = (r: Obj): Obj[] => [...arr(r.verdicts).flatMap((v) => arr(v.reasons)), ...arr(r.cost).flatMap((c) => arr(c.reasons))];
const tierRows = (r: Obj): { name: string; row: Obj }[] =>
  ["inProcess", "isolated"].flatMap((name) => (name in obj(r.tiers) ? [{ name, row: obj(obj(r.tiers)[name]) }] : []));

/** item -> the words the records hold at the store spec's columns for it (section 3.4, the JSON paths of 3.5). */
const held: Record<string, (rec: { dir: string; offer: string; record: Obj }) => string[]> = {
  QUALIFICATION_HOST_CLASSES: (x) => [x.dir],
  QUALIFICATION_OFFERS: (x) => [x.offer],
  QUALIFICATION_HOST_PROFILES: (x) => {
    const r = x.record;
    return strs([
      ...arr(r.verdicts).map((v) => v.host),
      ...arr(r.cost).map((c) => c.host),
      ...tierRows(r).map((t) => t.row.host),
    ]);
  },
  // The host a plugin RAN UNDER, not a judge profile: record.adapter_host and the <host> of an adapter code `<host>.<kind>[-<parameter>]`.
  QUALIFICATION_ADAPTER_HOSTS: (x) => {
    const r = x.record;
    const codes = [...arr(obj(r.run).steps).map((s) => s.code), ...reasons(r).map((q) => q.code)];
    // An adapter code is `<host>.<kind>[-<parameter>]`, the kind a word of QUALIFICATION_ADAPTER_CODE_KINDS; other codes are other items' words.
    const kinds = wordsOf("QUALIFICATION_ADAPTER_CODE_KINDS");
    const adapterCodes = strs(codes).filter((c) => kinds.some((k) => new RegExp(`^[a-z][a-z-]*\\.${k}(-[A-Za-z0-9]+)?$`).test(c)));
    return strs([obj(r.adapter).host, ...adapterCodes.map((c) => c.split(".")[0])]);
  },
  QUALIFICATION_VERDICT_HOSTINGS: (x) => strs(arr(x.record.verdicts).map((v) => v.hosting)),
  QUALIFICATION_VERDICT_ARMS: (x) => strs(arr(x.record.verdicts).map((v) => v.arm)),
  QUALIFICATION_REASON_PARAMS: (x) => reasons(x.record).flatMap((q) => Object.keys(obj(q.params))),
  QUALIFICATION_REASON_PARAM_WORDS: (x) => reasons(x.record).flatMap((q) => strs(Object.values(obj(q.params)))),
  QUALIFICATION_RECORD_TIERS: (x) => [...tierRows(x.record).map((t) => t.name), ...strs(Array.isArray(obj(x.record.tiers).offeredOn) ? (obj(x.record.tiers).offeredOn as Json[]) : [])],
  QUALIFICATION_MEMORY_LIMIT_MECHANISMS: (x) => strs(arr(obj(x.record.measurements).grid).map((g) => obj(g.memoryLimit).mechanism)),
  QUALIFICATION_NOTE_SWEEP_DIALECTS: (x) => strs(arr(obj(x.record.measurements).grid).map((g) => obj(g.noteSweep).dialect)),
  QUALIFICATION_RUN_STEPS: (x) => strs(arr(obj(x.record.run).steps).map((s) => s.step)),
  // run_step.result also holds plugin-hostd's probe outcomes (`probe.*`), which that owner's item holds.
  QUALIFICATION_STEP_RESULTS: (x) => strs(arr(obj(x.record.run).steps).map((s) => s.result)).filter((w) => !w.startsWith("probe.")),
  QUALIFICATION_STEP_CODES: (x) => strs(arr(obj(x.record.run).steps).map((s) => s.code)),
  QUALIFICATION_REJUDGE_OWES: (x) => strs(arr(obj(x.record.rejudged).owes).map((o) => o.code)),
  QUALIFICATION_REJUDGE_MEASUREMENTS: (x) => strs(arr(obj(x.record.rejudged).owes).map((o) => o.measurement)),
  QUALIFICATION_MEASUREMENT_DIMENSIONS: (x) =>
    strs([
      ...reasons(x.record).map((q) => q.dimension),
      ...arr(obj(x.record.measurements).unmeasured).map((u) => u.dimension),
      ...arr(x.record.notMeasured).map((u) => u.dimension),
    ]),
};

const wordsOf = (item: string): string[] => (doc.components.schemas[item]?.oneOf ?? []).map((w) => w.const);

describe("the record store's words are items of the qualification domain", () => {
  for (const [item, get] of Object.entries(held)) {
    it(`${item} holds every word the records hold`, () => {
      const items = wordsOf(item);
      expect(items.length, `${item} is not an item of the domain`).toBeGreaterThan(0);
      const want = new Set(fixture.records.flatMap(get));
      expect(want.size, `the fixture holds no word for ${item}`).toBeGreaterThan(0);
      expect([...want].filter((w) => !items.includes(w)).sort()).toEqual([]);
    });
  }
  it("QUALIFICATION_SET_TIERS and QUALIFICATION_SYNC_SETTINGS hold every word the sets' provenance holds", () => {
    const tiers = new Set(strs(fixture.provenance.map((p) => p.tier)));
    const keys = new Set(fixture.provenance.flatMap((p) => Object.keys(obj(p.settings))));
    const profiles = new Set(strs(fixture.provenance.map((p) => p.hostProfile)));
    const classes = new Set(strs(fixture.provenance.map((p) => p.hostClass)));
    expect(wordsOf("QUALIFICATION_SET_TIERS").length).toBeGreaterThan(0);
    expect([...tiers].filter((w) => !wordsOf("QUALIFICATION_SET_TIERS").includes(w))).toEqual([]);
    expect([...keys].filter((w) => !wordsOf("QUALIFICATION_SYNC_SETTINGS").includes(w))).toEqual([]);
    expect([...profiles].filter((w) => !wordsOf("QUALIFICATION_HOST_PROFILES").includes(w))).toEqual([]);
    expect([...classes].filter((w) => !wordsOf("QUALIFICATION_HOST_CLASSES").includes(w))).toEqual([]);
  });
  it("QUALIFICATION_VERDICT_HOSTINGS holds every HostingPath the producer can write, as it writes it", () => {
    const src = readFileSync(join(PKG, "src", "hosting-suitability.ts"), "utf8");
    const m = /export type HostingPath = ([^;]+);/.exec(src);
    expect(m, "HostingPath is not declared in hosting-suitability.ts").not.toBeNull();
    const paths = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1] as string);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((w) => !wordsOf("QUALIFICATION_VERDICT_HOSTINGS").includes(w))).toEqual([]);
  });
  it("the package words are items: deb and rpm, their distros and arches", () => {
    expect(wordsOf("QUALIFICATION_PACKAGE_FORMATS")).toEqual(["deb", "rpm"]);
    expect(wordsOf("QUALIFICATION_PACKAGE_DISTROS")).toEqual(["trixie", "fc44", "fc45"]);
    expect(wordsOf("QUALIFICATION_PACKAGE_ARCHES")).toEqual(["arm64", "amd64", "all", "aarch64", "x86_64", "noarch"]);
  });
  it("hostAdmission and memory are measurable dimensions", () => {
    for (const w of ["memory", "hostAdmission"]) expect(wordsOf("QUALIFICATION_MEASUREMENT_DIMENSIONS")).toContain(w);
  });
  it("the domain is a minor above 1.1.0", () => {
    const [maj, min] = doc.info.version.split(".").map(Number);
    expect(maj).toBe(1);
    expect(min).toBeGreaterThanOrEqual(2);
  });
});
