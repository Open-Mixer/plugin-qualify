// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The tests read the domain of this checkout, contract.d/qualification/, where a program reads the installed one
 * (`INSTALLED_CONTRACT_DIR`): the source tree is the owner's document, and the install copies it byte for byte
 * (packaging/plugin-qualify.spec, debian/rules). Only a test sets the place; a production program has no way to.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

vi.mock("./qualification-installed-dir.js", () => ({
  INSTALLED_CONTRACT_DIR: join(dirname(fileURLToPath(import.meta.url)), "..", "contract.d"),
}));
