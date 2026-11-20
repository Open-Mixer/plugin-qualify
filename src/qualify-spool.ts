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
 * - A VERDICT, EVERY TIME: a pass is the verdict the run earned (`in-process` or `isolated`); a refusal, a prober
 *   killed by a signal, a memory-limit kill and the budget passing are each `verdict=refused`, with the probe's outcome
 *   code as the reason (`probe.crashed`, `probe.memory-limit`, `probe.timeout`), in the pin file and in a record beside
 *   the request (`<request>.verdict`, since a pin line has no word for a reason).
 * - ONE WRITER PER KIND: this writes pin files in the pins directory and nothing the daemon owns. The operator's
 *   `pin_accept` (the `.accepted` list) and `pin_clear` are the daemon's; a verdict never touches them, and one that
 *   finishes after a `pin_clear` of its files (the store no longer holds the plugin, or holds other files) is dropped.
 *   Every file is written by a temporary file in the same directory renamed over the target.
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { pinLineUri, pinWords } from "./pins-file.js";

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

/** The cpus a check may run on: every online cpu that is not an audio cpu. */
export function isolationFor(audio: readonly number[] | undefined, online: readonly number[]): Isolation {
  if (audio === undefined) return { ok: false, error: "the audio cpus are not known" };
  const cpus = online.filter((c) => !audio.includes(c));
  return cpus.length === 0 ? { ok: false, error: "no cpu is left that the audio threads do not hold" } : { ok: true, cpus };
}

/** The command line that runs `argv` on those cpus only, at idle scheduling and idle io. */
export function isolatedArgv(iso: { readonly cpus: readonly number[] }, argv: readonly string[]): string[] {
  return ["taskset", "-c", iso.cpus.join(","), "ionice", "-c", "3", "chrt", "-i", "0", ...argv];
}

export type SpoolProbeEnd =
  | { readonly kind: "exited"; readonly code: number; readonly stdout?: string; readonly pinsText?: string }
  | { readonly kind: "signaled"; readonly signal: string }
  | { readonly kind: "memory-limit" }
  | { readonly kind: "timeout" };

/** Start `argv` isolated and wait for its end: the budget kills the whole process group; a kill that is not ours is the memory limit. */
export function spawnIsolated(iso: { readonly cpus: readonly number[] }, argv: readonly string[], opts: { readonly timeoutMs: number; readonly env?: NodeJS.ProcessEnv }): Promise<SpoolProbeEnd & { stdout: string }> {
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
  /** plugin-hostd's pins directory: the verdicts are one file of it. */
  readonly pinsDir: string;
  /** plugin-hostd's pin store, which holds the pin the daemon learned; read, never written. */
  readonly storePath: string;
  readonly budgetMs: number;
  /** The quick check's command, `plugin-qualify` and the arguments that make it quick (the plugin's uri is appended). */
  readonly quick: readonly string[];
}

export interface SpoolDeps {
  readonly audioCpus: () => readonly number[] | undefined;
  readonly onlineCpus: () => readonly number[];
  /** Runs the isolated check of one request; the default starts the quick check, isolated. */
  readonly probe: (request: SpoolRequest, iso: { readonly cpus: readonly number[] }, cfg: SpoolConfig) => Promise<SpoolProbeEnd>;
}

export type SpoolOutcome =
  | { readonly uri: string; readonly verdict: "in-process" | "isolated" }
  | { readonly uri: string; readonly verdict: "refused"; readonly reason: string }
  | { readonly uri: string; readonly deferred: string }
  | { readonly uri: string; readonly dropped: string };

const VERDICT_FILE = "90-qualify-spool.pins";

/** hostd's `PHD_PIN_LAYOUT_UNKNOWN`: a verdict about files whose layout no worker has read yet. */
const LAYOUT_UNKNOWN = "-";

function outcomeOf(end: SpoolProbeEnd): { verdict: "in-process" | "isolated" | "refused"; reason?: string; line?: string } {
  switch (end.kind) {
    case "signaled": return { verdict: "refused", reason: "probe.crashed" };
    case "memory-limit": return { verdict: "refused", reason: "probe.memory-limit" };
    case "timeout": return { verdict: "refused", reason: "probe.timeout" };
    case "exited": {
      const line = (end.pinsText ?? "").split("\n").find((l) => l.trim() !== "");
      const word = line === undefined ? undefined : pinWords(line).find((w) => w.startsWith("verdict="))?.slice(8);
      if (end.code === 0 && (word === "in-process" || word === "isolated")) return { verdict: word, line };
      // a run that ended with no passing verdict: the check itself refused, or the plugin would not instantiate
      return { verdict: "refused", reason: end.code === 0 ? "qualify.compare.rt-unsafe" : "probe.refused-instantiation" };
    }
  }
}

/** The store's line of the uri: the pin the daemon holds for it, undefined once `pin_clear` took it away. */
function storedLine(storePath: string, uri: string): string | undefined {
  if (!existsSync(storePath)) return undefined;
  return readFileSync(storePath, "utf8").split("\n").find((l) => l.trim() !== "" && pinLineUri(l) === uri);
}

/** The path=digest word of a pin line, as a comparable list. */
function filesOf(line: string): string {
  const w = pinWords(line);
  return (w[0] === "pin_set" ? w[2] : w[1]) ?? "";
}

function pinsFileLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "") : [];
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
    // the verdict is about the files the daemon hashed: it stands only while the store still holds them
    const held = storedLine(cfg.storePath, request.uri);
    const asked = request.files.map((f) => `${f.path}=${f.sha256}`).join(",");
    if (held === undefined) {
      out.push({ uri: request.uri, dropped: "the pin store no longer holds the plugin" });
      continue;
    }
    if (filesOf(held) !== asked) {
      out.push({ uri: request.uri, dropped: "the pin store holds other files than the request named" });
      continue;
    }
    const line = result.line ?? `${pinPrefix(request.uri)} ${asked} ${LAYOUT_UNKNOWN} verdict=${result.verdict}`;
    const target = join(cfg.pinsDir, VERDICT_FILE);
    const kept = pinsFileLines(target).filter((l) => pinLineUri(l) !== request.uri);
    writeAtomic(target, [...kept, line.replace(/^pin_set /, "")].join("\n") + "\n");
    writeAtomic(verdictPath, JSON.stringify({ uri: request.uri, verdict: result.verdict, ...(result.reason ? { reason: result.reason } : {}) }) + "\n");
    out.push(result.verdict === "refused" ? { uri: request.uri, verdict: "refused", reason: result.reason! } : { uri: request.uri, verdict: result.verdict });
  }
  return out;
}

/** A pin line in a pins directory file has no verb; its uri is one word. */
function pinPrefix(uri: string): string {
  return /[ "]/.test(uri) ? `"${uri.replaceAll('"', '\\"')}"` : uri;
}

/** The default probe: the quick `plugin-qualify` run of the request's plugin, isolated, its pin line read back. */
export const defaultProbe: SpoolDeps["probe"] = async (request, iso, cfg) => {
  const tmp = join(cfg.spoolDir, `.probe-${process.pid}.pins`);
  const end = await spawnIsolated(iso, [...cfg.quick, request.uri, "--pins", tmp], { timeoutMs: cfg.budgetMs });
  let pinsText: string | undefined;
  try { pinsText = readFileSync(tmp, "utf8"); } catch { /* the run wrote none */ }
  try { unlinkSync(tmp); } catch { /* none */ }
  return end.kind === "exited" ? { kind: "exited", code: end.code, ...(pinsText === undefined ? {} : { pinsText }) } : end;
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
