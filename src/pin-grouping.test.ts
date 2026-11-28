// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The groupable codes are declared once, in the qualification domain (QUALIFICATION_GROUPABLE_CONDITIONAL_CODES, plugin-
 * hostd's contract.d; the owner's ruling of 2026-11-28), and read from it: by this package's rule and by the store's
 * reader. A copy kept in the source is red here, and the rule follows a document that declares another code.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { init, qualificationDomain } from "./qualification-domain.js";
import "./qualification-domain-node.js";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";
import { GROUPABLE_CODES_ITEM, groupableConditionalCodes, sharesAWorker } from "./pin-grouping.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const OWN = "hosting.rt-safety.own-threads";
const ALLOC = "hosting.rt-safety.allocations";
const installedDoc = (): unknown => JSON.parse(readFileSync(join(INSTALLED_CONTRACT_DIR, "qualification", "qualification.json"), "utf8"));

describe("the groupable codes are the domain's", () => {
  afterEach(() => init(installedDoc()));

  it("are the words of the item, and a conditional verdict shares a worker by them", () => {
    expect([...groupableConditionalCodes()]).toEqual([...qualificationDomain().words(GROUPABLE_CODES_ITEM)]);
    expect(groupableConditionalCodes().has(OWN)).toBe(true);
    expect(sharesAWorker("conditional", [{ rating: "conditional", code: OWN }])).toBe(true);
    expect(sharesAWorker("conditional", [{ rating: "conditional", code: ALLOC }])).toBe(false);
  });

  it("follow a document that declares another code: nothing in the source decides it", () => {
    const doc = installedDoc() as { components: { schemas: Record<string, { oneOf: { const: string; title: string }[] }> } };
    doc.components.schemas[GROUPABLE_CODES_ITEM]!.oneOf.push({ const: ALLOC, title: "hostingRtSafetyAllocations" });
    init(doc);
    expect(sharesAWorker("conditional", [{ rating: "conditional", code: ALLOC }])).toBe(true);
  });

  it("are written in no source file: a copy of the set is red", () => {
    const copies = readdirSync(SRC)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".generated.ts"))
      .filter((f) => /new Set\(\[[^\]]*(rtSafetyOwnThreads|own-threads)/.test(readFileSync(join(SRC, f), "utf8")));
    expect(copies).toEqual([]);
  });
});
