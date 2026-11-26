// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * While in development there is no backward-compatibility machinery (owner ruling 2026-11-16, backcompat audit rows 3 and
 * 4 of plugin-qualify): no fixture frozen under an old release's name, and no package scriptlet that migrates the pins an
 * older release wrote (`--refresh-pins` stays as the sync's own first step; only the upgrade hooks are gone).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string): string => readFileSync(join(root, p), "utf8");

describe("no compatibility machinery", () => {
  it("the Pi's records are a plain fixture, not one frozen under 0.19.1", () => {
    expect(existsSync(join(root, "fixtures", "records-rpi5-0.19.1"))).toBe(false);
    expect(existsSync(join(root, "fixtures", "records-rpi5"))).toBe(true);
  });
  it("no package scriptlet refreshes pins on upgrade", () => {
    expect(read("debian/plugin-qualify.postinst")).not.toContain("--refresh-pins");
    expect(read("packaging/plugin-qualify.spec").split("%changelog")[0]).not.toContain("--refresh-pins");
  });
});
