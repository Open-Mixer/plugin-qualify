// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * describe's oracle reads the scan domain (omx-clap-core's), through omx-contract's C loader: the spec and debian/control
 * name the loader and omx-clap-core-contract at their floors, a floor only (no Breaks, Replaces, Conflicts or Provides).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = readFileSync(join(ROOT, "packaging/plugin-qualify.spec"), "utf8");
const CONTROL = readFileSync(join(ROOT, "debian/control"), "utf8");
const ACTION = readFileSync(join(ROOT, ".github/actions/build-native/action.yml"), "utf8");

describe("the packages name what describe's oracle reads at the floors of the scan domain", () => {
  it("the spec builds against the loader and omx-clap-core-contract", () => {
    expect(SPEC).toMatch(/^BuildRequires: pkgconfig\(libomx-domain\) >= 3\.20\.0$/m);
    expect(SPEC).toMatch(/^BuildRequires: omx-clap-core-contract >= 0\.33\.1$/m);
  });
  it("debian/control builds against both at the same floors", () => {
    expect(CONTROL).toMatch(/libomx-domain-dev \(>= 3\.20\.0~\)/);
    expect(CONTROL).toMatch(/omx-clap-core-contract \(>= 0\.33\.1~\)/);
  });
  it("the CI build installs them and checks the floor on what it installed", () => {
    expect(ACTION).toContain("libomx-domain-dev omx-clap-core-contract");
    expect(ACTION).toContain("dpkg-query -W -f='${Version}' omx-clap-core-contract");
  });
  it("it is a floor only: no relation of another kind names either", () => {
    for (const text of [SPEC, CONTROL]) expect(text).not.toMatch(/(Breaks|Replaces|Conflicts|Provides):[^\n]*(omx-clap-core-contract|libomx-domain)/);
  });
});
