// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The package reads the qualification domain (contract.d/qualification/) at run time: the words it uses are the JSON's, a
 * word changed there is the word the consumer reads, and a document the package cannot use is refused by name.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVocabulary } from "./measurement/vocabulary.js";
import { openQualificationDomainAt } from "./qualification-domain.js";

const CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "contract.d");

describe("the package reads its words from the installed JSON", () => {
  const fixture = (edit: (d: { components: { schemas: Record<string, { oneOf: object[] }> } }) => void): string => {
    const dir = mkdtempSync(join(tmpdir(), "qualification-domain-"));
    cpSync(CONTRACT_DIR, dir, { recursive: true });
    const file = join(dir, "qualification", "qualification.json");
    const d = JSON.parse(readFileSync(file, "utf8"));
    edit(d);
    writeFileSync(file, `${JSON.stringify(d, null, 2)}\n`);
    return dir;
  };
  it("a word changed in the JSON is the word the consumer reads", () => {
    const dir = fixture((d) => {
      d.components.schemas.QUALIFICATION_MEASUREMENT_VOICE_BASES!.oneOf.push({ const: "fixture-word", title: "fixtureWord", "x-code": 2, "x-text": "A word only this test adds." });
    });
    try {
      const changed = buildVocabulary(openQualificationDomainAt(dir));
      const installed = buildVocabulary(openQualificationDomainAt(CONTRACT_DIR));
      expect(changed.VOICE_BASES).toContain("fixture-word");
      expect(installed.VOICE_BASES).not.toContain("fixture-word");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("a word the code describes and the JSON lacks is refused by name", () => {
    const dir = fixture((d) => {
      const item = d.components.schemas.QUALIFICATION_MEASUREMENT_LATENCY_SCALING!;
      item.oneOf = item.oneOf.slice(1);
    });
    try {
      expect(() => buildVocabulary(openQualificationDomainAt(dir))).toThrow(/QUALIFICATION_MEASUREMENT_LATENCY_SCALING/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("a document without $schema, below the floor or absent is refused by name", () => {
    const noSchema = fixture((d) => void delete (d as { $schema?: string }).$schema);
    const tooOld = fixture((d) => void ((d as unknown as { info: { version: string } }).info.version = "0.0.1"));
    try {
      expect(() => openQualificationDomainAt(noSchema)).toThrow(/qualification.*\$schema/s);
      expect(() => openQualificationDomainAt(tooOld)).toThrow(/qualification.*version/s);
      expect(() => openQualificationDomainAt(join(tmpdir(), "no-such-contract-dir"))).toThrow(/qualification.*(absent|not found|no-such)/s);
    } finally {
      rmSync(noSchema, { recursive: true, force: true });
      rmSync(tooOld, { recursive: true, force: true });
    }
  });
});
