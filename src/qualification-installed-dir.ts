// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Where the installed contract directory is: the rpm and the deb both put omx-contract's contract directory here, and the
 * qualification domain in it (packaging/plugin-qualify.spec, debian/rules). A production program takes no other place and
 * reads no environment variable for it; a test points the reader elsewhere with `openQualificationDomainAt`.
 */
export const INSTALLED_CONTRACT_DIR = "/usr/share/omx-contract/contract.d";
