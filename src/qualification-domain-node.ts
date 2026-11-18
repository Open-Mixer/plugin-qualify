// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The Node side of the `qualification` domain: reads `<dir>/qualification/qualification.json`. The library's default is the
 * installed place and nothing else; only a CLI entry point (`initFromEnv`) and a test read another, which they name
 * explicitly. Importing this module registers the installed reader, so a Node program that never calls `init` reads the
 * installed document at its first use. A browser-reachable module never imports this one (it has `node:fs`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  init,
  parseQualificationDomain,
  QUALIFICATION_DOMAIN,
  QualificationDomainError,
  registerInstalledReader,
  type QualificationDomain,
} from "./qualification-domain.js";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";

function read(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new QualificationDomainError(file, code === "ENOENT" ? "absent" : `unreadable (${code ?? "error"})`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new QualificationDomainError(file, `not JSON (${(e as Error).message})`);
  }
}

/** Opens the domain from `<dir>/qualification/qualification.json`: the explicit entry of a test or a CLI. */
export function openQualificationDomainAt(dir: string): QualificationDomain {
  const file = join(dir, QUALIFICATION_DOMAIN, `${QUALIFICATION_DOMAIN}.json`);
  return parseQualificationDomain(read(file), file);
}

/** Opens the installed domain: the library's default entry. It reads no environment variable. */
export function openInstalledQualificationDomain(): QualificationDomain {
  return openQualificationDomainAt(INSTALLED_CONTRACT_DIR);
}

registerInstalledReader(openInstalledQualificationDomain);

/**
 * The start-up of a CLI entry point: OMX_CONTRACT_PATH, when set, is a ':' list of directories each standing where the
 * contract directory stands (omx-contract docs/contract-dir.md); empty entries are dropped and the first directory that holds
 * the domain wins. None holding it is a refusal naming the directories tried. Unset, the domain stays the installed one.
 * Production reads the installed path; library code never calls this.
 */
export function initFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const list = (env.OMX_CONTRACT_PATH ?? "").split(":").filter((d) => d !== "");
  if (list.length === 0) return;
  const holder = list.find((d) => existsSync(join(d, QUALIFICATION_DOMAIN, `${QUALIFICATION_DOMAIN}.json`)));
  if (holder === undefined) {
    throw new QualificationDomainError(`OMX_CONTRACT_PATH`, `absent from every directory tried: ${list.join(", ")}`);
  }
  init(read(join(holder, QUALIFICATION_DOMAIN, `${QUALIFICATION_DOMAIN}.json`)));
}
