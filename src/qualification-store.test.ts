// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The sync's calls into the qualification store (the store spec's section 6.1), against a stand-in that follows the
 * documented interface (`store-fake.support.ts`): the verbs and flags each call uses, the refusals the writer gives,
 * surfaced to the user by code and path, the absent store, and a command that is not installed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { QualificationStore, StoreError, shadowKeyOf, type StoredRecord } from "./qualification-store.js";
import { FIXTURES, LV2_CLEAN, CLAP_RT, stored } from "./qualify-rejudge.support.js";
import { readProbeOutput } from "./probe-output.js";
import { fakeStore } from "./store-fake.support.js";
import { storeExport } from "./store-export.support.js";

function exported(stem: string, hostClass = "x86-64"): StoredRecord {
  const probe = readProbeOutput(readFileSync(join(FIXTURES, `${stem}.probe.json`), "utf8"));
  if (!probe.ok) throw new Error(probe.problem);
  return storeExport(stored(stem), probe.output, undefined, hostClass);
}

describe("QualificationStore writes through plugin-qualification-db-write", () => {
  it("put: one record on standard input, the scope and the shadow key as flags", () => {
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const r = exported(LV2_CLEAN);
    store.put(shadowKeyOf(r), r.record);
    expect(fake.calls).toEqual([`write put --scope user --offer ${r.offer} --host-class x86-64`]);
    expect(fake.user().map((u) => u.record.plugin.id)).toEqual([r.uri]);
  });

  it("the system scope is the writer's --scope system", () => {
    const fake = fakeStore();
    const r = exported(LV2_CLEAN);
    new QualificationStore("system", { run: fake.run }).put(shadowKeyOf(r), r.record);
    expect(fake.calls[0]).toContain("--scope system");
  });

  it("a newer record of the same shadow key replaces the older, whole", () => {
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const r = exported(LV2_CLEAN);
    store.put(shadowKeyOf(r), r.record);
    store.put(shadowKeyOf(r), { ...r.record, measuredAt: "2030-01-01T00:00:00.000Z" });
    expect(fake.user()).toHaveLength(1);
    expect(fake.user()[0]!.record.measuredAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it.each([
    ["path-absolute", (r: any) => { r.binary.path = "/usr/lib/lv2/x.lv2/amp.so"; }, "/usr/lib/lv2/x.lv2/amp.so"],
    ["files-empty", (r: any) => { r.binary.files = []; }, ""],
    ["files-unordered", (r: any) => { r.binary.files = [...r.binary.files].reverse(); }, ""],
    ["files-duplicate", (r: any) => { r.binary.files = [r.binary.files[0], ...r.binary.files]; }, ""],
    ["binary-not-in-files", (r: any) => { r.binary.path = "elsewhere.so"; }, "elsewhere.so"],
    ["key-not-the-binary", (r: any) => { r.binary.sha256 = "e".repeat(64); }, ""],
  ])("%s is surfaced as the writer gave it, and nothing is written", (code, break_, path) => {
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const r = exported(LV2_CLEAN);
    const doc = JSON.parse(JSON.stringify(r.record));
    break_(doc);
    let caught: unknown;
    try {
      store.put(shadowKeyOf(r), doc);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StoreError);
    expect((caught as StoreError).code).toBe(code);
    expect((caught as StoreError).message).toContain(code);
    expect((caught as StoreError).message).toContain(path);
    expect(fake.user()).toEqual([]);
  });

  it("delete: the shadow key as flags; a key the layer does not hold is not an error", () => {
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const r = exported(LV2_CLEAN);
    store.put(shadowKeyOf(r), r.record);
    store.delete(shadowKeyOf(r));
    store.delete(shadowKeyOf(r));
    expect(fake.user()).toEqual([]);
    expect(fake.calls[1]).toBe(`write delete --scope user --sha256 ${r.sha256} --format lv2 --uri ${r.uri} --offer ${r.offer} --host-class x86-64`);
  });

  it("a command that is not installed is named", () => {
    const store = new QualificationStore("user", { run: (tool) => ({ status: null, stdout: "", stderr: "", missing: true, ...(tool === "write" ? {} : {}) }) });
    const r = exported(LV2_CLEAN);
    expect(() => store.put(shadowKeyOf(r), r.record)).toThrow("command missing: plugin-qualification-db-write");
    expect(() => store.userRecords()).toThrow("command missing: plugin-qualification-db");
  });
});

describe("QualificationStore reads through plugin-qualification-db", () => {
  it("userRecords: query --json --records --layer user, once, and kept current by its own writes", () => {
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const a = exported(LV2_CLEAN);
    const b = exported(CLAP_RT);
    store.put(shadowKeyOf(a), a.record);
    expect(store.userRecords().map((r) => r.uri)).toEqual([a.uri]);
    store.put(shadowKeyOf(b), b.record);
    expect(store.userRecords().map((r) => r.uri).sort()).toEqual([a.uri, b.uri].sort());
    store.delete(shadowKeyOf(a));
    expect(store.userRecords().map((r) => r.uri)).toEqual([b.uri]);
    expect(fake.calls.filter((c) => c.startsWith("read query"))).toEqual(["read query --scope user --json --records --layer user"]);
  });

  it("record(key) is the user layer's record of that key, or undefined", () => {
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const a = exported(LV2_CLEAN);
    expect(store.record(shadowKeyOf(a))).toBeUndefined();
    store.put(shadowKeyOf(a), a.record);
    expect(store.record(shadowKeyOf(a))?.plugin.id).toBe(a.uri);
  });

  it("results: query --json with the item's format, uri, binary path and host class; the base shadowed by the user layer", () => {
    const base = exported(LV2_CLEAN);
    const fake = fakeStore({ base: [{ ...base, layer: "base" }] });
    const store = new QualificationStore("user", { run: fake.run });
    expect(store.results({ format: "lv2", uri: base.uri, hostClass: "x86-64" }).map((r) => r.layer)).toEqual(["base"]);
    expect(fake.calls[0]).toBe(`read query --scope user --json --format lv2 --uri ${base.uri} --host-class x86-64`);
    store.put(shadowKeyOf(base), base.record);
    expect(store.results({ format: "lv2", uri: base.uri, hostClass: "x86-64" }).map((r) => r.layer)).toEqual(["user"]);
    store.results({ format: "clap", uri: "id", binaryPath: "x.clap", hostClass: "x86-64" });
    expect(fake.calls.at(-1)).toContain("--binary-path x.clap");
  });

  it("counts: counts --layer user --json, one line a format", () => {
    const fake = fakeStore();
    const store = new QualificationStore("user", { run: fake.run });
    const a = exported(LV2_CLEAN);
    store.put(shadowKeyOf(a), a.record);
    expect(store.counts()).toEqual([{ format: "lv2", plugins: 1, offered: a.record.tiers.offeredOn.length > 0 ? 1 : 0, not_offered: a.record.tiers.offeredOn.length > 0 ? 0 : 1 }]);
    expect(fake.calls.at(-1)).toBe("read counts --scope user --layer user --json");
  });

  it("an absent store is refused by its name, and nothing is taken", () => {
    const store = new QualificationStore("user", { run: fakeStore({ absent: true }).run });
    expect(() => store.userRecords()).toThrow(/qualification-db\.absent/);
    try {
      store.userRecords();
    } catch (e) {
      expect((e as StoreError).code).toBe("qualification-db.absent");
    }
  });

  it("a verb the command does not have is named, not skipped", () => {
    const store = new QualificationStore("user", { run: () => ({ status: 2, stdout: "", stderr: "usage: plugin-qualification-db query|check" }) });
    expect(() => store.counts()).toThrow(/unknown verb counts/);
  });
});

describe("storedForm keeps what the store maps", () => {
  it("the package object stays, and the fields without a column go", async () => {
    const { storedForm } = await import("./qualification-record.js");
    const r = exported(LV2_CLEAN).record;
    const pkg = { format: "rpm", name: "x", version: "1", release: "1", distro: "fc45", arch: "x86_64" };
    const out = storedForm({ ...r, package: pkg, rules: "plugin-qualify-rules/1.0", latencyLineMs: 5 } as never) as unknown as Record<string, unknown>;
    expect(out["package"]).toEqual(pkg);
    expect(out["rules"]).toBeUndefined();
    expect(out["latencyLineMs"]).toBeUndefined();
  });
});
