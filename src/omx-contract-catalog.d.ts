// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `@openmixer/omx-contract@3.12.0`'s `./catalog` export ships no `types` (unlike its `./scale` sibling): its
 * `package.json` points the subpath straight at `lib/catalog.mjs` with no `.d.mts` beside it. Declared here from
 * that module's own JSDoc until the package ships its own types.
 */
declare module "@openmixer/omx-contract/catalog" {
  export function sentenceOf(
    catalog: { readonly messages?: Readonly<Record<string, string>> } | undefined,
    key: string,
    source: string,
  ): string;
  export function fill(sentence: string, args?: Readonly<Record<string, string | number>>): string;
}
