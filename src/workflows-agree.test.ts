// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * ci.yml and publish.yml run the same suite, so they must prepare the runner the same way. The preparation lives
 * once, as composite actions under `.github/actions/`; a workflow that copies the steps inline instead of using the
 * action, or leaves them out, drifts from the other (publish.yml once lacked plugin-hostd and failed a tag at
 * src/pins-file.test.ts, #84). This test reads both workflows as text and fails on that drift, and on an action
 * that no longer sets the variables the suite asks for.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const SHARED = ['build-native', 'install-plugin-hostd', 'install-scanners'] as const;
const WORKFLOWS = ['ci.yml', 'publish.yml'] as const;

/** The `uses:` lines of a workflow, in order, and the index of the step that runs the suite. */
function usesOf(workflow: string): string[] {
  return [...read(`.github/workflows/${workflow}`).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
}

function indexOfLine(text: string, needle: RegExp): number {
  return text.split('\n').findIndex((line) => needle.test(line));
}

describe('ci.yml and publish.yml prepare the runner alike', () => {
  for (const workflow of WORKFLOWS) {
    const text = read(`.github/workflows/${workflow}`);
    for (const action of SHARED) {
      it(`${workflow} uses the shared ${action} action, once, before it lints`, () => {
        const uses = usesOf(workflow).filter((u) => u === `./.github/actions/${action}`);
        expect(uses).toHaveLength(1);
        const at = indexOfLine(text, new RegExp(`uses: \\./\\.github/actions/${action}$`));
        const lint = indexOfLine(text, /^\s*(run:\s*)?pnpm lint\s*$/);
        expect(at).toBeGreaterThan(-1);
        expect(lint).toBeGreaterThan(at);
      });
    }

    it(`${workflow} carries no inline copy of the shared steps`, () => {
      expect(text).not.toMatch(/apt-get install[^\n]*plugin-hostd/);
      expect(text).not.toMatch(/make -C native deps/);
      expect(text).not.toMatch(/PLUGIN_HOSTD/);
      expect(text).not.toMatch(/python3-lilv|omx-clap-host/);
    });
  }

  it('the install action sets what src/pins-file.test.ts and src/grid-runs.test.ts ask for and installs what the spec requires', () => {
    const action = read('.github/actions/install-plugin-hostd/action.yml');
    expect(action).toMatch(/>> "\$GITHUB_ENV"/);
    // OMX_PROBE_RUNNER_REQUIRED: src/grid-runs.test.ts fails its live arms instead of skipping them
    for (const variable of ['PLUGIN_HOSTD', 'PLUGIN_HOSTD_FAKE_HOST', 'OMX_PROBE_RUNNER_REQUIRED']) {
      expect(action).toContain(`echo "${variable}=`);
    }
    // each plugin-hostd package the spec Requires is installed, as the channel serves it
    const spec = read('packaging/plugin-qualify.spec');
    const required = [...spec.matchAll(/^Requires:\s*(plugin-hostd(?:-contract|-protocol-contract)?)$/gm)].map((m) => m[1]!);
    expect(required).toEqual(expect.arrayContaining(['plugin-hostd', 'plugin-hostd-contract', 'plugin-hostd-protocol-contract']));
    for (const name of required) expect(action).toMatch(new RegExp(`[ ]${name}(?![\\w-])`));
  });

  it('the scanners action sets what the live scan tests ask for', () => {
    const action = read('.github/actions/install-scanners/action.yml');
    for (const variable of ['OMX_CLAP_SCAN', 'OMX_CLAP_FAKE']) expect(action).toContain(`echo "${variable}=`);
    expect(action).toMatch(/dnf install[^\n]*python3-lilv[\s\S]*?omx-clap-host-tests/);
  });

  it('the test files left out of an ordinary run are the ones the container job runs', () => {
    const list = read('.github/container-tests.txt')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'));
    expect(list.length).toBeGreaterThan(0);
    for (const file of list) expect(() => read(file), `${file} is listed and must exist`).not.toThrow();
    // one definition: the config reads the list for the exclusion, the container job reads it for what it runs
    expect(read('vitest.config.ts')).toContain('.github/container-tests.txt');
    const ci = read('.github/workflows/ci.yml');
    const job = ci.slice(ci.indexOf('\n  container-tests:'), ci.indexOf('\n  catalogs:'));
    expect(job).toMatch(/OMX_CONTAINER_TESTS: '1'/);
    expect(job).toContain(`grep -v '^#' .github/container-tests.txt`);
    expect(job).not.toMatch(/src\/[\w.-]+\.test\.ts/);
    // the other workflows run the ordinary suite: neither names the files itself
    for (const w of WORKFLOWS) expect(read(`.github/workflows/${w}`)).not.toMatch(new RegExp(list.map((f) => f.replace(/[.]/g, '\\.')).join('|')));
    expect(read('.github/workflows/publish.yml')).toContain('.github/container-tests.txt');
  });

  it('publish.yml publishes by OIDC: no token, no secret', () => {
    const text = read('.github/workflows/publish.yml');
    expect(text).toMatch(/id-token:\s*write/);
    expect(text).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./);
  });
});
