#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * `plugin-qualify-spool`, the runner of R-112: it watches plugin-hostd's qualify spool and qualifies each request,
 * isolated, with plugin-qualify-sync --plugin, which puts the record into the qualification store, where plugin-hostd
 * reads the verdict (--system as root, the store the daemon reads then). Every decision is in `src/qualify-spool.ts`.
 *
 *   plugin-qualify-spool [--once]    env: PLUGIN_QUALIFY_CONSOLE (http://127.0.0.1:8800/api),
 *                                    PLUGIN_QUALIFY_BUDGET_S (600), XDG_STATE_HOME
 */
import { cpus } from "node:os";
import { join } from "node:path";

import { consoleAudioCpus, defaultProbe, runSpoolOnce } from "../dist/index.js";

const state = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? "", ".local/state"), "plugin-hostd");
const cfg = {
  spoolDir: join(state, "qualify"),
  budgetMs: Number(process.env.PLUGIN_QUALIFY_BUDGET_S ?? 600) * 1000,
  quick: ["plugin-qualify-sync", "--cells-per-plugin-budget", "1", ...(process.getuid?.() === 0 ? ["--system"] : [])],
};
const base = process.env.PLUGIN_QUALIFY_CONSOLE ?? "http://127.0.0.1:8800/api";
const once = process.argv.includes("--once");
const online = cpus().map((_, i) => i);
for (;;) {
  const audio = await consoleAudioCpus(base);
  const out = await runSpoolOnce(cfg, { audioCpus: () => audio, onlineCpus: () => online, probe: defaultProbe });
  for (const o of out) process.stderr.write(`plugin-qualify-spool: ${JSON.stringify(o)}\n`);
  if (once) break;
  await new Promise((r) => setTimeout(r, 5000));
}
