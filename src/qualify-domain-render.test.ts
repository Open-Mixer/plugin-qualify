// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The `qualify` domain (contract.d/qualify/qualify.json, item QUALIFY_CODES) is where plugin-qualify's own codes are
 * written; schema/codes.json and src/text-codes.generated.ts are rendered from it, and the readers (src/text-catalog.ts,
 * tools/descriptors.py) read the rendered file. Three arms:
 *  (a) golden: every code's args and English sentence, through the readers' own call (`sourceOf`, `textOf`), are those
 *      frozen in fixtures/qualify-codes-golden.json from the codes file as it was before the domain;
 *  (b) both: the committed codes file is, byte for byte, what the domain renders;
 *  (c) sabotage: a copy of the domain with one word removed, or one sentence changed, renders a codes file that is not the
 *      committed one, and `gen-text-codes --check` run over such a tree fails by naming the file.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";

import { codesFileText, SOURCE } from "../tools/gen-text-codes.mjs";
import { sourceOf, textOf } from "./text-catalog.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const golden = JSON.parse(readFileSync(join(PKG, "fixtures/qualify-codes-golden.json"), "utf8")) as Record<string, { args: string[]; en: string }>;
const domain = () => JSON.parse(readFileSync(SOURCE, "utf8")) as { components: { schemas: { QUALIFY_CODES: { oneOf: Record<string, unknown>[] } } } };
const scratch = mkdtempSync(join(tmpdir(), "qualify-domain-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the qualify domain renders plugin-qualify's codes", () => {
  test("(a) every code's sentence and args are the golden's", () => {
    expect(Object.keys(golden).length).toBeGreaterThan(100);
    for (const [code, g] of Object.entries(golden)) {
      expect(sourceOf(code), code).toBe(g.en);
      const args = Object.fromEntries(g.args.map((a) => [a, `<${a}>`]));
      expect(textOf({ code, args }), code).toBe(g.en.replace(/\{([^{}]*)\}/g, (_m, n: string) => `<${n}>`));
    }
  });

  test("(b) the committed codes file is the domain's render, byte for byte", () => {
    expect(readFileSync(join(PKG, "schema/codes.json"), "utf8")).toBe(codesFileText(domain()));
  });

  test("(c) a domain with a word removed, or a sentence changed, is not the committed file", () => {
    const fewer = domain();
    fewer.components.schemas.QUALIFY_CODES.oneOf.pop();
    expect(codesFileText(fewer)).not.toBe(readFileSync(join(PKG, "schema/codes.json"), "utf8"));
    const reworded = domain();
    reworded.components.schemas.QUALIFY_CODES.oneOf[0]!["x-text"] = "changed";
    expect(codesFileText(reworded)).not.toBe(readFileSync(join(PKG, "schema/codes.json"), "utf8"));
  });

  test("(c) gen-text-codes --check over a tree whose domain lost a word fails by naming schema/codes.json", () => {
    const tree = join(scratch, "tree");
    mkdirSync(join(tree, "tools"), { recursive: true });
    mkdirSync(join(tree, "contract.d/qualify"), { recursive: true });
    mkdirSync(join(tree, "schema"));
    mkdirSync(join(tree, "src"));
    cpSync(join(PKG, "tools/gen-text-codes.mjs"), join(tree, "tools/gen-text-codes.mjs"));
    cpSync(join(PKG, "schema/codes.json"), join(tree, "schema/codes.json"));
    cpSync(join(PKG, "src/text-codes.generated.ts"), join(tree, "src/text-codes.generated.ts"));
    const fewer = domain();
    fewer.components.schemas.QUALIFY_CODES.oneOf.pop();
    writeFileSync(join(tree, "contract.d/qualify/qualify.json"), JSON.stringify(fewer));
    // the tool imports omx-contract's entry helper: resolve it from this package's modules
    symlinkSync(join(PKG, "node_modules"), join(tree, "node_modules"));
    const run = spawnSync(process.execPath, [join(tree, "tools/gen-text-codes.mjs"), "--check"], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("schema/codes.json is stale");
  });
});
