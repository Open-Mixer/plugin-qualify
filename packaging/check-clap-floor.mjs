#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
//
// Check that the RPM spec and the Debian control file declare the same CLAP floor. Floors only: a ceiling on either side is refused by name.
// Nothing ties `packaging/plugin-qualify.spec`'s `pkgconfig(clap)` constraint to `debian/control`'s
// `clap-headers` one; they drifted (openmixer/plugin-qualify#30) and this catches it again.
//
//   node packaging/check-clap-floor.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The spec's `pkgconfig(clap)` ceiling relation (`< 2`, `<= 2`), or null when it has none. */
export function specClapCeiling(spec) {
  const m = /pkgconfig\(clap\)\s*<=?\s*[\w.]+/.exec(spec);
  return m ? m[0] : null;
}

/** The `debian/control` clap-headers ceiling relation (`<< 2~`, `<= 2~`), or null when it has none. */
export function controlClapCeiling(control) {
  const m = /clap-headers \(<{1,2}=?\s*[\w.~]+\)/.exec(control);
  return m ? m[0] : null;
}

/** `{ floor }` read from the spec's `pkgconfig(clap)` constraint, or null if absent. */
export function specClapFloor(spec) {
  const m = /pkgconfig\(clap\)\s*>=\s*([\w.]+)/.exec(spec);
  return m ? { floor: m[1] } : null;
}

/** `{ floor }` read from `debian/control`'s `clap-headers` constraint, or null if absent. */
export function controlClapFloor(control) {
  const m = /clap-headers \(>=\s*([\w.]+)~\)/.exec(control);
  return m ? { floor: m[1] } : null;
}

/** null when the spec and `debian/control` declare the same CLAP floor and neither declares a ceiling; the failure message otherwise. */
export function checkClapFloor(spec, control) {
  const specCeiling = specClapCeiling(spec);
  if (specCeiling) return `packaging/plugin-qualify.spec: a pkgconfig(clap) ceiling is refused (floors only), found: ${specCeiling}`;
  const controlCeiling = controlClapCeiling(control);
  if (controlCeiling) return `debian/control: a clap-headers ceiling is refused (floors only), found: ${controlCeiling}`;
  const fromSpec = specClapFloor(spec);
  if (!fromSpec) return "packaging/plugin-qualify.spec: no pkgconfig(clap) constraint found";
  const fromControl = controlClapFloor(control);
  if (!fromControl) return "debian/control: no clap-headers constraint found";
  if (fromSpec.floor === fromControl.floor) return null;
  return `the CLAP floor differs: packaging/plugin-qualify.spec has >= ${fromSpec.floor}; debian/control has >= ${fromControl.floor}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const spec = readFileSync(join(root, "packaging/plugin-qualify.spec"), "utf8");
  const control = readFileSync(join(root, "debian/control"), "utf8");
  const failure = checkClapFloor(spec, control);
  if (failure) {
    console.error(`check-clap-floor: ${failure}`);
    process.exit(1);
  }
  console.log("check-clap-floor: the spec and debian/control agree on the CLAP floor");
}
