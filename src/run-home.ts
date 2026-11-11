// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The HOME every process that loads a plugin starts with: a scratch directory of this plugin-qualify run, never the
 * caller's real home. A plugin that reads its user data from HOME (Surge XT) segfaults or stays silent without one,
 * and a probe must not write into a user's home. Created on first use, removed when the process exits.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string | undefined;

/** The run's scratch HOME, made on first use. */
export function runHome(): string {
  if (home === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "plugin-qualify-home-"));
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    home = join(dir, "home");
    mkdirSync(home);
  }
  return home;
}

/** `env` with HOME set to the run's scratch HOME. */
export function withRunHome(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  return { ...env, HOME: runHome() };
}
