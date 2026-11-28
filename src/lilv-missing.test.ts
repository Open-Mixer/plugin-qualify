// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/** A system without python3-lilv is told plainly (#168), and the deb depends on it: Debian is trixie only (owner ruling
 * 2026-11-28), which carries it, so no suite is built without it. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { lv2DescriptorFailure } from "./qualify-sync.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("lv2DescriptorFailure", () => {
  it("names the missing python3-lilv in one plain line", () => {
    const msg = lv2DescriptorFailure(1, undefined, "Traceback (most recent call last):\n  File \"scan.py\", line 181\nModuleNotFoundError: No module named 'lilv'\n");
    expect(msg).toContain("python3-lilv is not installed");
    expect(msg).not.toContain("Traceback");
  });

  it("keeps the last lines of any other failure", () => {
    expect(lv2DescriptorFailure(3, undefined, "a\nb\nc\nd\n")).toBe("LV2 descriptors not all written (exit 3): b; c; d");
  });
});

describe("the deb's python3-lilv dependency", () => {
  it("is a plain Depends, with no per-suite substvar left in debian/rules", () => {
    const control = readFileSync(join(PKG, "debian", "control"), "utf8");
    expect(control).toMatch(/^Depends:.*\bpython3-lilv\b/m);
    expect(control).not.toMatch(/lilv:Depends/);
    const rules = readFileSync(join(PKG, "debian", "rules"), "utf8");
    expect(rules).not.toMatch(/lilv:Depends|LILV_DEPENDS|VERSION_ID/);
  });
});
