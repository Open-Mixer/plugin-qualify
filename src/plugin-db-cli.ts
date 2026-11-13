// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * plugin-db is the one writer's call into plugin-db's own store, as plugin-db's records documentation describes it:
 * `plugin-db pin <address> --files <sha256> [--layout <scheme>:<sha256>]` writes the pinned layer, `plugin-db put
 * <address> judged --writer plugin-qualify` writes the judged layer plugin-qualify is the one writer of, its body on
 * stdin. `--system` names the service's store (plugin-db's own default otherwise, for an interactive caller). Nothing
 * here computes a digest or a body; `plugin-db-pin.ts` and `judged-layer.ts` do.
 */
import { spawnSync } from "node:child_process";

import type { JudgedBody } from "./judged-layer.js";
import type { LayerPin } from "./judged-layer.js";

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

function systemFlag(args: readonly string[], opts: PluginDbCallOptions): string[] {
  return opts.system ? [...args, "--system"] : [...args];
}

function refusal(r: PluginDbRunResult, verb: string): PluginDbCallResult {
  if (r.missing) return { ok: false, detail: `plugin-db is not installed: the store is plugin-db's to ${verb}` };
  const detail = r.stderr.trim().split("\n").pop();
  return { ok: false, detail: detail || `plugin-db ${verb} exited ${String(r.status)}` };
}

/** `plugin-db pin <address> --files <sha256> [--layout <scheme>:<sha256>]`: the files of a plugin's bytes, pinned. */
export function pluginDbPin(
  address: string,
  pin: LayerPin,
  opts: PluginDbCallOptions,
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: PluginDbRun = SPAWNED_PLUGIN_DB,
): PluginDbCallResult {
  const args = systemFlag(["pin", address, "--files", pin.files, ...(pin.layout === null ? [] : ["--layout", pin.layout])], opts);
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
