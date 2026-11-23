// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * describe is plugin-hostd's, one implementation: `plugin-hostd-probe describe` (0.21.0), which this package calls and no
 * longer copies (the vocabulary sorting pass, row V19). The call here is the one a scan makes over a recorded field dump
 * (fixtures/fields/): it runs hostd's describe and gets a scanned descriptor back. The result is hostd's own to test.
 * The describe copy (native/describe.c and the files it needed) and the format tables are gone from this tree.
 * Needs plugin-hostd 0.21.0 installed (OMX_PROBE_RUNNER names the program); the container job runs it.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROBE_RUNNER_ENV } from "./qualify-declarations.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = process.env[PROBE_RUNNER_ENV] ?? "plugin-hostd-probe";

describe("describe is plugin-hostd's", () => {
  it("plugin-hostd-probe describe turns a recorded CLAP field dump into a scanned descriptor", (ctx) => {
    if (process.env["OMX_CONTAINER_TESTS"] === undefined) ctx.skip("needs plugin-hostd 0.21.0 installed: the container job sets OMX_CONTAINER_TESTS");
    const r = spawnSync(RUNNER, ["describe", "--fields-from", join(PKG, "fixtures/fields/clap-controls.tsv"), "clap:controls.clap#org.freemixer.plugin-qualify.fixture.controls"], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.stdout) as { origin: string; plugin: { id: string; format: string } };
    expect(doc.origin).toBe("scanned");
    expect(doc.plugin.id).toBe("org.freemixer.plugin-qualify.fixture.controls");
  });

  it("this tree keeps no describe: no native copy, no format tables, no scan-words reader", () => {
    for (const f of ["native/describe.c", "native/describe.h", "native/transforms.c", "native/plugin-json.c", "native/scan_words.c", "data/formats/clap.json", ["data", "formats", "lv2.json"].join("/")]) {
      expect(existsSync(join(PKG, f)), f).toBe(false);
    }
  });
});
