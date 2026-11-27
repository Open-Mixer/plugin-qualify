// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * clap-tsdir.mjs — where omx-clap's TypeScript modules are, and their hosting tables.
 *
 * omx-clap declares every hosting code: one `HOSTING_<DIMENSION>_CODES` table per dimension,
 * rendered into the modules its package installs under `pkg-config --variable=tsdir omx-clap`
 * (BUILDING.md) — `omx-clap-vocabulary.js` for the dimensions carried from omx-contract,
 * `omx-clap-hosting-codes.js` for the dimensions of omx-clap's own hosting domain (`hosting.idle.*`,
 * `hosting.window.*`, rendered from the hosting domain document omx-clap ships since 0.36.0; the
 * `omx-clap-hosting.js` beside it now carries the stage limits, no code). `tools/gen-hosting-codes.mjs` reads them here
 * to write `src/hosting-codes.generated.ts`, and the conformance test reads them here to hold that
 * file to them.
 *
 * Node only, and build and test only: no module under src/ imports it, so nothing a public subpath
 * reaches touches the filesystem or a child process.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The two TypeScript modules omx-clap's `tsdir` carries, each a `HOSTING_<DIMENSION>_CODES` source. */
export const CLAP_TS_MODULES = Object.freeze(['omx-clap-vocabulary.js', 'omx-clap-hosting-codes.js']);

/** This package's root. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `native/fetch-deps.sh`'s own checkout of omx-clap, for a build with no omx-clap-devel installed. */
const DEPS_TS_DIR = join(PACKAGE_ROOT, 'native/deps/omx-clap-core/ts');

/** Where `make install` of omx-clap-host puts them (BUILDING.md), for a run with no `pkg-config` binary at all. */
const DEFAULT_SYSTEM_TS_DIR = '/usr/share/omx-clap/ts';

/** `pkg-config --variable=tsdir omx-clap`, or `undefined` where pkg-config or the package is absent. */
function pkgConfigTsDir(env) {
  try {
    const out = execFileSync(env.PKG_CONFIG ?? 'pkg-config', ['--variable=tsdir', 'omx-clap'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === '' ? undefined : out;
  } catch {
    return undefined;
  }
}

/**
 * Where omx-clap's TypeScript modules are looked for, in order: `OMX_CLAP_TSDIR` when
 * set (and only that), else `pkg-config --variable=tsdir omx-clap`, else the checkout
 * `native/fetch-deps.sh` stages, else the path `make install` of omx-clap-host uses by default.
 */
export function clapTsDirCandidates(env = process.env) {
  const set = env.OMX_CLAP_TSDIR;
  if (set !== undefined && set !== '') return [set];
  const fromPkgConfig = pkgConfigTsDir(env);
  return [...(fromPkgConfig === undefined ? [] : [fromPkgConfig]), DEPS_TS_DIR, DEFAULT_SYSTEM_TS_DIR];
}

/** The first candidate holding both modules, or `undefined`. */
export function findClapTsDir(env = process.env) {
  return clapTsDirCandidates(env).find((d) => CLAP_TS_MODULES.every((m) => existsSync(join(d, m))));
}

/** True for an export name that is one of omx-clap's hosting tables. */
export function isHostingTableName(name) {
  return /^HOSTING_[A-Z0-9_]+_CODES$/.test(name);
}

/** Every `HOSTING_<DIMENSION>_CODES` table the two modules in `dir` export, by export name, in module order. */
export async function loadHostingTables(dir) {
  const tables = {};
  for (const name of CLAP_TS_MODULES) {
    // The modules are self-contained ES modules in a directory with no package.json: Node 18 reads such a .js as
    // CommonJS and refuses `export`, so the source is imported as a data: module, which is a module on every Node.
    const source = readFileSync(join(dir, name), 'utf8');
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const names = Object.keys(mod).filter(isHostingTableName);
    // a module of the list that exports no hosting table is a module that moved, never an empty dimension: refused by
    // name, so its codes are never dropped from the generated file in silence (omx-clap 0.36.0 moved hosting.idle.* and
    // hosting.window.* out of omx-clap-hosting.js)
    if (names.length === 0) throw new Error(`${join(dir, name)} exports no HOSTING_<DIMENSION>_CODES table: omx-clap's hosting codes are not where this tool reads them`);
    for (const exportName of names) tables[exportName] = mod[exportName];
  }
  return tables;
}

/** The tables flattened into one `key: code` map; a key two tables declare is refused. */
export function flattenHostingTables(tables) {
  const flat = {};
  for (const [name, entries] of Object.entries(tables)) {
    for (const [key, entry] of Object.entries(entries)) {
      if (key in flat) throw new Error(`omx-clap declares the hosting key ${key} twice (${name})`);
      flat[key] = entry.code;
    }
  }
  return flat;
}
