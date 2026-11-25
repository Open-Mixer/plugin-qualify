// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify --version` answers as its sibling tools do (plugin-hostd, omx-clap-host, mod-host): one line,
 * `<name> version: <x.y.z>`, exit 0 (#72). A version probe reads the last word of the line that says `version`.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bin = new URL("../bin/plugin-qualify.mjs", import.meta.url).pathname;
const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

describe("plugin-qualify --version", () => {
  it("prints one line, plugin-qualify version: <the package's version>, and exits 0", () => {
    const r = spawnSync(process.execPath, [bin, "--version"], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(`plugin-qualify version: ${version}\n`);
    expect(r.status).toBe(0);
  });

  it("the help names it", () => {
    const r = spawnSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
    expect(r.stdout).toMatch(/--version\s+\S/);
  });
});
