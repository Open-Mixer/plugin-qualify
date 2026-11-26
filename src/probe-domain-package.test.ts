// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The judging code reads the probe domain (src/probe-domain.ts), which plugin-hostd-protocol-contract ships: the spec,
 * debian/control and the CI install name that package, with no version and no relation of another kind.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = readFileSync(join(ROOT, "packaging/plugin-qualify.spec"), "utf8");
const CONTROL = readFileSync(join(ROOT, "debian/control"), "utf8");
const ACTION = readFileSync(join(ROOT, ".github/actions/install-plugin-hostd/action.yml"), "utf8");

describe("the packages name plugin-hostd-protocol-contract, the probe domain's", () => {
  it("the spec requires it", () => {
    expect(SPEC).toMatch(/^Requires: plugin-hostd-protocol-contract$/m);
  });
  it("debian/control depends on it", () => {
    expect(CONTROL).toMatch(/[ ]plugin-hostd-protocol-contract,/);
  });
  it("the CI install asks for it", () => {
    expect(ACTION).toMatch(/[ ]plugin-hostd-protocol-contract$/m);
  });
  it("no relation of another kind names the package", () => {
    for (const text of [SPEC, CONTROL]) expect(text).not.toMatch(/(Breaks|Replaces|Conflicts|Provides):[^\n]*plugin-hostd-protocol-contract/);
  });
});
