// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/** The spec's `pkgconfig(clap)` ceiling relation, or null when it has none. */
export function specClapCeiling(spec: string): string | null;
/** The `debian/control` clap-headers ceiling relation, or null when it has none. */
export function controlClapCeiling(control: string): string | null;
/** `{ floor }` read from the spec's `pkgconfig(clap)` constraint, or null if absent. */
export function specClapFloor(spec: string): { floor: string } | null;
/** `{ floor }` read from `debian/control`'s `clap-headers` constraint, or null if absent. */
export function controlClapFloor(control: string): { floor: string } | null;
/** null when the spec and `debian/control` declare the same CLAP floor with no ceiling; the failure message otherwise. */
export function checkClapFloor(spec: string, control: string): string | null;
