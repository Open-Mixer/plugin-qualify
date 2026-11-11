// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * A scan refusal is a code with its args and one English source sentence (omx-contract#90): the code and its
 * sentence live in schema/codes.json, each other language in catalogs/<lang>.json keyed by the code. The scanner
 * (tools/descriptors.py) renders the sentence from that file; no module repeats it. This test holds each code the
 * scanner refuses a plugin by to an entry there, each sentence to naming exactly its args, and each shipped catalog
 * to the same codes and placeholders. Both files ship in the package (plugin-qualify#27).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DESCRIPTOR_CODE_DUPLICATE_SYMBOL } from "./qualify-declarations.js";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The codes a scan refuses a plugin by, each carrying args the sentence names. */
const SCAN_REFUSALS = [DESCRIPTOR_CODE_DUPLICATE_SYMBOL];
/** The languages this package ships a catalog for, each complete. */
const CATALOG_LANGS = ["ca"];

interface CodeEntry { code: string; text: { en: string }; args: string[] }

function readJson(rel: string): unknown {
  try { return JSON.parse(readFileSync(join(PKG, rel), "utf8")); } catch { return undefined; }
}

function entries(): Map<string, CodeEntry> {
  const doc = readJson("schema/codes.json") as { kind?: string; codes?: Record<string, CodeEntry> } | undefined;
  return new Map(Object.values(doc?.codes ?? {}).map((e) => [e.code, e]));
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();

describe("each scan refusal code has its source sentence and its catalog entries", () => {
  for (const code of SCAN_REFUSALS) {
    it(`${code} is in schema/codes.json with an English sentence naming exactly its args`, () => {
      const e = entries().get(code);
      expect(e, `${code} has no entry in schema/codes.json`).toBeDefined();
      expect(e?.args.length).toBeGreaterThan(0);
      expect(placeholders(e?.text.en ?? "")).toEqual([...(e?.args ?? [])].sort());
      expect(Object.keys(e?.text ?? {})).toEqual(["en"]);
    });
    for (const lang of CATALOG_LANGS) {
      it(`${code} has a ${lang} sentence in catalogs/${lang}.json naming only its args`, () => {
        const cat = readJson(`catalogs/${lang}.json`) as { kind?: string; lang?: string; owner?: string; messages?: Record<string, string> } | undefined;
        expect(cat?.kind).toBe("catalog");
        expect(cat?.lang).toBe(lang);
        expect(cat?.owner).toBe("plugin-qualify");
        const sentence = cat?.messages?.[code];
        expect(sentence, `${code} has no ${lang} sentence`).toBeTypeOf("string");
        expect(placeholders(sentence ?? "")).toEqual([...(entries().get(code)?.args ?? [])].sort());
      });
    }
  }

  it("a catalog holds no code schema/codes.json does not declare", () => {
    const declared = entries();
    for (const lang of CATALOG_LANGS) {
      const cat = readJson(`catalogs/${lang}.json`) as { messages?: Record<string, string> } | undefined;
      for (const code of Object.keys(cat?.messages ?? {})) expect(declared.has(code), `${lang}: ${code}`).toBe(true);
    }
  });

  it("the package ships both files", () => {
    const pkg = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain("schema/codes.json");
    expect(pkg.files).toContain("catalogs");
  });
});
