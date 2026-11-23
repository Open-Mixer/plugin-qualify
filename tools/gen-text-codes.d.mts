// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/** Where the codes are declared, the `qualify` domain: `contract.d/qualify/qualify.json`. */
export const SOURCE: string;
/** The codes file rendered from it, `schema/codes.json`. */
export const CODES_OUT: string;
/** The domain's item the codes are written in. */
export const CODES_ITEM: string;
/** The codes of a domain document as the readers read them: `{ kind, doc, codes }`. Throws where the item is missing or a word lacks its sentence. */
export function codesFileOf(domain: unknown): { readonly kind: "codes"; readonly doc: string; readonly codes: Record<string, { readonly code: string; readonly doc?: string; readonly text: { readonly en: string }; readonly args: readonly string[] }> };
/** The text of schema/codes.json for a domain document. */
export function codesFileText(domain: unknown): string;
/** The committed generated module, `src/text-codes.generated.ts`. */
export const OUT: string;
/** The generated module's text for the `codes` of a codes file. */
export function textCodesFile(codes: Readonly<Record<string, { readonly code: string; readonly args?: readonly string[] }>>): string;
