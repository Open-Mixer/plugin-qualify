// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The judging code reads the probe domain (src/probe-domain.ts), which plugin-hostd-protocol-contract ships: the spec and
 * debian/control name that package at the same floor, a floor only (no Breaks, Replaces, Conflicts or Provides).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = readFileSync(join(ROOT, "packaging/plugin-qualify.spec"), "utf8");
const CONTROL = readFileSync(join(ROOT, "debian/control"), "utf8");
const ACTION = readFileSync(join(ROOT, ".github/actions/install-plugin-hostd/action.yml"), "utf8");

describe("the packages name plugin-hostd-protocol-contract at the floor of the probe domain", () => {
  it("the spec requires it", () => {
    expect(SPEC).toMatch(/^Requires: plugin-hostd-protocol-contract >= 0\.7\.0$/m);
  });
  it("debian/control depends on it at the same floor", () => {
    expect(CONTROL).toMatch(/plugin-hostd-protocol-contract \(>= 0\.7\.0~\)/);
  });
  it("the CI install checks the floor on what it installed", () => {
    expect(ACTION).toContain("dpkg-query -W -f='${Version}' plugin-hostd-protocol-contract");
    expect(ACTION).toContain("0.7.0");
  });
  it("it is a floor only: no relation of another kind names the package", () => {
    for (const text of [SPEC, CONTROL]) expect(text).not.toMatch(/(Breaks|Replaces|Conflicts|Provides):[^\n]*plugin-hostd-protocol-contract/);
  });
});
