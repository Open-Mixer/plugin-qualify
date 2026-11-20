// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * The reader of the `qualification` domain (contract.d/qualification/qualification.json, owner plugin-qualify), the
 * document of the words a measurement, a verdict and a host profile speak. The document is DATA, read once at start-up
 * from the installed contract directory (docs/runtime-data.md of omx-contract): nothing here is generated from it, and
 * no copy of its words lives in the source.
 *
 * The document is validated at start-up: it states JSON Schema 2020-12 as its dialect, it is itself a valid schema of
 * that dialect (Ajv), it has the shape of a domain document (`DomainDocument`, derived from `DOMAIN_DOCUMENT_SCHEMA` by
 * `FromSchema`), and its `info.version` is at least the floor this package declares. A missing, invalid or too-old
 * document throws a {@link QualificationDomainError} that names the domain, the place looked and the reason.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import type { FromSchema } from "json-schema-to-ts";

/** The domain's name, its directory and its file's stem. */
export const QUALIFICATION_DOMAIN = "qualification";

/** The lowest `info.version` of the domain this package works with: the version its code was written against. */
export const QUALIFICATION_DOMAIN_FLOOR = "1.1.0";

/** The shape of a domain document that this reader relies on (omx-contract docs/contract-dir.md, "Domains"). */
// TODO: read the domain-document schema from @openmixer/omx-contract (schema/domain.schema.json, omx-contract 3.20.0; omx-contract#113 is merged, the swap waits for the release): FromSchema over `domainSchema` of @openmixer/omx-contract/domain-schema; drop this const
const DOMAIN_DOCUMENT_SCHEMA = {
  type: "object",
  required: ["$schema", "$id", "info", "components"],
  properties: {
    $schema: { const: "https://json-schema.org/draft/2020-12/schema" },
    $id: { const: "https://openmixer.org/contract/qualification" },
    info: {
      type: "object",
      required: ["title", "version", "x-stability"],
      properties: {
        title: { type: "string" },
        version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
        "x-stability": { enum: ["experimental", "stable"] },
      },
    },
    components: {
      type: "object",
      required: ["schemas"],
      properties: {
        schemas: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["oneOf"],
            properties: {
              oneOf: {
                type: "array",
                items: {
                  type: "object",
                  required: ["const", "title"],
                  properties: {
                    const: { type: "string" },
                    title: { type: "string" },
                    "x-group": { type: "string" },
                    "x-text": { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type DomainDocument = FromSchema<typeof DOMAIN_DOCUMENT_SCHEMA>;

/** One word of an item, as the document declares it. */
export interface DomainWord {
  readonly word: string;
  readonly title: string;
  readonly group: string | undefined;
  readonly text: string | undefined;
}

/** A domain document the package cannot use: absent, unreadable, not valid, or below the floor. */
export class QualificationDomainError extends Error {
  constructor(place: string, reason: string) {
    super(`domain "${QUALIFICATION_DOMAIN}" at ${place}: ${reason}`);
    this.name = "QualificationDomainError";
  }
}

/** An opened, validated domain. */
export interface QualificationDomain {
  readonly version: string;
  /** The words of an item, in the declared order; throws, naming the item, when the document has no such item. */
  words(item: string): readonly string[];
  /** The words of an item with their title, group and English sentence, in the declared order. */
  entries(item: string): readonly DomainWord[];
}

const semverParts = (v: string): number[] => v.split(".").map(Number);
const atLeast = (version: string, floor: string): boolean => {
  const a = semverParts(version);
  const b = semverParts(floor);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

const Ajv2020 = Ajv2020Module as unknown as typeof Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateShape = ajv.compile<DomainDocument>(DOMAIN_DOCUMENT_SCHEMA);

/**
 * Validates a domain document and opens it; `place` names where it came from, for the refusal. Free of any Node module, so
 * a browser bundle can use it: the page hands its served document to {@link init}.
 */
export function parseQualificationDomain(raw: unknown, place: string): QualificationDomain {
  const file = place;
  if (typeof raw !== "object" || raw === null || (raw as { $schema?: unknown }).$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new QualificationDomainError(file, 'not valid: it must state "$schema": "https://json-schema.org/draft/2020-12/schema"');
  }
  if (!validateShape(raw)) {
    const why = (validateShape.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`).join("; ");
    throw new QualificationDomainError(file, `not valid against the shape of a domain document: ${why}`);
  }
  const doc: DomainDocument = raw as DomainDocument;
  if (!ajv.validateSchema(doc)) {
    throw new QualificationDomainError(file, `not a valid JSON Schema 2020-12 document: ${ajv.errorsText(ajv.errors)}`);
  }
  if (!atLeast(doc.info.version, QUALIFICATION_DOMAIN_FLOOR)) {
    throw new QualificationDomainError(file, `info.version ${doc.info.version} is below the floor ${QUALIFICATION_DOMAIN_FLOOR}`);
  }
  const itemOf = (item: string) => {
    const schema = doc.components.schemas[item];
    if (schema === undefined) throw new QualificationDomainError(file, `has no item ${item}`);
    return schema;
  };
  return {
    version: doc.info.version,
    words: (item) => itemOf(item).oneOf.map((w) => w.const),
    entries: (item) =>
      itemOf(item).oneOf.map((w) => ({ word: w.const, title: w.title, group: w["x-group"], text: w["x-text"] })),
  };
}

let handed: QualificationDomain | undefined;
let installedReader: (() => QualificationDomain) | undefined;

/**
 * Hands the domain document to this package, validated exactly as the installed file is (`$schema`, Ajv 2020, the
 * shape, the `info.version` floor). A page calls it at start-up with the JSON its server serves, before it uses any
 * word of the domain (WebAssembly's way, omx-contract docs/runtime-data.md); a Node program that wants another document
 * than the installed one calls it too.
 */
export function init(doc: unknown): QualificationDomain {
  handed = parseQualificationDomain(doc, "the document handed to init()");
  return handed;
}

/** Registers how a Node program reads the installed file; only the Node module of the domain calls it. */
export function registerInstalledReader(read: () => QualificationDomain): void {
  installedReader = read;
}

/**
 * The domain in use: the one handed to {@link init}, else (Node, once its reader is registered) the installed one, read at
 * the first use and kept. Anywhere else it refuses by name.
 */
export function qualificationDomain(): QualificationDomain {
  if (handed !== undefined) return handed;
  if (installedReader === undefined) throw new QualificationDomainError("the page", "qualification domain not handed: call init(doc) first");
  handed = installedReader();
  return handed;
}

/** The line every CLI's --help carries for the override only a CLI reads. */
export const OMX_CONTRACT_PATH_HELP =
  "OMX_CONTRACT_PATH: a test and development override of the contract directory; production reads the installed path.";

/** A CLI's help text with the line of OMX_CONTRACT_PATH after it. */
export const withContractPathHelp = (text: string): string => `${text.trimEnd()}\n\nEnvironment:\n  ${OMX_CONTRACT_PATH_HELP}\n`;
