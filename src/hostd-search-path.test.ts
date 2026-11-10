// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The directories scanned are plugin-hostd's (plugin-qualify#9): the sync takes them from `plugin-hostd --search-path`
 * with hostd_conf, refuses the search path settings it used to hold, and says when a list is not the settings file's.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { hostdSearchPath, parseSearchPath, type SearchPathRun } from "./hostd-search-path.js";
import { FROM_FILE, searchPathClause, searchPathOf, searchPathText } from "./hostd-search-path.support.js";
import { MOVED_TO_HOSTD, discoverSyncItems, flagOf, parseSyncArgs, parseSyncConf, resolveSyncSettings } from "./qualify-sync.js";

const scratch = mkdtempSync(join(tmpdir(), "hostd-search-path-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const settle = (run: SearchPathRun, file: ReadonlyMap<string, string> = new Map()) => {
  const args = parseSyncArgs([]);
  if (!args.ok) throw new Error(args.error);
  return resolveSyncSettings(file, args.args, {}, "/home/u", undefined, undefined, run);
};

describe("plugin-hostd --search-path, read", () => {
  it("takes the effective lists and each list's source", () => {
    const r = parseSearchPath(searchPathText(["/a", "/b"], ["/c"], { lv2_path: "env", lv2_extra: "default", clap_path: "default" }));
    expect(r).toEqual({ ok: true, path: { lv2: ["/a", "/b"], clap: ["/c"], sources: { lv2_path: "env", lv2_extra: "default", clap_path: "default" } } });
  });

  it("refuses an answer that lacks a list or a source", () => {
    expect(parseSearchPath("lv2\teffective\t/a\nclap\teffective\t/c\n").ok).toBe(false);
    expect(parseSearchPath(searchPathText(["/a"], ["/c"]).replace("lv2\teffective", "lv2\tfile")).ok).toBe(false);
  });

  it("says plugin-hostd is missing, or too old to answer", () => {
    expect(hostdSearchPath(undefined, {}, () => ({ status: null, stdout: "", stderr: "", missing: true }))).toEqual({ ok: false, error: expect.stringContaining("not installed") });
    const old = hostdSearchPath(undefined, {}, () => ({ status: 1, stdout: "", stderr: "plugin-hostd: unrecognized option '--search-path'\n" }));
    expect(old).toEqual({ ok: false, error: expect.stringContaining("0.20.3 or later") });
    const bad = hostdSearchPath("/etc/x.conf", {}, () => ({ status: 1, stdout: "", stderr: "plugin-hostd: cannot read /etc/x.conf\n" }));
    expect(bad).toEqual({ ok: false, error: "plugin-hostd: cannot read /etc/x.conf" });
  });

  it("runs the daemon binary PLUGIN_HOSTD names, with -c hostd_conf when set", () => {
    const stand = join(scratch, "plugin-hostd");
    writeFileSync(stand, `#!/bin/sh\n[ "$1" = -c ] && [ "$2" = /etc/omx/plugin-hostd.conf ] || exit 7\n${searchPathClause(["/from/file"], ["/clap"])}\nexit 9\n`);
    chmodSync(stand, 0o755);
    expect(hostdSearchPath("/etc/omx/plugin-hostd.conf", { PLUGIN_HOSTD: stand })).toMatchObject({ ok: true, path: { lv2: ["/from/file"], clap: ["/clap"] } });
    expect(hostdSearchPath(undefined, { PLUGIN_HOSTD: stand }).ok).toBe(false);
  });
});

describe("the sync's directories", () => {
  it("are the lists plugin-hostd prints for hostd_conf, and only those", () => {
    const asked: (string | undefined)[] = [];
    const run: SearchPathRun = (conf, env) => (asked.push(conf), searchPathOf(["/l1", "/l2"], ["/c1"])(conf, env));
    const r = settle(run, new Map([["hostd_conf", "/etc/omx/plugin-hostd.conf"]]));
    if (!r.ok) throw new Error(r.error);
    expect(asked).toEqual(["/etc/omx/plugin-hostd.conf"]);
    expect([r.settings.lv2Dirs, r.settings.clapDirs]).toEqual([["/l1", "/l2"], ["/c1"]]);
    expect(r.warnings).toEqual([]);
  });

  it("scan no directory plugin-hostd does not print", () => {
    const root = mkdtempSync(join(scratch, "scan-"));
    const dirs = { lv2Printed: join(root, "lv2"), lv2Not: join(root, "zynthian-lv2"), clapPrinted: join(root, "clap"), clapNot: join(root, "home-clap") };
    for (const d of Object.values(dirs)) mkdirSync(d);
    for (const d of [dirs.lv2Printed, dirs.lv2Not]) {
      mkdirSync(join(d, "p.lv2"));
      writeFileSync(join(d, "p.lv2", "manifest.ttl"), "");
    }
    for (const d of [dirs.clapPrinted, dirs.clapNot]) writeFileSync(join(d, "p.clap"), "");
    const r = settle(searchPathOf([dirs.lv2Printed], [dirs.clapPrinted]));
    if (!r.ok) throw new Error(r.error);
    for (const d of [...r.settings.lv2Dirs, ...r.settings.clapDirs]) expect([dirs.lv2Printed, dirs.clapPrinted]).toContain(d);
    const found = discoverSyncItems(r.settings).items.map((i) => i.root);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(f.startsWith(dirs.lv2Not) || f.startsWith(dirs.clapNot), f).toBe(false);
  });

  it("say when a list is plugin-hostd's environment or default: the running daemon may search others", () => {
    const r = settle(searchPathOf(["/l"], ["/c"], { lv2_path: "env", lv2_extra: "default", clap_path: "default" }));
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/^lv2_path is plugin-hostd's environment \(LV2_PATH\).*running daemon may search other directories/);
    expect(r.warnings[1]).toMatch(/^clap_path is plugin-hostd's default/);
    const file = settle(searchPathOf(["/l"], ["/c"], FROM_FILE));
    expect(file.ok && file.warnings).toEqual([]);
  });

  it("cannot be resolved when plugin-hostd cannot say", () => {
    const r = settle(() => ({ status: null, stdout: "", stderr: "", missing: true }));
    expect(r.ok ? "" : r.error).toMatch(/^the directories to scan: plugin-hostd is not installed/);
  });
});

describe("the search path settings moved to plugin-hostd", () => {
  it("are refused in the settings file and as flags, saying where they went", () => {
    for (const key of MOVED_TO_HOSTD) {
      const conf = parseSyncConf(`budget_s 30\n${key} /x\n`, "q.conf");
      expect(conf.ok ? "" : conf.error).toMatch(new RegExp(`^q\\.conf:2: ${key} is plugin-hostd's setting now: write it in plugin-hostd's settings file`));
      const flag = parseSyncArgs([flagOf(key), "/x"]);
      expect(flag.ok ? "" : flag.error).toMatch(new RegExp(`^${flagOf(key)}: ${key} is plugin-hostd's setting now`));
    }
  });
});
