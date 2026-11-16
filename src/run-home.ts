// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The HOME every process that loads a plugin starts with: a scratch directory of this plugin-qualify run, never the
 * caller's real home. A plugin that reads its user data from HOME (Surge XT) segfaults or stays silent without one,
 * and a probe must not write into a user's home. Beside it, the working directory a host that writes relative paths
 * starts in: jalv makes its state directory with a relative mkdtemp("jalvXXXXXX") and removes it only at a clean
 * exit, so a jalv killed at its deadline left one in the caller's working directory, a user's home when the run
 * started there. Both are created on first use and removed when the process exits, by a signal included.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let scratch: string | undefined;

/** The signals that end a run whose scratch directory must still go: the default action follows the removal. */
const ENDING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** The run's scratch directory, made on first use, removed at exit. */
function runScratch(): string {
  if (scratch === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "plugin-qualify-home-"));
    const remove = () => rmSync(dir, { recursive: true, force: true });
    process.on("exit", remove);
    for (const sig of ENDING_SIGNALS) {
      process.once(sig, () => {
        remove();
        process.kill(process.pid, sig);
      });
    }
    mkdirSync(join(dir, "home"));
    mkdirSync(join(dir, "cwd"));
    scratch = dir;
  }
  return scratch;
}

/** The run's scratch HOME, made on first use. */
export function runHome(): string {
  return join(runScratch(), "home");
}

/** The run's scratch working directory, for a host that writes relative paths (jalv's state directory). */
export function runCwd(): string {
  return join(runScratch(), "cwd");
}

/** `env` with HOME set to the run's scratch HOME. */
export function withRunHome(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  return { ...env, HOME: runHome() };
}
