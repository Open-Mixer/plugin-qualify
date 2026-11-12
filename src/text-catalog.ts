// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The sentence a surface shows for one of plugin-qualify's own {@link TextRef}s: the catalog's, for the given
 * language, else the source sentence `schema/codes.json` declares; its `{placeholder}`s filled from `args`
 * An entry is the sentence, or the sentence with how it was made (omx-contract 3.16.0's `catalogEntry`); a model's
 * entry made from another source sentence is stale and skipped. This is the lookup of
 * `@openmixer/omx-contract/catalog` (`sentenceOf`, `fill`), made here: that module reads its schema through ajv, which
 * this package does not depend on, and the npm floor is below the release that knows an entry's provenance.
 *
 * `schema/codes.json` and `catalogs/<lang>.json` ship inside this package (`package.json`'s `files`), read relative
 * to this module so it works from `src/` under vitest and from `dist/` once built alike. `PLUGIN_QUALIFY_CATALOGS_DIR`
 * names another catalogs directory instead, for a test that wants its own fixture catalogs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReasonText, TextRef } from "./text-codes.js";

export const OWNER = "plugin-qualify";
export const CATALOGS_DIR_ENV = "PLUGIN_QUALIFY_CATALOGS_DIR";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where this package's own `catalogs/<lang>.json` live: `PLUGIN_QUALIFY_CATALOGS_DIR`, else beside this module's package. */
export function catalogsDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env[CATALOGS_DIR_ENV] ?? join(PKG, "catalogs");
}

/** One code of `schema/codes.json`: the code, the args its sentence names and the sentence. */
export interface DeclaredCode {
  readonly code: string;
  readonly doc?: string;
  readonly text: { readonly en: string };
  readonly args: readonly string[];
}

/** One catalog entry: the sentence, or the sentence with how it was made (omx-contract's `catalogEntry`). */
export type CatalogEntry = string | { readonly text: string; readonly by: "human" | "machine"; readonly model?: string; readonly source?: string };

/** Where the codes are declared: `schema/codes.json` of this package. */
export const CODES_FILE = join(PKG, "schema", "codes.json");

let declared: ReadonlyMap<string, DeclaredCode> | undefined;

/** Every code `schema/codes.json` declares, by its code; none where the file does not read. */
export function declaredCodes(): ReadonlyMap<string, DeclaredCode> {
  if (declared !== undefined) return declared;
  let codes: Record<string, DeclaredCode> = {};
  try {
    codes = (JSON.parse(readFileSync(CODES_FILE, "utf8")) as { codes?: Record<string, DeclaredCode> }).codes ?? {};
  } catch {
    codes = {};
  }
  declared = new Map(Object.values(codes).map((c) => [c.code, c]));
  return declared;
}

const messagesCache = new Map<string, Record<string, CatalogEntry> | undefined>();

/** `catalogs/<lang>.json`'s `messages`, or `undefined` where the file is absent or does not read as one. */
export function loadMessages(lang: string, dir: string = catalogsDir()): Record<string, CatalogEntry> | undefined {
  const cacheKey = `${dir}\0${lang}`;
  if (messagesCache.has(cacheKey)) return messagesCache.get(cacheKey);
  let messages: Record<string, CatalogEntry> | undefined;
  try {
    const catalog = JSON.parse(readFileSync(join(dir, `${lang}.json`), "utf8")) as { messages?: Record<string, CatalogEntry> };
    messages = catalog.messages;
  } catch {
    messages = undefined;
  }
  messagesCache.set(cacheKey, messages);
  return messages;
}

/** `sentence` with each `{name}` replaced by `args[name]`; a placeholder with no value is left as written. */
export function fill(sentence: string, args: Readonly<Record<string, string | number>> = {}): string {
  return sentence.replace(/\{([^{}]*)\}/g, (m, n: string) => (Object.hasOwn(args, n) ? String(args[n]) : m));
}

/** The sha256 of a source sentence, lowercase hex of its UTF-8 bytes: what a model's entry records as `source`. */
export const sourceHash = (sentence: string): string => createHash("sha256").update(sentence, "utf8").digest("hex");

/** The sentence of `entry`; `undefined` for no entry, or a model's entry made from another sentence than `source`. */
export function entrySentence(entry: CatalogEntry | undefined, source: string): string | undefined {
  if (entry === undefined || typeof entry === "string") return entry;
  return entry.source !== undefined && entry.source !== sourceHash(source) ? undefined : entry.text;
}

/** The source sentence `code` was declared with (`schema/codes.json`); throws on a code this package never declared. */
export function sourceOf(code: string): string {
  const source = declaredCodes().get(code)?.text.en;
  if (source === undefined) throw new Error(`plugin-qualify declares no source sentence for ${code}`);
  return source;
}

/** `ref` rendered for `lang`: the catalog's sentence, else the source, its `{placeholder}`s filled. `lang` undefined or "en" skips the catalog. */
export function textOf(ref: TextRef, lang?: string): string {
  const source = sourceOf(ref.code);
  const sentence = lang === undefined || lang === "en" ? source : (entrySentence(loadMessages(lang)?.[ref.code], source) ?? source);
  return fill(sentence, ref.args ?? {});
}

/** A {@link ReasonText} rendered for `lang`: another tool's own words pass straight through; plugin-qualify's own go through {@link textOf}. */
export function reasonText(reason: ReasonText, lang?: string): string {
  return typeof reason === "string" ? reason : textOf(reason, lang);
}

/** The language of `LC_ALL`, else `LANG` (the POSIX precedence), as the two letters before `_` or `.`; `undefined` unset, unparsed, or `C`/`POSIX` (textOf's own fallback to the source sentence is the same as leaving this undefined). */
export function localeOf(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const raw = env["LC_ALL"] || env["LANG"];
  if (raw === undefined || raw === "") return undefined;
  const m = /^([a-z]{2})(?:[_.].*)?$/.exec(raw);
  return m?.[1];
}
