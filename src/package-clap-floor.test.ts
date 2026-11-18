// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The RPM spec and `debian/control` each declare a CLAP floor independently; nothing
 * ties them together, and they drifted (the spec stayed at 1.2.7 after `debian/control` moved to
 * 1.2.10, #30). This holds them to the same floor.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkClapFloor } from "../packaging/check-clap-floor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = readFileSync(join(ROOT, "packaging/plugin-qualify.spec"), "utf8");
const CONTROL = readFileSync(join(ROOT, "debian/control"), "utf8");

describe("the spec and debian/control agree on the CLAP floor (#30)", () => {
  it("passes for this tree", () => {
    expect(checkClapFloor(SPEC, CONTROL)).toBeNull();
  });

  it("sabotage: the spec's old 1.2.7 floor against debian/control's 1.2.10 fails", () => {
    const sabotaged = SPEC.replace("pkgconfig(clap) >= 1.2.10", "pkgconfig(clap) >= 1.2.7");
    expect(sabotaged).not.toBe(SPEC);
    expect(checkClapFloor(sabotaged, CONTROL)).toBe(
      "the CLAP floor differs: packaging/plugin-qualify.spec has >= 1.2.7; debian/control has >= 1.2.10",
    );
  });

  it("refuses a ceiling on the spec's pkgconfig(clap) by name (red arm: floor-only, #107)", () => {
    const withCeiling = SPEC.replace("BuildRequires: pkgconfig(clap) >= 1.2.10", "BuildRequires: (pkgconfig(clap) >= 1.2.10 with pkgconfig(clap) < 2)");
    expect(withCeiling).not.toBe(SPEC);
    expect(checkClapFloor(withCeiling, CONTROL)).toBe(
      "packaging/plugin-qualify.spec: a pkgconfig(clap) ceiling is refused (floors only), found: pkgconfig(clap) < 2",
    );
  });

  it("refuses a ceiling on debian/control's clap-headers by name (red arm: floor-only, #107)", () => {
    const withCeiling = CONTROL.replace("clap-headers (>= 1.2.10~),", "clap-headers (>= 1.2.10~), clap-headers (<< 2~),");
    expect(withCeiling).not.toBe(CONTROL);
    expect(checkClapFloor(SPEC, withCeiling)).toBe(
      "debian/control: a clap-headers ceiling is refused (floors only), found: clap-headers (<< 2~)",
    );
  });

  it("a missing pkgconfig(clap) constraint in the spec fails rather than throwing", () => {
    expect(checkClapFloor("", CONTROL)).toBe("packaging/plugin-qualify.spec: no pkgconfig(clap) constraint found");
  });

  it("a missing clap-headers constraint in debian/control fails rather than throwing", () => {
    expect(checkClapFloor(SPEC, "")).toBe("debian/control: no clap-headers constraint found");
  });
});
