// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/** `{ floor, ceiling }` read from the spec's `pkgconfig(clap)` constraint, or null if absent. */
export function specClapRange(spec: string): { floor: string; ceiling: string } | null;
/** `{ floor, ceiling }` read from `debian/control`'s `clap-headers` constraint, or null if absent. */
export function controlClapRange(control: string): { floor: string; ceiling: string } | null;
/** null when the spec and `debian/control` declare the same CLAP floor and ceiling; the failure message otherwise. */
export function checkClapFloor(spec: string, control: string): string | null;
