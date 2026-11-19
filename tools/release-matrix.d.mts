// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
export interface ReleaseMatrixDeclaration {
  comment?: string;
  rpm: { fedora: string[]; arches: string[] };
  deb: { suites: string[]; arches: string[] };
}
export interface DerivedMatrix {
  rpmFedora: string[];
  rpmArches: string[];
  debSuites: string[];
  debArches: string[];
  installRpmArches: string[];
  installDebArches: string[];
}
/** What the builds and the install job read, derived from the one declaration. */
export function deriveMatrix(decl: ReleaseMatrixDeclaration, opts: { arm: boolean }): DerivedMatrix;
