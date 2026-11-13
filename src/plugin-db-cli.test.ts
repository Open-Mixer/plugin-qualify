// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PLUGIN_DB_ENV, pluginDbPin, pluginDbPutJudged, type PluginDbRun } from "./plugin-db-cli.js";

const ADDRESS = "clap:example.plugin";
const PIN = { files: "a".repeat(64), layout: "omx-layout/1:" + "b".repeat(64) };

describe("pluginDbPin", () => {
  it("runs plugin-db pin <address> --files <sha256> --layout <scheme>:<sha256>", () => {
    const seen: { args: readonly string[]; input: string | undefined }[] = [];
    const run: PluginDbRun = (args, input) => {
      seen.push({ args, input });
      return { status: 0, stdout: "", stderr: "" };
    };
    expect(pluginDbPin(ADDRESS, PIN, { system: false }, {}, run)).toEqual({ ok: true });
    expect(seen).toEqual([{ args: ["pin", ADDRESS, "--files", PIN.files, "--layout", PIN.layout], input: undefined }]);
  });

  it("no layout: --layout is left out, never given empty", () => {
    const seen: (readonly string[])[] = [];
    const run: PluginDbRun = (args) => {
      seen.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };
    pluginDbPin(ADDRESS, { files: PIN.files, layout: null }, { system: false }, {}, run);
    expect(seen).toEqual([["pin", ADDRESS, "--files", PIN.files]]);
  });

  it("--system is given for the service caller", () => {
    const seen: (readonly string[])[] = [];
    const run: PluginDbRun = (args) => {
      seen.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };
    pluginDbPin(ADDRESS, PIN, { system: true }, {}, run);
    expect(seen[0]).toContain("--system");
  });

  it("a non-zero exit is refused, with plugin-db's own reason", () => {
    const r = pluginDbPin(ADDRESS, PIN, { system: false }, {}, () => ({ status: 1, stdout: "", stderr: "plugin-db: pin: no such address\n" }));
    expect(r).toEqual({ ok: false, detail: "plugin-db: pin: no such address" });
  });

  it("plugin-db not installed is said so, never worked around", () => {
    const r = pluginDbPin(ADDRESS, PIN, { system: false }, {}, () => ({ status: null, stdout: "", stderr: "", missing: true }));
    expect(r).toEqual({ ok: false, detail: "plugin-db is not installed: the store is plugin-db's to pin" });
  });

  it("the spawned run calls plugin-db on PATH, or the binary PLUGIN_DB names", () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-db-cli-"));
    const stand = join(dir, "plugin-db");
    writeFileSync(stand, `#!/bin/sh\n[ "$1" = pin ] && [ "$2" = "${ADDRESS}" ] || exit 9\necho pinned\n`);
    chmodSync(stand, 0o755);
    const r = pluginDbPin(ADDRESS, PIN, { system: false }, { ...process.env, [PLUGIN_DB_ENV]: stand });
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

  it("--system is given for the service caller", () => {
    const seen: (readonly string[])[] = [];
    const run: PluginDbRun = (args) => {
      seen.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };
    pluginDbPutJudged(ADDRESS, {} as never, { system: true }, {}, run);
    expect(seen[0]).toContain("--system");
  });

  it("a non-zero exit is refused, with plugin-db's own reason", () => {
    const r = pluginDbPutJudged(ADDRESS, {} as never, { system: false }, {}, () => ({ status: 1, stdout: "", stderr: "plugin-db: put: bad body\n" }));
    expect(r).toEqual({ ok: false, detail: "plugin-db: put: bad body" });
  });
});
