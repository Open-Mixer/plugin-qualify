#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/*
 * release-matrix.mjs — what release.yml's builds and its install-and-qualify job read, derived from the ONE declaration
 * .github/release-matrix.json. The install cells are the first architecture of every target the builds make, so a
 * target dropped from the declaration is dropped from the install with it ("Artifact not found", #98).
 *
 * Usage (the workflow's `matrix` job):  node tools/release-matrix.mjs <arm: true|false>   (writes $GITHUB_OUTPUT lines; the workflow's check-matrix step turns the install arches into cells with a runner each)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '@openmixer/omx-contract/entry';

/** What the builds and the install job read, derived from the one declaration. */
export function deriveMatrix(decl, { arm }) {
  const first = (arches) => (arm ? arches : arches.slice(0, 1));
  const rpmArches = first(decl.rpm.arches);
  const debArches = first(decl.deb.arches);
  // the install cells are the first architecture of each kind; check-matrix gives each cell its image and its runner
  return { rpmFedora: decl.rpm.fedora, rpmArches, debSuites: decl.deb.suites, debArches, installRpmArches: rpmArches.slice(0, 1), installDebArches: debArches.slice(0, 1) };
}

if (isMain(import.meta.url)) {
  const arg = process.argv[2];
  if (!['true', 'false'].includes(arg)) {
    console.error('usage: node tools/release-matrix.mjs true|false');
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const m = deriveMatrix(JSON.parse(readFileSync(join(root, '.github/release-matrix.json'), 'utf8')), { arm: arg === 'true' });
  const j = (v) => JSON.stringify(v);
  console.log(`rpm-fedora=${j(m.rpmFedora)}\nrpm-arches=${j(m.rpmArches)}\ndeb-suites=${j(m.debSuites)}\ndeb-arches=${j(m.debArches)}\ninstall-rpm-arches=${j(m.installRpmArches)}\ninstall-deb-arches=${j(m.installDebArches)}`);
}
