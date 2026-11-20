// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * describe's parser (native/describe.c) reads the scopes of a field dump from omx-clap-core's scan domain
 * (contract.d/scan/scan.json there, item SCAN_FIELD_SCOPES): the scope names are the domain's words, not a hand copy
 * (sorting pass V9). The call is the oracle's own, describe over a dump of one line (`describe_test scope <format> <scope>`):
 *   (a) the scopes are the golden fourteen frozen from the hand copy at 2d6aefc, plus `meter`, which the hand copy lacked
 *       (the other thirteen are scopes of a CLAP dump but port, which is LV2's; any other word is none);
 *   (b) the domain holds exactly those fourteen words;
 *   (c) a temporary contract directory whose domain has `param` renamed makes the renamed word the scope and `param` none,
 *       and a domain short of a word, or none at all, ends the start-up with 78 naming it.
 * The domain is read where omx-clap-core-contract installs it; OMX_CLAP_CORE_CONTRACT_DIR names a checkout's contract.d
 * instead. On CI a missing build is a failure; elsewhere the test skips, saying how to build.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const NATIVE = join(dirname(fileURLToPath(import.meta.url)), "..", "native");
const ORACLE = join(NATIVE, "build", "describe_test");
const SCAN_DIR = process.env["OMX_CLAP_CORE_CONTRACT_DIR"] ?? "/usr/share/omx-contract/contract.d";
const GOLDEN = ["plugin", "param", "audio_in", "audio_out", "note_in", "note_out", "port", "panel", "section", "control", "role", "display", "placement_default", "meter"];
const NO_INDEX = new Set(["plugin", "panel"]);

const scratch: string[] = [];
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

const call = (format: string, word: string, dirs: string) =>
  spawnSync(ORACLE, ["scope", format, NO_INDEX.has(word) ? word : `${word}:0`], { cwd: NATIVE, encoding: "utf8", env: { ...process.env, OMX_CONTRACT_PATH: dirs } });

/** A contract directory holding the scan domain with `edit` applied to its document, and the rest of the search path after it. */
function sabotaged(edit: (doc: { components: { schemas: Record<string, { oneOf: { const: string }[] }> } }) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "describe-scan-scopes-"));
  scratch.push(dir);
  cpSync(join(SCAN_DIR, "scan"), join(dir, "scan"), { recursive: true });
  const file = join(dir, "scan", "scan.json");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  edit(doc);
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return dir;
}

describe("describe reads the scopes of a field dump from the scan domain", () => {
  const live = (ctx: { skip: (m: string) => void }): boolean => {
    if (!existsSync(ORACLE)) {
      if (process.env["CI"]) throw new Error("native/build is missing: CI builds it with make -C native deps all");
      ctx.skip("native/build is missing: make -C native deps all");
      return false;
    }
    return true;
  };

  it("(a) the scopes are the golden fourteen", (ctx) => {
    if (!live(ctx)) return;
    for (const word of GOLDEN.filter((w) => w !== "port")) expect(call("clap", word, SCAN_DIR).stdout.trim(), word).toBe("accepted");
    expect(call("clap", "port", SCAN_DIR).stdout.trim()).toBe("no-scope");
    expect(call("lv2", "port", SCAN_DIR).stdout.trim()).toBe("accepted");
    expect(call("clap", "param-x", SCAN_DIR).stdout.trim()).toBe("no-scope");
  });

  it("(b) the domain holds the golden fourteen words", () => {
    const doc = JSON.parse(readFileSync(join(SCAN_DIR, "scan", "scan.json"), "utf8"));
    const words = (doc.components.schemas.SCAN_FIELD_SCOPES.oneOf as { const: string }[]).map((w) => w.const);
    expect([...words].sort()).toEqual([...GOLDEN].sort());
  });

  it("(c) a word renamed in the domain is the scope the parser reads", (ctx) => {
    if (!live(ctx)) return;
    const dir = sabotaged((d) => {
      for (const w of d.components.schemas.SCAN_FIELD_SCOPES!.oneOf) if (w.const === "param") w.const = "param-x";
    });
    expect(call("clap", "param-x", dir).stdout.trim()).toBe("accepted");
    expect(call("clap", "param", dir).stdout.trim()).toBe("no-scope");
  });

  it("(c) a domain short of a word, or none, ends the start-up with 78 naming it", (ctx) => {
    if (!live(ctx)) return;
    const short = sabotaged((d) => void d.components.schemas.SCAN_FIELD_SCOPES!.oneOf.pop());
    const r = call("clap", "param", short);
    expect(r.status).toBe(78);
    expect(r.stderr).toMatch(/SCAN_FIELD_SCOPES/);
    const none = call("clap", "param", join(tmpdir(), "nowhere-at-all"));
    expect(none.status).toBe(78);
    expect(none.stderr).toMatch(/scan/);
  });
});
