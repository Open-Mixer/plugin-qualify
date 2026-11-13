#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify-records-package`, the entry point: the Debian packages of a device's qualification records, one per
 * cell (rate and quantum). Every decision is in `src/records-package.ts`; this file reads argv, builds the packages,
 * names what stayed out of each on stderr and each package on a line of stdout, in cell order.
 */
import { buildRecordsPackages, localeOf, parseRecordsPackageArgs, reasonText, recordsPackageHelp } from "../dist/index.js";

const log = (line) => process.stderr.write(`plugin-qualify-records-package: ${line}\n`);

const parsed = parseRecordsPackageArgs(process.argv.slice(2));
if (!parsed.ok) {
  log(reasonText(parsed.error, localeOf(process.env)));
  process.stderr.write(`\n${recordsPackageHelp()}`);
  process.exit(2);
}
if ("help" in parsed) {
  process.stdout.write(recordsPackageHelp());
  process.exit(0);
}
let built;
try {
  built = buildRecordsPackages(parsed.args);
} catch (e) {
  log(e.message);
  process.exit(2);
}
for (const b of built) {
  for (const l of b.left) log(`${b.set}: ${l.name}: ${reasonText(l.why, localeOf(process.env))}; left out`);
  process.stdout.write(`${b.path}: ${b.set} at ${String(b.cell.rate)}/${String(b.cell.quantum)}, ${String(b.records)} records, ${String(b.files)} files\n`);
}
