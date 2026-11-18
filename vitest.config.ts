// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * vitest for plugin-qualify. Some tests spawn the measuring tools and wait on them, so the
 * per-test, per-hook and poll timeouts are 15 minutes rather than vitest's 5 s: a hang is caught
 * by the CI job's own timeout, not by a guess at how long a measurement takes.
 */
import { readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';

const HANG_GUARD_MS = 900_000;

/**
 * The test files that need omx-contract 3.20.0 installed as a system package (.github/container-tests.txt, one path a
 * line): left out of an ordinary run, run by ci.yml's container job, which sets OMX_CONTAINER_TESTS=1.
 */
const CONTAINER_TESTS = readFileSync(new URL('./.github/container-tests.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('#'));

export default defineConfig({
  test: {
    exclude: process.env['OMX_CONTAINER_TESTS'] === '1' ? configDefaults.exclude : [...configDefaults.exclude, ...CONTAINER_TESTS],
    setupFiles: ['./src/test-setup.ts'],
    testTimeout: HANG_GUARD_MS,
    hookTimeout: HANG_GUARD_MS,
    expect: { poll: { timeout: HANG_GUARD_MS } },
  },
});
