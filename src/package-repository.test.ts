// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * npm's provenance check refuses a publish whose `package.json` names a different repository than
 * the one the publish ran in (E422). `v0.20.2` carried `repository.url: git+https://github.com/
 * FreeMixer/plugin-qualify.git` while the publish ran in Open-Mixer/plugin-qualify, so npm refused it
 * and the tag never reached npm (#34). ci checks this on every pull request, before a tag can repeat it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkRepository } from "../packaging/check-repository.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

describe("package.json's repository.url names the repository a publish runs in (#34)", () => {
  it("passes for this package.json against Open-Mixer/plugin-qualify", () => {
    expect(checkRepository(PACKAGE, "Open-Mixer/plugin-qualify")).toBeNull();
  });

  it("sabotage: the field v0.20.2 actually shipped fails the check", () => {
    const sabotaged = { ...PACKAGE, repository: { type: "git", url: "git+https://github.com/FreeMixer/plugin-qualify.git" } };
    expect(checkRepository(sabotaged, "Open-Mixer/plugin-qualify")).toBe(
      'package.json: "repository.url" is "git+https://github.com/FreeMixer/plugin-qualify.git", expected to match "https://github.com/Open-Mixer/plugin-qualify.git" (GITHUB_REPOSITORY=Open-Mixer/plugin-qualify)',
    );
  });

  it("a missing repository field fails the check rather than throwing", () => {
    const { repository: _unused, ...withoutRepository } = PACKAGE;
    expect(checkRepository(withoutRepository, "Open-Mixer/plugin-qualify")).toContain('"repository.url" is ""');
  });

  it("the git+ prefix is stripped before comparing, not required", () => {
    expect(checkRepository({ repository: { url: "https://github.com/Open-Mixer/plugin-qualify.git" } }, "Open-Mixer/plugin-qualify")).toBeNull();
  });
});
