// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The Node side of the `probe` domain: reads `<dir>/probe/probe.json` through omx-contract's domain reader
 * (`openDomainAt`, the TypeScript counterpart of the C loader). The library's default is the installed place and nothing
 * else; only a CLI entry point (`initProbeFromEnv`) and a test read another, which they name explicitly. Importing this
 * module registers the installed reader. A browser-reachable module never imports this one (it reads files).
 */
import { openDomainAt } from "@openmixer/omx-contract/domain-reader";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { initProbeDomain, PROBE_DOMAIN, ProbeDomainError, registerInstalledProbeReader, type ProbeWordSource } from "./probe-domain.js";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";

/** Opens the domain from `<dir>/probe/probe.json` (the first of a list that holds it): the explicit entry of a test or a CLI. */
export function openProbeDomainAt(dirs: string | readonly string[]): ProbeWordSource {
  try {
    return openDomainAt(dirs, PROBE_DOMAIN);
  } catch (e) {
    throw new ProbeDomainError(Array.isArray(dirs) ? dirs.join(":") : String(dirs), (e as Error).message);
  }
}

/** Opens the installed domain: the library's default entry. It reads no environment variable. */
export function openInstalledProbeDomain(): ProbeWordSource {
  return openProbeDomainAt(INSTALLED_CONTRACT_DIR);
}

registerInstalledProbeReader(openInstalledProbeDomain);

/**
 * The start-up of a CLI entry point: OMX_CONTRACT_PATH, when set, is a ':' list of directories each standing where the
 * contract directory stands; the first directory that holds the probe domain wins. None holding it leaves the domain the
 * installed one. Production reads the installed path; library code never calls this.
 */
export function initProbeFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const list = (env.OMX_CONTRACT_PATH ?? "").split(":").filter((d) => d !== "");
  const holder = list.find((d) => existsSync(join(d, PROBE_DOMAIN, `${PROBE_DOMAIN}.json`)));
  if (holder !== undefined) initProbeDomain(openProbeDomainAt(holder));
}
