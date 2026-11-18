// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The Node side of the `qualification` domain: reads `<dir>/qualification/qualification.json`. The library's default is the
 * installed place and nothing else; only a CLI entry point (`initFromEnv`) and a test read another, which they name
 * explicitly. Importing this module registers the installed reader, so a Node program that never calls `init` reads the
 * installed document at its first use. A browser-reachable module never imports this one (it has `node:fs`).
 */
import { readFileSync } from "node:fs";
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
 * The start-up of a CLI entry point: when OMX_CONTRACT_PATH is set (a test and development override; production reads the
 * installed path), the domain is read from that directory, else it stays the installed one. Library code never calls it.
 */
export function initFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const dir = env.OMX_CONTRACT_PATH;
  if (dir !== undefined && dir !== "") init(read(join(dir, QUALIFICATION_DOMAIN, `${QUALIFICATION_DOMAIN}.json`)));
}
