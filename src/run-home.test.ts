// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Every process that loads a plugin starts with the run's scratch HOME, never the caller's (Surge XT segfaulted or
 * stayed silent with none). The spawn sites are read from the sources, so a new one without it is red.
 */
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runCwd, runHome, withRunHome } from "./run-home.js";

const SRC = dirname(fileURLToPath(import.meta.url));

/** The files whose spawns start a process that loads a plugin: a prober, a host, a step, a scanner. */
const PLUGIN_SPAWNS = ["host-admission.ts", "clap-loader.ts", "qualify-sync.ts", "qualify-pool.ts", "qualify-isolated.ts"];

describe("the run's HOME", () => {
  it("is a scratch directory of this run under the temporary directory, the same for every call", () => {
    expect(runHome().startsWith(tmpdir())).toBe(true);
    expect(runHome()).toBe(runHome());
    expect(withRunHome({ HOME: "/home/someone", X: "1" })).toEqual({ HOME: runHome(), X: "1" });
  });

  it("is what every spawn that loads a plugin is given", () => {
    for (const file of PLUGIN_SPAWNS) {
      const src = readFileSync(join(SRC, file), "utf8");
      // each spawn call, up to the end of its options
      const calls = [...src.matchAll(/spawnSync\(\s*(tool|prober|process\.execPath|"jalv"|"python3")[\s\S]*?\}\)/g)].map((m) => m[0]);
      const loading = calls.filter((c) => !c.includes('"python3"') && !c.includes("\"--version\"") && !c.includes("lv2_resolve"));
      expect(loading.length, file).toBeGreaterThan(0);
      for (const c of loading) expect(c, `${file}: ${c.slice(0, 80)}`).toContain("withRunHome(");
    }
  });
});

describe("the run's working directory", () => {
  it("is a scratch directory of this run beside its HOME, so it goes with it", () => {
    expect(runCwd().startsWith(tmpdir())).toBe(true);
    expect(dirname(runCwd())).toBe(dirname(runHome()));
    expect(existsSync(runCwd())).toBe(true);
  });

  // jalv makes its state directory with a relative mkdtemp("jalvXXXXXX") and removes it only at a clean exit: every
  // jalv this package starts is killed at a deadline or on a hang, so each one starts in a directory the run removes
  it("is where every jalv this package starts stands", () => {
    const sites = [
      ...PLUGIN_SPAWNS.map((f) => join(SRC, f)),
      join(SRC, "..", "tools", "compare-host.mjs"),
    ];
    let seen = 0;
    for (const file of sites) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/spawn(?:Sync)?\(\s*"jalv"[\s\S]*?\}\)/g)) {
        if (m[0].includes('"-V"')) continue;
        seen++;
        expect(m[0], `${file}: ${m[0].slice(0, 80)}`).toMatch(/\bcwd: (runCwd\(\)|WORK)/);
      }
    }
    expect(seen).toBe(2);
  });
});
