// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Imported first by every CLI entry point (bin/, tools/): reads OMX_CONTRACT_PATH, when set, as the contract directory of
 * the qualification domain. It is the CLI's start-up and no library module imports it.
 */
import { initFromEnv } from "./qualification-domain-node.js";

initFromEnv();
