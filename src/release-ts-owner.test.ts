// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * release.yml's install check asks the package manager who owns /usr/share/omx-clap/ts (the hosting codes' modules
 * the installed program reads) and requires it to be the package plugin-qualify depends on for them. That name is
 * stated twice, in the packaging and in the check, so the two are held together here: v0.21.0 moved the spec's
 * Requires to omx-clap-libs while the Fedora check still grepped `^omx-clap-[0-9]`, and the install job of release
 * run 45258215517 (job 138430526296) failed on a correct install.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const release = read('.github/workflows/release.yml');
const spec = read('packaging/plugin-qualify.spec');
const control = read('debian/control');

/** The package name a check line greps the owner of /usr/share/omx-clap/ts for: `grep -q '^<name>-[0-9]'` or `'^<name>'`. */
function ownerIn(command: RegExp): string {
  const line = release.split('\n').find((l) => command.test(l) && l.includes('/usr/share/omx-clap/ts'));
  expect(line, `release.yml has no ${command} line for /usr/share/omx-clap/ts`).toBeDefined();
  const m = /grep -q '\^([a-z0-9][a-z0-9.+-]*?)(?:-\[0-9\])?'/.exec(line!);
  expect(m, `no package name in: ${line}`).not.toBeNull();
  return m![1]!;
}

describe('the owner of /usr/share/omx-clap/ts the install check names is the one the package depends on', () => {
  it('Fedora: rpm -qf names a package the spec Requires', () => {
    const owner = ownerIn(/rpm -qf/);
    expect(spec).toMatch(new RegExp(`^Requires:\\s*${owner.replace(/[.+]/g, '\\$&')}\$`, 'm'));
  });

  it('Debian: dpkg -S names a package debian/control Depends on', () => {
    const owner = ownerIn(/dpkg -S/);
    expect(control).toMatch(new RegExp(`[\\s,]${owner.replace(/[.+]/g, '\\$&')}(,|$)`));
  });
});
