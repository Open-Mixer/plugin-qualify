// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify here` (#56): the facts of this machine a plugin-db query is asked with, each from its owner and
 * never restated: the host class the sync reads distributed records by, the host a judged layer is written for and its
 * installed version, that host's hosting epoch, the rules of this plugin-qualify and the record schema. `--json`
 * prints them as one JSON object with plugin-db's own keys, which a client (the Zynthian integration's here_facts)
 * reads back and hands to plugin-db's query without parsing text.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { hereFacts } from "./here.js";
import { HOSTING_EPOCH, JUDGED_HOST } from "./judged-layer.js";
import { judgementRules } from "./judgement-line.js";
import { QUALIFICATION_RECORD_SCHEMA } from "./qualification-record.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "plugin-qualify.mjs");
const scratch = mkdtempSync(join(tmpdir(), "plugin-qualify-here-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A plugin-hostd that answers --version as the installed one does. */
function fakeHostd(version: string): string {
  const path = join(scratch, `plugin-hostd-${version}`);
  writeFileSync(path, `#!/bin/sh\n[ "$1" = --version ] && { echo "plugin-hostd version: ${version}"; exit 0; }\nexit 2\n`);
  chmodSync(path, 0o755);
  return path;
}

function here(args: readonly string[], conf: string, hostd: string) {
  const path = join(scratch, `qualify-${Math.random().toString(36).slice(2)}.conf`);
  writeFileSync(path, conf);
  return spawnSync(process.execPath, [BIN, "here", "--config", path, ...args], {
    encoding: "utf8",
    env: { ...process.env, PLUGIN_HOSTD: hostd },
  });
}

describe("plugin-qualify here", () => {
  it("--json prints the facts of here as one object with plugin-db's keys, each its owner's", () => {
    const r = here(["--json"], "host_class rpi5\n", fakeHostd("0.20.7"));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const facts = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(facts).toEqual({
      machineClass: "rpi5",
      hostName: JUDGED_HOST,
      hostVersion: "0.20.7",
      hostingEpoch: HOSTING_EPOCH[JUDGED_HOST],
      rules: judgementRules(),
      recordSchema: QUALIFICATION_RECORD_SCHEMA,
    });
  });

  it("prints the same facts as text, one per line, without --json", () => {
    const r = here([], "host_class rpi5\n", fakeHostd("0.20.7"));
    expect(r.status).toBe(0);
    const json = JSON.parse(here(["--json"], "host_class rpi5\n", fakeHostd("0.20.7")).stdout) as Record<string, unknown>;
    for (const [k, v] of Object.entries(json)) expect(r.stdout).toContain(`${k} ${String(v)}`);
  });

  it("without host_class takes the class the sync reads distributed records by: the board's, else the machine's", () => {
    expect(hereFacts({ file: new Map(), boardModel: () => "Raspberry Pi 5 Model B Rev 1.0\0", machineArch: () => "aarch64", hostdVersion: "1" })
      .machineClass).toBe("rpi5");
    expect(hereFacts({ file: new Map(), boardModel: () => undefined, machineArch: () => "x86_64", hostdVersion: "1" }).machineClass).toBe("x86-64");
    // a machine with no class and a plugin-hostd that cannot say its version: those keys are absent, never guessed
    const none = hereFacts({ file: new Map(), boardModel: () => undefined, machineArch: () => "riscv64", hostdVersion: undefined });
    expect(none).not.toHaveProperty("machineClass");
    expect(none).not.toHaveProperty("hostVersion");
    expect(none.hostName).toBe(JUDGED_HOST);
  });

  it("refuses an option it does not take", () => {
    const r = here(["--yaml"], "", fakeHostd("0.20.7"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--yaml");
  });
});
