# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
# plugin-qualify builds and tests with pnpm (package.json); this file holds the target Open-Mixer/.github's
# docs-publish.yml calls and the link to the channel's omx-contract the tests and the bundled copy read.

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

PREFIX ?= /usr/local
OMX_CONTRACT_LIB ?= $(PREFIX)/lib/omx-contract

# The tree reads the omx-contract the channel installs, never the registry's copy pnpm install fetched:
# node_modules/@openmixer/omx-contract becomes a link to omx-contract's directory. A devel wave stages versions the
# registry has not got (npm publishes from a tag only), so the tests and the copy packaging/build.sh bundles are the
# wave's. Link after tsc: the packaged omx-contract ships no declaration files, so the compile reads the registry copy's.
# A package build passes PREFIX=/usr; an omx-contract not installed is refused by name.
.PHONY: link-packaged
link-packaged:
	@test -f $(OMX_CONTRACT_LIB)/package.json || { echo "link-packaged: no omx-contract at $(OMX_CONTRACT_LIB): install its package (or pass PREFIX)" >&2; exit 1; }
	@install -d node_modules/@openmixer
	@rm -rf node_modules/@openmixer/omx-contract
	@ln -sfn $(OMX_CONTRACT_LIB) node_modules/@openmixer/omx-contract
	@echo "link-packaged: @openmixer/omx-contract -> $(OMX_CONTRACT_LIB) ($$(node -p "require('$(OMX_CONTRACT_LIB)/package.json').version"))"
