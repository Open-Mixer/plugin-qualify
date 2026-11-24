// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/** The committed generated module, `src/dsp-rates.generated.ts`. */
export const OUT: string;
/** Where omx-dsp's rates file is looked for, in order. */
export function ratesFileCandidates(env?: Readonly<Record<string, string | undefined>>): readonly string[];
/** The first candidate that exists, or `undefined`. */
export function findRatesFile(env?: Readonly<Record<string, string | undefined>>): string | undefined;
/** The generated module's text for omx-dsp's rates document; throws naming what is missing. */
export function dspRatesFile(doc: unknown): string;
