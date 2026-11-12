// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/** null when `pkg.repository.url` (git+ prefix aside) names `githubRepository`; the failure message otherwise. */
export function checkRepository(pkg: { repository?: { url?: string } }, githubRepository: string): string | null;
