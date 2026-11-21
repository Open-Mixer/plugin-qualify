// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The container job's test (.github/container-tests.txt): with plugin-hostd-contract installed from the channel, the
 * library's own default read, `openInstalledQualificationDomain()` at the real installed place, gives the golden words
 * (fixtures/qualification-golden.json). It names no scratch path: nothing but the installed package holds the domain.
 * Absent plugin-hostd-contract, the read is refused by name.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openQualificationDomainAt } from "./qualification-domain-node.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(readFileSync(join(PKG, "fixtures", "qualification-golden.json"), "utf8")) as Record<string, [string, string][]>;
const REAL = "/usr/share/omx-contract/contract.d";

describe("the installed qualification domain", () => {
  it("is the golden one, read at the real installed place", () => {
    const domain = openQualificationDomainAt(REAL);
    for (const [item, words] of Object.entries(golden)) {
      expect(domain.words(item), item).toEqual(words.map(([, word]) => word));
    }
  });
  it("is refused by name where no package installed it", () => {
    expect(() => openQualificationDomainAt(join(PKG, "no-such-contract-dir"))).toThrow(/qualification/);
  });
});
