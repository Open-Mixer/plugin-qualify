// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HOSTING_EPOCH, JUDGED_HOST } from "./judged-layer.js";
import { judgementRules } from "./judgement-line.js";
import { QUALIFICATION_RECORD_SCHEMA } from "./qualification-record.js";
import { hereFacts, hereHelpText, parseHereArgs, type HereRun } from "./here.js";

const probeOk: HereRun = () => ({ status: 0, stdout: "plugin-hostd-probe version 0.20.3\n" });

describe("hereFacts", () => {
  it("prints the facts of here as plugin-db query takes them", () => {
    const r = hereFacts({}, () => undefined, () => "x86_64", probeOk);
    expect(r).toEqual({
      ok: true,
      facts: {
        machineClass: "x86-64",
        hostName: JUDGED_HOST,
        hostVersion: "0.20.3",
        hostingEpoch: HOSTING_EPOCH[JUDGED_HOST],
        rules: judgementRules(),
        recordSchema: QUALIFICATION_RECORD_SCHEMA,
      },
    });
  });

  it("a Raspberry Pi 5's board model names rpi5, over the architecture", () => {
    const r = hereFacts({}, () => "Raspberry Pi 5 Model B Rev 1.0", () => "aarch64", probeOk);
    expect(r.ok && r.facts.machineClass).toBe("rpi5");
  });

  it("a machine with no class prints why and exits 1 at the CLI; here, it names the reason", () => {
    const r = hereFacts({}, () => undefined, () => "riscv64", probeOk);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("class") });
  });

  it("no plugin-hostd-probe version is also a reason, never guessed", () => {
    const r = hereFacts({}, () => undefined, () => "x86_64", () => ({ status: 1, stdout: "" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/plugin-hostd-probe/);
  });
});

describe("parseHereArgs", () => {
  it("--json, and --help", () => {
    expect(parseHereArgs([])).toEqual({ ok: true, args: { json: false } });
    expect(parseHereArgs(["--json"])).toEqual({ ok: true, args: { json: true } });
    expect(parseHereArgs(["--help"])).toEqual({ ok: true, help: true });
    expect(parseHereArgs(["--nope"])).toEqual({ ok: false, error: "unknown option --nope" });
  });
});

describe("plugin-qualify here (CLI)", () => {
  it("prints the facts as JSON, and exits 1 with the reason when there is no machine class", async () => {
    const { spawnSync } = await import("node:child_process");
    const bin = new URL("../bin/plugin-qualify.mjs", import.meta.url).pathname;
    if (!existsSync(new URL("../dist/index.js", import.meta.url))) return expect.fail("dist/ is not built: npm run build");
    const dir = mkdtempSync(join(tmpdir(), "pq-here-"));
    const probe = join(dir, "plugin-hostd-probe");
    writeFileSync(probe, `#!/bin/sh\necho "plugin-hostd-probe version 0.20.3"\n`);
    const { chmodSync } = await import("node:fs");
    chmodSync(probe, 0o755);
    const out = spawnSync(process.execPath, [bin, "here", "--json"], { encoding: "utf8", env: { ...process.env, OMX_PROBE_RUNNER: probe } });
    expect(out.status).toBe(0);
    expect(JSON.parse(out.stdout).recordSchema).toBe(QUALIFICATION_RECORD_SCHEMA);
  });
});
