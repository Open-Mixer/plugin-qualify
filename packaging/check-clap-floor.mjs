#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
//
// Check that the RPM spec and the Debian control file declare the same CLAP floor and ceiling.
// Nothing ties `packaging/plugin-qualify.spec`'s `pkgconfig(clap)` constraint to `debian/control`'s
// `clap-headers` one; they drifted (openmixer/plugin-qualify#30) and this catches it again.
//
//   node packaging/check-clap-floor.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `{ floor, ceiling }` read from the spec's `pkgconfig(clap)` constraint, or null if absent. */
export function specClapRange(spec) {
  const m = /pkgconfig\(clap\)\s*>=\s*([\w.]+)\s+with\s+pkgconfig\(clap\)\s*<\s*([\w.]+)/.exec(spec);
  return m ? { floor: m[1], ceiling: m[2] } : null;
}

/** `{ floor, ceiling }` read from `debian/control`'s `clap-headers` constraint, or null if absent. */
export function controlClapRange(control) {
  const m = /clap-headers \(>=\s*([\w.]+)~\), clap-headers \(<<\s*([\w.]+)~\)/.exec(control);
  return m ? { floor: m[1], ceiling: m[2] } : null;
}

/** null when the spec and `debian/control` declare the same CLAP floor and ceiling; the failure message otherwise. */
export function checkClapFloor(spec, control) {
  const fromSpec = specClapRange(spec);
  if (!fromSpec) return "packaging/plugin-qualify.spec: no pkgconfig(clap) constraint found";
  const fromControl = controlClapRange(control);
  if (!fromControl) return "debian/control: no clap-headers constraint found";
  if (fromSpec.floor === fromControl.floor && fromSpec.ceiling === fromControl.ceiling) return null;
  return (
    `the CLAP floor/ceiling differ: packaging/plugin-qualify.spec has >= ${fromSpec.floor}, < ${fromSpec.ceiling}; ` +
    `debian/control has >= ${fromControl.floor}, << ${fromControl.ceiling}`
  );
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
  console.log("check-clap-floor: the spec and debian/control agree on the CLAP floor and ceiling");
}
