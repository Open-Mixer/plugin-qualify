// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * plugin-db is the one writer's call into plugin-db's own store, in plugin-db's grammar (`plugin-db --help`):
 * `plugin-db [--system] pin <address> (--lv2-path <path> | --file <file.clap>) [--layout <scheme>:<sha256>]` writes
 * the pinned layer, plugin-db finding the plugin's files and hashing them itself; `plugin-db [--system] put <address>
 * judged --writer plugin-qualify` writes the judged layer plugin-qualify is the one writer of, its body on stdin.
 * `--system` is plugin-db's store option and comes before the verb; it names the service's store (plugin-db's own
 * default otherwise, for an interactive caller). Nothing here hashes a file or builds a body.
 */
import { spawnSync } from "node:child_process";

import type { JudgedBody } from "./judged-layer.js";

/** The binary, else `plugin-db` on the PATH. */
export const PLUGIN_DB_ENV = "PLUGIN_DB";

export interface PluginDbRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** plugin-db is not installed. */
  readonly missing?: boolean;
}

/** One run of `plugin-db <args...>`, the body on stdin when one is given. */
export type PluginDbRun = (args: readonly string[], input: string | undefined, env: Readonly<Record<string, string | undefined>>) => PluginDbRunResult;

export const SPAWNED_PLUGIN_DB: PluginDbRun = (args, input, env) => {
  const r = spawnSync(env[PLUGIN_DB_ENV] ?? "plugin-db", args, { encoding: "utf8", timeout: 30000, env: { ...env }, ...(input === undefined ? {} : { input }) });
  const missing = (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(missing ? { missing } : {}) };
};

export interface PluginDbCallOptions {
  /** The service's store (`--system`), plugin-db's own default otherwise. */
  readonly system: boolean;
}

export type PluginDbCallResult = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/** plugin-db's store option, before the verb. */
function systemFlag(args: readonly string[], opts: PluginDbCallOptions): string[] {
  return opts.system ? ["--system", ...args] : [...args];
}

/** Where plugin-db finds a plugin's files: an LV2 search path (it picks the bundle), or the CLAP file. */
export type PinWhere = { readonly lv2Path: string } | { readonly file: string };

function refusal(r: PluginDbRunResult, verb: string): PluginDbCallResult {
  if (r.missing) return { ok: false, detail: `plugin-db is not installed: the store is plugin-db's to ${verb}` };
  const detail = r.stderr.trim().split("\n").pop();
  return { ok: false, detail: detail || `plugin-db ${verb} exited ${String(r.status)}` };
}

/** `plugin-db pin <address> (--lv2-path <path> | --file <file.clap>) [--layout <scheme>:<sha256>]`: the plugin's bytes, pinned. */
export function pluginDbPin(
  address: string,
  where: PinWhere,
  layout: string | null,
  opts: PluginDbCallOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: PluginDbRun = SPAWNED_PLUGIN_DB,
): PluginDbCallResult {
  const at = "file" in where ? ["--file", where.file] : ["--lv2-path", where.lv2Path];
  const args = systemFlag(["pin", address, ...at, ...(layout === null ? [] : ["--layout", layout])], opts);
  const r = run(args, undefined, env);
  if (r.status !== 0 || r.missing) return refusal(r, "pin");
  return { ok: true };
}

/** `plugin-db put <address> judged --writer plugin-qualify`, the judged layer's body on stdin. */
export function pluginDbPutJudged(
  address: string,
  body: JudgedBody,
  opts: PluginDbCallOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: PluginDbRun = SPAWNED_PLUGIN_DB,
): PluginDbCallResult {
  const args = systemFlag(["put", address, "judged", "--writer", "plugin-qualify"], opts);
  const r = run(args, JSON.stringify(body), env);
  if (r.status !== 0 || r.missing) return refusal(r, "put");
  return { ok: true };
}
