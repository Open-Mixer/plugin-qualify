// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { HISTORY_HEADER } from "./history-file.js";
import { OMX_CLAP_HOST_PROFILE } from "./host-profiles.js";
import { fixtureText } from "./probe-output-fixtures.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "adjust-command-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HOST = OMX_CLAP_HOST_PROFILE.id;
const URI = "clap:/usr/lib64/clap/example-plate.clap#org.example.plate";
const DIGEST = "356902794a4eec2122989e072271ef995968131145db918d9a3084ce582f244b";
const file = (...lines: string[]): string => [HISTORY_HEADER, ...lines, ""].join("\n");

/** The store's two commands as stand-in processes with a layer of the test's own (`store-stand-in.support.mjs`). */
function standIn(): Record<string, string> {
  const dir = mkdtempSync(join(scratch, "store-"));
  const stand = join(PKG, "src", "store-stand-in.support.mjs");
  for (const [name, tool] of [["plugin-qualification-db-write", "write"], ["plugin-qualification-db", "read"]] as const) {
    writeFileSync(join(dir, name), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(stand)} ${tool} "$@"\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return { PLUGIN_QUALIFICATION_DB_WRITE: join(dir, "plugin-qualification-db-write"), PLUGIN_QUALIFICATION_DB: join(dir, "plugin-qualification-db"), STAND_IN_STORE: join(dir, "store.json") };
}

describe("the command", () => {
  const bin = join(PKG, "bin", "plugin-qualify.mjs");
  const run = (env: Record<string, string>, args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

  it("judge puts the record in the store and writes no file; adjust no longer takes a directory", (ctx) => {
    if (!readdirSync(PKG).includes("dist")) ctx.skip("dist is not built");
    const env = standIn();
    const probe = join(scratch, "cmd.probe.json");
    writeFileSync(probe, fixtureText("success-msi"));
    const r = run(env, ["judge", "--host-profile", HOST, "--host-class", "x86-64", probe]);
    expect(r.status, r.stderr).toBe(0);
    const held = (JSON.parse(readFileSync(env["STAND_IN_STORE"]!, "utf8")) as { user: { uri: string; record: { binary: { path: string } } }[] }).user;
    expect(held.map((h) => [h.uri, h.record.binary.path])).toEqual([["org.example.plate", "example-plate.clap"]]);
    expect(readdirSync(scratch).filter((f) => /qualification\.json$/.test(f))).toEqual([]);
    const hist = join(scratch, "cmd.history");
    writeFileSync(hist, file(`history ${URI} ${DIGEST} aarch64/4/2400 windows_solo=1`));
    const old = run(env, ["adjust", "--history", hist, "--qualification-dir", scratch]);
    expect(old.status).toBe(2);
    expect(old.stderr).toContain("unknown option --qualification-dir");
  });

  it("exits 2 for a history it cannot read, and a store with no record", (ctx) => {
    if (!readdirSync(PKG).includes("dist")) ctx.skip("dist is not built");
    const env = standIn();
    expect(run(env, ["adjust", "--history", join(scratch, "nowhere")]).status).toBe(2);
    const hist = join(scratch, "v2.history");
    writeFileSync(hist, "# plugin-hostd history/2\n");
    const r = run(env, ["adjust", "--history", hist]);
    expect(r.status).toBe(2);
  });
});
