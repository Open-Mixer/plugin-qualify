// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Floors only: this package states a floor for each of the organisation's packages it builds against or runs with, and
 * never a ceiling (a breaking release declares its own Breaks/Conflicts). The spec's (Build)Requires, debian/control's
 * Build-Depends and Depends, and the workflows' install lines carry `>= N` and nothing above it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("no version ceiling on a dependency", () => {
  it("the spec's Requires and BuildRequires state floors only", () => {
    const lines = read("packaging/plugin-qualify.spec").split("\n").filter((l) => /^(Build)?Requires:/.test(l));
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines) expect(l, l).not.toMatch(/ with |<=? ?[0-9]|=< /);
  });
  it("debian/control's Build-Depends and Depends state floors only", () => {
    expect(read("debian/control")).not.toMatch(/\(<<|\(<=|\(< /);
  });
  it("the workflows' install lines state floors only", () => {
    for (const w of ["ci.yml", "publish.yml", "release.yml"]) {
      const lines = read(`.github/workflows/${w}`).split("\n").filter((l) => /(dnf|apt-get) install/.test(l));
      for (const l of lines) expect(l, `${w}: ${l}`).not.toMatch(/'[a-z0-9-]+ <=? ?[0-9]/);
    }
  });
});
