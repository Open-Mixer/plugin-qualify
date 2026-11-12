// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/** Where the codes are declared, `schema/codes.json`. */
export const SOURCE: string;
/** The committed generated module, `src/text-codes.generated.ts`. */
export const OUT: string;
/** The generated module's text for the `codes` of a codes file. */
export function textCodesFile(codes: Readonly<Record<string, { readonly code: string; readonly args?: readonly string[] }>>): string;
