// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The `qualification` domain is plugin-hostd's (contract.d/qualification/ of plugin-hostd, the vocabulary sorting pass, row V5):
 * this package keeps no copy, reads the installed one, and requires plugin-hostd-contract for it. The words are frozen in
 * fixtures/qualification-golden.json (item -> [title, word] pairs), taken from this package's own domain 1.4.0 at 2d6aefc;
 * QUALIFICATION_MACHINE_CLASSES, which nothing reads, is dropped by plugin-hostd 0.21.0: the golden file lacks it and the domain
 * must too.
 *
 *  a. golden: the domain the package reads holds the golden words;
 *  c. sabotage: a scratch contract directory with one word removed is refused by name by the vocabulary the package builds;
 *  d. no copy of the domain stays in this tree, and the packaging names plugin-hostd-contract and not plugin-qualify's own -contract package.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVocabulary } from "./measurement/vocabulary.js";
import { openQualificationDomainAt } from "./qualification-domain-node.js";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(PKG, rel), "utf8");
const golden = JSON.parse(read("fixtures/qualification-golden.json")) as Record<string, [string, string][]>;

type Doc = { components: { schemas: Record<string, { oneOf: { const: string; title: string }[] }> } };
const pairs = (doc: Doc): Record<string, [string, string][]> =>
  Object.fromEntries(Object.entries(doc.components.schemas).map(([k, v]) => [k, v.oneOf.map((e): [string, string] => [e.title, e.const])]));

describe("the words the package reads are the golden ones", () => {
  it("the domain of the contract directory the tests read holds every golden item and word", () => {
    const doc = JSON.parse(readFileSync(join(INSTALLED_CONTRACT_DIR, "qualification", "qualification.json"), "utf8")) as Doc;
    const got = pairs(doc);
    expect(Object.keys(got).sort()).toEqual(Object.keys(golden).sort());
    for (const [item, words] of Object.entries(golden)) {
      expect(got[item], item).toEqual(words);
    }
  });
  it("the reader opens it and builds the vocabulary", () => {
    expect(buildVocabulary(openQualificationDomainAt(INSTALLED_CONTRACT_DIR)).VOICE_BASES).toEqual(["declared", "probe"]);
  });
  it("a scratch contract directory with one word removed is refused by name", () => {
    const dir = mkdtempSync(join(tmpdir(), "qualification-owner-"));
    try {
      cpSync(join(INSTALLED_CONTRACT_DIR, "qualification"), join(dir, "qualification"), { recursive: true });
      const file = join(dir, "qualification", "qualification.json");
      const doc = JSON.parse(readFileSync(file, "utf8")) as Doc;
      const item = doc.components.schemas.QUALIFICATION_MEASUREMENT_LATENCY_SCALING!;
      item.oneOf = item.oneOf.filter((e) => e.title !== "fixedFrame");
      writeFileSync(file, JSON.stringify(doc));
      expect(pairs(doc).QUALIFICATION_MEASUREMENT_LATENCY_SCALING).not.toEqual(golden.QUALIFICATION_MEASUREMENT_LATENCY_SCALING);
      expect(() => buildVocabulary(openQualificationDomainAt(dir))).toThrow(/QUALIFICATION_MEASUREMENT_LATENCY_SCALING/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// the pruned package's name, built from its parts: this guard asserts it is absent, so the literal never stands in the tree
const OLD_PACKAGE = ["plugin-qualify", "contract"].join("-");

describe("the domain is plugin-hostd's: no copy here, packaging names its package", () => {
  it("this tree holds no qualification domain", () => {
    expect(existsSync(join(PKG, "contract.d", "qualification"))).toBe(false);
    expect(existsSync(join(PKG, "debian", `${OLD_PACKAGE}.install`))).toBe(false);
  });
  it("the spec and debian/control require plugin-hostd-contract and build or name no old -contract package of plugin-qualify", () => {
    const spec = read("packaging/plugin-qualify.spec").split("%changelog")[0]!;
    const control = read("debian/control");
    const rules = read("debian/rules");
    for (const [name, text] of [["spec", spec], ["control", control], ["rules", rules], ["release.yml", read(".github/workflows/release.yml")]] as const) {
      expect(text, name).not.toContain(OLD_PACKAGE);
      expect(text, name).not.toMatch(/contract\.d\/qualification/);
    }
    expect(spec).toMatch(/^Requires: plugin-hostd-contract >= \d+\.\d+\.\d+$/m);
    expect(control).toMatch(/plugin-hostd-contract \(>= \d+\.\d+\.\d+~\)/);
    expect(spec).not.toMatch(/^%package contract$/m);
    for (const rel of ["Breaks", "Replaces", "Conflicts", "Provides", "Obsoletes"]) {
      expect(spec, rel).not.toMatch(new RegExp(`^${rel}:.*qualify`, "m"));
      expect(control, rel).not.toMatch(new RegExp(`^${rel}:.*qualify`, "m"));
    }
  });
});
