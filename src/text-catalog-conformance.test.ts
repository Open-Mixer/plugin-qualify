// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * omx-contract#2 ("codes then catalogs"), plugin-qualify#22: every code this package writes in a record, a pin or the
 * text report is declared in `schema/codes.json` with one English source sentence naming exactly its `args`, and has
 * an entry in the catalog of every listed language (omx-contract's languages.json; the catalogs the tree carries
 * where that file is not at hand) whose placeholders are exactly the code's `args`. Red for a code a module names
 * that the file does not declare, a code with no source sentence, a code with no entry in a language, and a sentence
 * whose placeholders are not its code's `args`. The same catalogs go through omx-contract's release gate
 * (`tools/catalogs-gate.sh`), which also refuses a stale entry.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { OUT as GENERATED_TEXT_CODES, SOURCE, textCodesFile } from "../tools/gen-text-codes.mjs";
import { catalogsDir, type CatalogEntry, declaredCodes, loadMessages, OWNER, sourceOf, textOf } from "./text-catalog.js";
import { TEXT_CODE, TEXT_CODE_ARGS } from "./text-codes.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

function listedLanguages(): string[] {
  try {
    const file = join(PKG, "node_modules/@openmixer/omx-contract/share/omx-contract/languages.json");
    return (JSON.parse(readFileSync(file, "utf8")) as { languages: string[] }).languages;
  } catch {
    return readdirSync(catalogsDir()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  }
}

const LANGS = listedLanguages();
const placeholdersOf = (sentence: string): string[] => [...sentence.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1] ?? "").sort();
const sorted = (xs: readonly string[]): string[] => [...new Set(xs)].sort();
const sentenceIn = (entry: CatalogEntry | undefined): string | undefined => (typeof entry === "string" ? entry : entry?.text);

describe("every code a module names is declared, with one source sentence naming exactly its args", () => {
  test("the generated key map is schema/codes.json's", () => {
    const codes = (JSON.parse(readFileSync(SOURCE, "utf8")) as { codes: Record<string, { code: string; args?: string[] }> }).codes;
    expect(readFileSync(GENERATED_TEXT_CODES, "utf8"), "stale: run node tools/gen-text-codes.mjs --write").toBe(textCodesFile(codes));
  });

  test("each code has its sentence", () => {
    const declared = declaredCodes();
    const problems: string[] = [];
    for (const [key, code] of Object.entries(TEXT_CODE)) {
      const c = declared.get(code);
      if (c === undefined) {
        problems.push(`${key}: ${code} is not declared in schema/codes.json`);
        continue;
      }
      if (typeof c.text?.en !== "string" || c.text.en.trim() === "") {
        problems.push(`${code}: no source sentence`);
        continue;
      }
      if (Object.keys(c.text).join() !== "en") problems.push(`${code}: a translation is in schema/codes.json; it belongs in a catalog`);
      if (placeholdersOf(c.text.en).join() !== sorted(c.args).join()) {
        problems.push(`${code}: the source sentence names {${placeholdersOf(c.text.en).join("}, {")}}, its args are ${c.args.join(", ") || "none"}`);
      }
      if (sorted(TEXT_CODE_ARGS[key as keyof typeof TEXT_CODE_ARGS]).join() !== sorted(c.args).join()) problems.push(`${code}: the generated args are stale`);
    }
    expect(problems).toEqual([]);
    expect(declared.size).toBe(Object.keys(TEXT_CODE).length);
  });

  test("a code the file does not declare has no sentence to render", () => {
    expect(() => sourceOf("qualify.compare.never-declared")).toThrow(/declares no source sentence/);
  });
});

describe("every listed language has every code, its placeholders exactly the code's args", () => {
  test("the listed languages", () => {
    expect(LANGS).toEqual(expect.arrayContaining(["ca", "es"]));
  });

  for (const lang of LANGS) {
    test(lang, () => {
      const messages = loadMessages(lang, catalogsDir());
      expect(messages, `${OWNER}'s catalogs/${lang}.json does not read as a catalog`).toBeDefined();
      const problems: string[] = [];
      for (const c of declaredCodes().values()) {
        const sentence = sentenceIn(messages?.[c.code]);
        if (sentence === undefined) {
          problems.push(`${c.code}: no ${lang} entry`);
          continue;
        }
        if (placeholdersOf(sentence).join() !== sorted(c.args).join()) {
          problems.push(`${c.code}: the ${lang} entry names {${placeholdersOf(sentence).join("}, {")}}, its args are ${c.args.join(", ") || "none"}`);
        }
      }
      expect(problems).toEqual([]);
    });
  }

  test("a surface gets the catalog's sentence, and the source sentence where the language has none", () => {
    const ref = { code: TEXT_CODE.compareHostNotInstalled, args: { program: "jalv" } };
    expect(textOf(ref)).toBe("jalv is not installed");
    expect(textOf(ref, "ca")).toBe("jalv no està instal·lat");
    expect(textOf(ref, "xx")).toBe("jalv is not installed");
  });
});
