// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The qualify runner (R-112, shared-plugin-supervisor §5.8). plugin-hostd writes one request per plugin that has no
 * verdict into a spool beside its pin store (`<state>/plugin-hostd/qualify/*.request`: a line `uri <uri>`, then one
 * `file <path> <sha256>` per file it hashed) and says so; this runs the QUICK check for it and always records a verdict.
 *
 * - ISOLATED: the check is started under `taskset` on the cpus the console's audio threads do NOT hold, at SCHED_IDLE
 *   (`chrt -i`) and idle io (`ionice -c 3`), never in a worker. The audio cpus are the console's own declaration
 *   (`/console/rt-split` facts: the driver's cpu and every worker's); when they are not known the check is not run, said,
 *   and left for the next pass.
 * - THE VERDICT GOES INTO THE STORE (the owner's ruling of 2026-11-28, plugin-hostd's spec of that day): the check is
 *   `plugin-qualify-sync --plugin <uri>`, the one-plugin qualification, which puts the plugin's record into the
 *   qualification store through its writer; plugin-hostd reads the verdict from there at its next tick. Nothing is
 *   written into the pins directory, which holds the packages' pins alone.
 * - A CHECK THAT RAN AND ENDED WITH NO FIGURES (killed by a signal, at its memory limit, or past its budget) is a
 *   refusal in the store: the spool writes the store's figure-less record of the files the daemon hashed, its reason
 *   `probe.crashed`, `probe.memory-limit` or `probe.timeout` (QUALIFICATION_NO_FIGURES_REASONS), through the store's
 *   writer (`plugin-qualification-db-write no-figures`), and plugin-hostd answers -516 for those files until the
 *   operator's `pin_accept`, as the pin file made it (decided by the coordinator 2026-11-28, the owner to confirm).
 *   A run that failed otherwise leaves the store as it was, and the plugin stays bypassed. Every end is kept beside the
 *   request (`<request>.verdict`), so it is not run again.
 * - ONE WRITER PER KIND: this writes nothing the daemon owns. The operator's `pin_accept` (the `.accepted` list) and
 *   `pin_clear` are the daemon's, and the store's records are its writer's. Every file is written by a temporary file
 *   in the same directory renamed over the target.
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";


export interface SpoolRequest {
  readonly uri: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

/** The request file's lines; undefined for one that names no uri. */
export function parseRequest(text: string): SpoolRequest | undefined {
  let uri: string | undefined;
  const files: { path: string; sha256: string }[] = [];
  for (const line of text.split("\n")) {
    const at = line.indexOf(" ");
    if (at < 0) continue;
    const key = line.slice(0, at);
    const rest = line.slice(at + 1);
    if (key === "uri") uri = rest;
    else if (key === "file") {
      const cut = rest.lastIndexOf(" ");
      if (cut > 0) files.push({ path: rest.slice(0, cut), sha256: rest.slice(cut + 1) });
    }
  }
  return uri === undefined ? undefined : { uri, files };
}

/** The cpus the console's audio threads hold, from the facts `/console/rt-split` serves; undefined when it has none. */
export function audioCpusOf(facts: { readonly driverCpu: number | null; readonly perWorker: readonly { readonly cpu: number | null }[] } | null): number[] | undefined {
  if (facts === null) return undefined;
  const cpus = new Set<number>();
  if (facts.driverCpu !== null) cpus.add(facts.driverCpu);
  for (const w of facts.perWorker) if (w.cpu !== null) cpus.add(w.cpu);
  return cpus.size === 0 ? undefined : [...cpus].sort((a, b) => a - b);
}

export type Isolation = { readonly ok: true; readonly cpus: readonly number[] } | { readonly ok: false; readonly error: string };
/** An isolation that holds: only this one may start a check. */
export type Isolated = Extract<Isolation, { readonly ok: true }>;

/** The cpus a check may run on: every online cpu that is not an audio cpu. */
export function isolationFor(audio: readonly number[] | undefined, online: readonly number[]): Isolation {
  if (audio === undefined) return { ok: false, error: "the audio cpus are not known" };
  const cpus = online.filter((c) => !audio.includes(c));
  return cpus.length === 0 ? { ok: false, error: "no cpu is left that the audio threads do not hold" } : { ok: true, cpus };
}

/** The command line that runs `argv` on those cpus only, at idle scheduling and idle io. */
export function isolatedArgv(iso: Isolated, argv: readonly string[]): string[] {
  return ["taskset", "-c", iso.cpus.join(","), "ionice", "-c", "3", "chrt", "-i", "0", ...argv];
}

export type SpoolProbeEnd =
  | { readonly kind: "exited"; readonly code: number; readonly stdout?: string }
  | { readonly kind: "signaled"; readonly signal: string }
  | { readonly kind: "memory-limit" }
  | { readonly kind: "timeout" };

/** Start `argv` isolated and wait for its end: the budget kills the whole process group; a kill that is not ours is the memory limit. */
export function spawnIsolated(iso: Isolated, argv: readonly string[], opts: { readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv }): Promise<SpoolProbeEnd & { stdout: string }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = isolatedArgv(iso, argv);
    const child = spawn(cmd!, args, { detached: true, stdio: ["ignore", "pipe", "ignore"], env: opts.env ?? process.env });
    let stdout = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone already */ }
    }, opts.timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) resolve({ kind: "timeout", stdout });
      else if (signal === "SIGKILL") resolve({ kind: "memory-limit", stdout });
      else if (signal !== null) resolve({ kind: "signaled", signal, stdout });
      else resolve({ kind: "exited", code: code ?? 1, stdout });
    });
    child.on("error", () => { clearTimeout(timer); resolve({ kind: "exited", code: 127, stdout }); });
  });
}

/** A file written by a temporary file in its directory renamed over it; `beforeRename` is the seam a test kills the write at. */
export function writeAtomic(target: string, text: string, beforeRename?: () => void): void {
  const tmp = `${target}.tmp.${process.pid}`;
  mkdirSync(dirname(target), { recursive: true });
  const fd = openSync(tmp, "w", 0o644);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    beforeRename?.();
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* never written */ }
    throw e;
  }
}

export interface SpoolConfig {
  readonly spoolDir: string;
  /** The store's writer (`plugin-qualification-db-write`) and the scope it writes, for a figure-less record. */
  readonly writer: readonly string[];
  readonly scope: "user" | "system";
  readonly budgetMs: number;
  /** The check's command, `plugin-qualify-sync` and its arguments (the store's scope); `--plugin <uri>` is appended. */
  readonly quick: readonly string[];
}

export interface SpoolDeps {
  readonly audioCpus: () => readonly number[] | undefined;
  readonly onlineCpus: () => readonly number[];
  /** Runs the isolated check of one request; the default starts the quick check, isolated. */
  readonly probe: (request: SpoolRequest, iso: Isolated, cfg: SpoolConfig) => Promise<SpoolProbeEnd>;
  /** Writes the store's figure-less record of a request; the default runs the writer. undefined, or the writer's refusal. */
  readonly noFigures?: (request: SpoolRequest, reason: string, cfg: SpoolConfig) => string | undefined;
}

/** The store's names of a plugin-hostd uri: a CLAP by `clap` and the id after `#`, an LV2 plugin by `lv2` and its URI. */
export function storeKeyOf(uri: string): { readonly format: "clap" | "lv2"; readonly uri: string } {
  if (uri.startsWith("clap:")) return { format: "clap", uri: uri.slice(uri.lastIndexOf("#") + 1) };
  return { format: "lv2", uri: uri.startsWith("lv2:") ? uri.slice(4) : uri };
}

/** The writer's argv for the figure-less record of a request: its files in byte order of the path. */
export function noFiguresArgv(cfg: SpoolConfig, request: SpoolRequest, reason: string): string[] {
  const key = storeKeyOf(request.uri);
  const files = [...request.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [...cfg.writer, "no-figures", "--scope", cfg.scope, "--format", key.format, "--uri", key.uri, "--host", "omx-clap-host", "--reason", reason,
    ...files.flatMap((f) => ["--file", `${f.path}=${f.sha256}`])];
}

/** The default: the writer run, its refusal (its standard error) when it refuses. */
export const defaultNoFigures: NonNullable<SpoolDeps["noFigures"]> = (request, reason, cfg) => {
  const [cmd, ...args] = noFiguresArgv(cfg, request, reason);
  const r = spawnSync(cmd!, args, { encoding: "utf8" });
  return r.status === 0 ? undefined : (r.stderr || r.error?.message || `exit ${String(r.status)}`).trim();
};

export type SpoolOutcome =
  /** The check ran to its end: its record is in the store, and plugin-hostd reads the verdict there. */
  | { readonly uri: string; readonly stored: true }
  /** The check ran and ended with no figures: the store's figure-less record refuses its files. */
  | { readonly uri: string; readonly refused: string }
  /** The check ended with no record (a failed run, or a figure-less record the writer refused): the store is as it was. */
  | { readonly uri: string; readonly unstored: string }
  | { readonly uri: string; readonly deferred: string };

/** How a check ended: a record in the store, or the outcome code of an end that left none. */
function outcomeOf(end: SpoolProbeEnd): { stored: true } | { stored: false; reason: string } {
  switch (end.kind) {
    case "signaled": return { stored: false, reason: "probe.crashed" };
    case "memory-limit": return { stored: false, reason: "probe.memory-limit" };
    case "timeout": return { stored: false, reason: "probe.timeout" };
    case "exited": return end.code === 0 ? { stored: true } : { stored: false, reason: "probe.refused-instantiation" };
  }
}

/** One pass over the spool: each request without a verdict is qualified, one at a time. */
export async function runSpoolOnce(cfg: SpoolConfig, deps: SpoolDeps): Promise<SpoolOutcome[]> {
  const out: SpoolOutcome[] = [];
  if (!existsSync(cfg.spoolDir)) return out;
  for (const name of readdirSync(cfg.spoolDir).filter((f) => f.endsWith(".request")).sort()) {
    const path = join(cfg.spoolDir, name);
    const verdictPath = path.replace(/\.request$/, ".verdict");
    if (existsSync(verdictPath)) continue;
    const request = parseRequest(readFileSync(path, "utf8"));
    if (request === undefined) continue;
    const iso = isolationFor(deps.audioCpus(), deps.onlineCpus());
    if (!iso.ok) {
      process.stderr.write(`plugin-qualify-spool: ${request.uri}: not run: ${iso.error}\n`);
      out.push({ uri: request.uri, deferred: iso.error });
      continue;
    }
    const end = await deps.probe(request, iso, cfg);
    const result = outcomeOf(end);
    if (result.stored) {
      writeAtomic(verdictPath, JSON.stringify({ uri: request.uri, stored: true }) + "\n");
      out.push({ uri: request.uri, stored: true });
      continue;
    }
    const figureless = end.kind === "signaled" || end.kind === "memory-limit" || end.kind === "timeout";
    const refusal = figureless ? (deps.noFigures ?? defaultNoFigures)(request, result.reason, cfg) : undefined;
    if (figureless && refusal === undefined) {
      writeAtomic(verdictPath, JSON.stringify({ uri: request.uri, stored: true, refused: result.reason }) + "\n");
      out.push({ uri: request.uri, refused: result.reason });
      continue;
    }
    if (refusal !== undefined) process.stderr.write(`plugin-qualify-spool: ${request.uri}: the store's writer refused the record of ${result.reason}: ${refusal}\n`);
    writeAtomic(verdictPath, JSON.stringify({ uri: request.uri, stored: false, reason: result.reason }) + "\n");
    out.push({ uri: request.uri, unstored: result.reason });
  }
  return out;
}

/** The default check: the one-plugin qualification of the request's plugin, isolated, which puts its record in the store. */
export const defaultProbe: SpoolDeps["probe"] = async (request, iso, cfg) => {
  const end = await spawnIsolated(iso, [...cfg.quick, "--plugin", request.uri], { timeoutMs: cfg.budgetMs });
  return end.kind === "exited" ? { kind: "exited", code: end.code } : end;
};

/** The audio cpus as the console serves them (`GET /console/rt-split`, its `facts`), or undefined when it cannot be read. */
export async function consoleAudioCpus(base: string, fetcher: typeof fetch = fetch): Promise<number[] | undefined> {
  try {
    const res = await fetcher(`${base.replace(/\/$/, "")}/console/rt-split`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { facts?: Parameters<typeof audioCpusOf>[0] };
    return audioCpusOf(body.facts ?? null);
  } catch {
    return undefined;
  }
}
