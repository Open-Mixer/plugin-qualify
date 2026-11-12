// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Every process that loads a plugin starts with the run's scratch HOME, never the caller's (Surge XT segfaulted or
 * stayed silent with none). The spawn sites are read from the sources, so a new one without it is red.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runHome, withRunHome } from "./run-home.js";

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
