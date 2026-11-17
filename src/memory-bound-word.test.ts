// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * memory-bound is a reason the measurer emits, so it is a word of the qualification domain (omx-contract#81): the C
 * measurer reads its rendered constant, never a literal of its own, and the domain carries its sentence in every language.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEASUREMENT_UNMEASURED_REASONS_WORDS } from "./qualification-vocabulary.generated.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(PKG, rel), "utf8");

describe("memory-bound", () => {
  it("is a declared unmeasured reason", () => {
    expect(MEASUREMENT_UNMEASURED_REASONS_WORDS).toContain("memory-bound");
  });
  it("is read by lv2-measure.c from the rendered header, not spelled", () => {
    const c = read("native/lv2-measure.c");
    expect(c).toContain('#include "qualification_vocabulary.h"');
    expect(c).toContain("OMX_MEASUREMENT_UNMEASURED_REASONS_MEMORY_BOUND");
    expect(c).not.toMatch(/"memory-bound"/);
    expect(read("native/qualification_vocabulary.h")).toContain('#define OMX_MEASUREMENT_UNMEASURED_REASONS_MEMORY_BOUND "memory-bound"');
  });
  it("has its sentence in every language of the domain", () => {
    const dir = join(PKG, "contract.d/qualification/catalogs");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(6);
    for (const f of files) {
      expect(Object.keys(JSON.parse(readFileSync(join(dir, f), "utf8")).messages), f).toContain("MEASUREMENT_UNMEASURED_REASONS.memory-bound");
    }
  });
});
