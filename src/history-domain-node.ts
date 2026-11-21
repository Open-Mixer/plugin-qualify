// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The Node side of the `history` domain: reads `<dir>/history/history.json` through omx-contract's domain reader
 * (`openDomainAt`). The library's default is the installed place and nothing else; a test reads another, which it names
 * explicitly. Importing this module registers the installed reader.
 */
import { openDomainAt } from "@openmixer/omx-contract/domain-reader";
import { HISTORY_DOMAIN, HISTORY_DOMAIN_FLOOR, HistoryDomainError, registerInstalledHistoryReader, type HistoryWordSource } from "./history-domain.js";
import { INSTALLED_CONTRACT_DIR } from "./qualification-installed-dir.js";

/** Opens the domain from `<dir>/history/history.json`: the explicit entry of a test. */
export function openHistoryDomainAt(dirs: string | readonly string[]): HistoryWordSource {
  try {
    return openDomainAt(dirs, HISTORY_DOMAIN, HISTORY_DOMAIN_FLOOR);
  } catch (e) {
    throw new HistoryDomainError(Array.isArray(dirs) ? dirs.join(":") : String(dirs), (e as Error).message);
  }
}

/** Opens the installed domain: the library's default entry. It reads no environment variable. */
export function openInstalledHistoryDomain(): HistoryWordSource {
  return openHistoryDomainAt(INSTALLED_CONTRACT_DIR);
}

registerInstalledHistoryReader(openInstalledHistoryDomain);
