// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PLUGIN_DB_ENV, pluginDbPin, pluginDbPutJudged, type PluginDbRun } from "./plugin-db-cli.js";

const ADDRESS = "clap:example.plugin";
const CLAP = { file: "/usr/lib/clap/example.clap" };
const LV2 = { lv2Path: "/usr/lib/lv2:/usr/local/lib/lv2" };
const LAYOUT = "omx-layout/1:" + "b".repeat(64);

function recording() {
  const seen: { args: readonly string[]; input: string | undefined }[] = [];
  const run: PluginDbRun = (args, input) => {
    seen.push({ args, input });
    return { status: 0, stdout: "", stderr: "" };
  };
  return { seen, run };
}

describe("pluginDbPin, in plugin-db's grammar: [--system] pin <address> (--lv2-path <path> | --file <file.clap>) [--layout]", () => {
  it("a CLAP plugin is pinned by its file, plugin-db hashing the bytes, with the layout", () => {
    const r = recording();
    expect(pluginDbPin(ADDRESS, CLAP, LAYOUT, { system: false }, {}, r.run)).toEqual({ ok: true });
    expect(r.seen).toEqual([{ args: ["pin", ADDRESS, "--file", CLAP.file, "--layout", LAYOUT], input: undefined }]);
  });

  it("an LV2 plugin is pinned by the search path its bundle is found in", () => {
    const r = recording();
    pluginDbPin("lv2:urn:a", LV2, LAYOUT, { system: false }, {}, r.run);
    expect(r.seen[0]!.args).toEqual(["pin", "lv2:urn:a", "--lv2-path", LV2.lv2Path, "--layout", LAYOUT]);
  });

  it("no layout: --layout is left out, never given empty", () => {
    const r = recording();
    pluginDbPin(ADDRESS, CLAP, null, { system: false }, {}, r.run);
    expect(r.seen[0]!.args).toEqual(["pin", ADDRESS, "--file", CLAP.file]);
  });

  it("--system is plugin-db's store option, so it comes before the verb (after it, plugin-db prints its usage)", () => {
    const r = recording();
    pluginDbPin(ADDRESS, CLAP, null, { system: true }, {}, r.run);
    expect(r.seen[0]!.args).toEqual(["--system", "pin", ADDRESS, "--file", CLAP.file]);
  });

  it("a non-zero exit is refused, with plugin-db's own reason", () => {
    const r = pluginDbPin(ADDRESS, CLAP, null, { system: false }, {}, () => ({ status: 1, stdout: "", stderr: "plugin-db: pin: no such address\n" }));
    expect(r).toEqual({ ok: false, detail: "plugin-db: pin: no such address" });
  });

  it("plugin-db not installed is said so, never worked around", () => {
    const r = pluginDbPin(ADDRESS, CLAP, null, { system: false }, {}, () => ({ status: null, stdout: "", stderr: "", missing: true }));
    expect(r).toEqual({ ok: false, detail: "plugin-db is not installed: the store is plugin-db's to pin" });
  });

  it("the spawned run calls plugin-db on PATH, or the binary PLUGIN_DB names", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-db-cli-"));
    const stand = join(dir, "plugin-db");
    writeFileSync(stand, `#!/bin/sh\n[ "$1" = pin ] && [ "$2" = "${ADDRESS}" ] || exit 9\necho pinned\n`);
    chmodSync(stand, 0o755);
    const r = pluginDbPin(ADDRESS, CLAP, null, { system: false }, { ...process.env, [PLUGIN_DB_ENV]: stand });
    expect(r).toEqual({ ok: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("pluginDbPutJudged", () => {
  it("runs plugin-db put <address> judged --writer plugin-qualify with the body on stdin", () => {
    const seen: { args: readonly string[]; input: string | undefined }[] = [];
    const run: PluginDbRun = (args, input) => {
      seen.push({ args, input });
      return { status: 0, stdout: "", stderr: "" };
    };
    const body = { verdict: "in-process" } as never;
    expect(pluginDbPutJudged(ADDRESS, body, { system: false }, {}, run)).toEqual({ ok: true });
    expect(seen).toEqual([{ args: ["put", ADDRESS, "judged", "--writer", "plugin-qualify"], input: JSON.stringify(body) }]);
  });

  it("--system comes before the verb", () => {
    const seen: (readonly string[])[] = [];
    const run: PluginDbRun = (args) => {
      seen.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };
    pluginDbPutJudged(ADDRESS, {} as never, { system: true }, {}, run);
    expect(seen[0]).toEqual(["--system", "put", ADDRESS, "judged", "--writer", "plugin-qualify"]);
  });

  it("a non-zero exit is refused, with plugin-db's own reason", () => {
    const r = pluginDbPutJudged(ADDRESS, {} as never, { system: false }, {}, () => ({ status: 1, stdout: "", stderr: "plugin-db: put: bad body\n" }));
    expect(r).toEqual({ ok: false, detail: "plugin-db: put: bad body" });
  });
});
