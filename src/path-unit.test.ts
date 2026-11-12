// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The path unit (#168): the generic package names the standard folders and no folder of one distribution; the
 * other folders plugin-hostd searches (--search-path, plugin-qualify#9) reach the unit through
 * packaging/systemd/plugin-qualify-sync-generator.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { searchPathClause } from "./hostd-search-path.support.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const UNIT = readFileSync(join(PKG, "packaging", "systemd", "plugin-qualify-sync.path"), "utf8");
const GENERATOR = join(PKG, "packaging", "systemd", "plugin-qualify-sync-generator");
const STANDARD = ["/usr/lib/lv2", "/usr/lib64/lv2", "/usr/local/lib/lv2", "/usr/lib/clap", "/usr/lib64/clap"];
const scratch = mkdtempSync(join(tmpdir(), "path-unit-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const watched = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("PathChanged=")).map((l) => l.slice("PathChanged=".length));

/**
 * Run the generator over a settings file, with a plugin-hostd stand-in that prints `lv2` and `clap` for --search-path
 * and records its arguments; the drop-in it wrote, or undefined when it wrote none.
 */
function generate(conf: string | undefined, lv2: readonly string[] = [], clap: readonly string[] = [], hostd = true): { status: number | null; watched?: string[]; argv?: string } {
  const dir = mkdtempSync(join(scratch, "g-"));
  const file = join(dir, "qualify.conf");
  if (conf !== undefined) writeFileSync(file, conf);
  const stand = join(dir, "plugin-hostd");
  writeFileSync(stand, `#!/bin/sh\necho "$*" > ${JSON.stringify(join(dir, "argv"))}\n${searchPathClause(lv2, clap)}\nexit 2\n`);
  chmodSync(stand, 0o755);
  const out = join(dir, "out");
  const r = spawnSync("sh", [GENERATOR, out], { encoding: "utf8", env: { PATH: process.env["PATH"]!, PLUGIN_QUALIFY_CONF: file, PLUGIN_HOSTD: hostd ? stand : join(dir, "none") } });
  const dropIn = join(out, "plugin-qualify-sync.path.d", "50-qualify-conf.conf");
  const argv = join(dir, "argv");
  return { status: r.status, ...(existsSync(dropIn) ? { watched: watched(readFileSync(dropIn, "utf8")) } : {}), ...(existsSync(argv) ? { argv: readFileSync(argv, "utf8").trim() } : {}) };
}

describe("plugin-qualify-sync.path", () => {
  it("names the standard folders and no folder of one distribution", () => {
    expect(watched(UNIT)).toEqual(STANDARD);
    expect(UNIT).not.toMatch(/zynthian/i);
  });
});

describe("the generator ships", () => {
  it("in the rpm and in the deb, in systemd's generator folder", () => {
    expect(readFileSync(join(PKG, "packaging", "plugin-qualify.spec"), "utf8")).toContain("%{_systemdgeneratordir}/plugin-qualify-sync-generator\n");
    expect(readFileSync(join(PKG, "debian", "rules"), "utf8")).toContain("/usr/lib/systemd/system-generators/plugin-qualify-sync-generator");
  });
});

describe("plugin-qualify-sync-generator", () => {
  it("writes the folders plugin-hostd --search-path prints, LV2 then CLAP, once each, in order", () => {
    const r = generate("", ["/opt/a", "/usr/lib/lv2", "/opt/b"], ["/opt/c", "/opt/a", "/opt/d"]);
    expect(r).toEqual({ status: 0, watched: ["/opt/a", "/usr/lib/lv2", "/opt/b", "/opt/c", "/opt/d"], argv: "--search-path" });
  });

  it("asks about hostd_conf when the settings file names it, and leaves out relative folders", () => {
    const r = generate("#hostd_conf /nope\nbudget_s 30\nhostd_conf /etc/omx/plugin-hostd.conf # the daemon's\n", ["relative/dir", "/ok"]);
    expect(r.argv).toBe("-c /etc/omx/plugin-hostd.conf --search-path");
    expect(r.watched).toEqual(["/ok"]);
  });

  it("writes nothing, and succeeds, with no settings file, no folder, or no plugin-hostd", () => {
    expect(generate(undefined).status).toBe(0);
    expect(generate(undefined).watched).toBeUndefined();
    expect(generate("", ["/opt/a"], [], false)).toEqual({ status: 0 });
  });
});
