// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The directories the sync scans, as plugin-hostd searches them (plugin-qualify#9). One definition of the search path:
 * the daemon's, which `plugin-hostd --search-path [-c <file>]` prints from the code it searches with (plugin-hostd 0.20.3
 * and later). This module never works the lists out itself: it runs the daemon on its settings file and reads the
 * `lv2` and `clap` lines, and where each list came from (`file`, `env` or `default`).
 */
import { spawnSync } from "node:child_process";
import { HOSTD_ENV } from "./hostd-pin-files.js";

/** Where plugin-hostd took a list from: its settings file, its environment (`LV2_PATH`, `CLAP_PATH`) or its default. */
export type SearchPathSource = "file" | "env" | "default";

export interface HostdSearchPath {
  /** The LV2 directories, in the order the daemon searches them: `lv2_path` then `lv2_extra`. */
  readonly lv2: readonly string[];
  /** The CLAP directories, in the order the daemon searches them. */
  readonly clap: readonly string[];
  /** Where each of `lv2_path`, `lv2_extra` and `clap_path` came from. */
  readonly sources: Readonly<Record<"lv2_path" | "lv2_extra" | "clap_path", SearchPathSource>>;
}

export interface SearchPathRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The daemon is not installed. */
  readonly missing?: boolean;
}

/** One run of `plugin-hostd --search-path`, with `-c <conf>` when a settings file is named. */
export type SearchPathRun = (conf: string | undefined, env: Readonly<Record<string, string | undefined>>) => SearchPathRunResult;

export const SPAWNED_SEARCH_PATH: SearchPathRun = (conf, env) => {
  const r = spawnSync(env[HOSTD_ENV] ?? "plugin-hostd", [...(conf === undefined ? [] : ["-c", conf]), "--search-path"], { encoding: "utf8", timeout: 30000, env: { ...env } });
  const missing = (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(missing ? { missing } : {}) };
};

const SOURCES: readonly string[] = ["file", "env", "default"];
const dirList = (text: string): string[] => text.split(":").filter((d) => d !== "");

/** The lines `plugin-hostd --search-path` prints, read: `<key> TAB <source> TAB <value>`; why not, when one is missing. */
export function parseSearchPath(stdout: string): { ok: true; path: HostdSearchPath } | { ok: false; error: string } {
  const rows = new Map<string, { source: string; value: string }>();
  for (const line of stdout.split("\n")) {
    const f = line.split("\t");
    if (f.length >= 2 && f[0] !== undefined && f[1] !== undefined) rows.set(f[0], { source: f[1], value: f.slice(2).join("\t") });
  }
  for (const key of ["lv2_path", "lv2_extra", "clap_path"]) {
    const r = rows.get(key);
    if (r === undefined || !SOURCES.includes(r.source)) return { ok: false, error: `plugin-hostd --search-path printed no ${key} with its source` };
  }
  const lv2 = rows.get("lv2");
  const clap = rows.get("clap");
  if (lv2?.source !== "effective" || clap?.source !== "effective") return { ok: false, error: "plugin-hostd --search-path printed no effective lv2 and clap lists" };
  const src = (key: string) => rows.get(key)!.source as SearchPathSource;
  return { ok: true, path: { lv2: dirList(lv2.value), clap: dirList(clap.value), sources: { lv2_path: src("lv2_path"), lv2_extra: src("lv2_extra"), clap_path: src("clap_path") } } };
}

/** The directories plugin-hostd searches with the settings file `conf` (its own default when undefined); why not, when it cannot say. */
export function hostdSearchPath(
  conf: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: SearchPathRun = SPAWNED_SEARCH_PATH,
): { ok: true; path: HostdSearchPath } | { ok: false; error: string } {
  const r = run(conf, env);
  if (r.missing) return { ok: false, error: "plugin-hostd is not installed: the directories scanned are the ones plugin-hostd searches" };
  if (r.status !== 0) {
    const why = /unrecognized option|^Usage:/m.test(r.stdout + r.stderr)
      ? "this plugin-hostd has no --search-path (plugin-hostd 0.20.3 or later names the directories it searches)"
      : r.stderr.trim().split("\n").pop() || `plugin-hostd --search-path exited ${String(r.status)}`;
    return { ok: false, error: why };
  }
  return parseSearchPath(r.stdout);
}

/** What the run says when a list is not the settings file's: the running daemon, started with another environment, may search other directories. */
export function searchPathWarnings(path: HostdSearchPath, conf: string | undefined): string[] {
  const where = conf ?? "plugin-hostd's own settings file";
  return (["lv2_path", "clap_path"] as const)
    .filter((k) => path.sources[k] !== "file")
    .map((k) => `${k} is plugin-hostd's ${path.sources[k] === "env" ? `environment (${k === "lv2_path" ? "LV2_PATH" : "CLAP_PATH"})` : "default"}, not ${where}: the running daemon may search other directories; write ${k} in ${where}`);
}
