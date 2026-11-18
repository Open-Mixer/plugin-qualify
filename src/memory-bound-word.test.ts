// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * memory-bound is a reason the measurer emits, so it is a word of the qualification domain (omx-contract#81): the domain
 * declares it and carries its sentence in every language. The C measurer only writes it into the record, never switches on
 * it, so no header is rendered and the word is spelled once, as MEMORY_BOUND_REASON.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openQualificationDomainAt } from "./qualification-domain.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(PKG, rel), "utf8");
const domain = openQualificationDomainAt(join(PKG, "contract.d"));

describe("memory-bound", () => {
  it("is a declared unmeasured reason", () => {
    expect(domain.words("QUALIFICATION_MEASUREMENT_UNMEASURED_REASONS")).toContain("memory-bound");
  });
  it("is written by lv2-measure.c as one constant, with no codes header behind it", () => {
    const c = read("native/lv2-measure.c");
    expect(c).toContain('#define MEMORY_BOUND_REASON "memory-bound"');
    expect(c).not.toContain("qualification_vocabulary.h");
    expect(c.match(/"memory-bound"/g)).toHaveLength(1);
  });
  it("has its sentence in every language of the domain", () => {
    const dir = join(PKG, "contract.d/qualification/catalogs");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(6);
    for (const f of files) {
      expect(Object.keys(JSON.parse(readFileSync(join(dir, f), "utf8")).messages), f).toContain("QUALIFICATION_MEASUREMENT_UNMEASURED_REASONS.memory-bound");
    }
  });
});
