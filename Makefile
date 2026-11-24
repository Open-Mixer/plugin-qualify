# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
# plugin-qualify builds and tests with pnpm (package.json); this file holds only the target Open-Mixer/.github's
# docs-publish.yml calls.

# The published reference: docs-publish.yml runs this with DOCS_OUT, an empty absolute directory, then renders the
# Markdown and the man pages and, at a release tag, publishes the tree under
# https://www.openmixer.org/reference/plugin-qualify/<version>/. Only what the tree keeps: the man pages of the three
# commands (packaging/*.1, the ones the package installs), docs/, README, BUILDING and LICENSE.
.PHONY: docs-site
docs-site:
	@case "$(DOCS_OUT)" in /*) ;; *) echo "docs-site: FAIL - DOCS_OUT '$(DOCS_OUT)' is not an absolute directory: name the directory the reference is written to" >&2; exit 1;; esac
	@for b in bin/*.mjs; do m=packaging/$$(basename "$$b" .mjs).1; test -f "$$m" || { echo "docs-site: FAIL - the command $$b has no man page $$m" >&2; exit 1; }; done
	mkdir -p $(DOCS_OUT)/man $(DOCS_OUT)/docs
	cp README.md BUILDING.md LICENSE $(DOCS_OUT)/
	cp docs/*.md $(DOCS_OUT)/docs/
	cp packaging/*.1 $(DOCS_OUT)/man/
