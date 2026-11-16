# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Pau Aliagas <linuxnow@gmail.com>
"""What descriptors.py writes is read by omx-contract's own loader.

The `$schema` of a descriptor is the one address the loader accepts,
https://openmixer.org/schema/omx-contract/omx-contract.schema.json: a literal here, never the constant of
descriptors.py, so a moved address is a red test. The descriptor is also put in a contract directory and read by
loadContractDir when OMX_CONTRACT_LOADER names omx-contract's built contract-dir.mjs. A scanned descriptor is never
installed, so the copy the loader reads says origin "authored": the loader must get past its `$schema` check, and any
refusal it gives must be another one.
"""
import hashlib
import json
import os
import subprocess
import tempfile
import unittest

import descriptors as d
import test_descriptors as t

SCHEMA = "https://openmixer.org/schema/omx-contract/omx-contract.schema.json"
LOADER = os.environ.get("OMX_CONTRACT_LOADER")


class SchemaAddress(unittest.TestCase):
    def doc(self):
        [(doc, _sha)] = d.clap_described(t.controls_scan(t.SHA_A))
        return doc

    def test_constant_is_the_loaders_address(self):
        self.assertEqual(d.SCHEMA_URL, SCHEMA)

    def test_descriptor_carries_it(self):
        self.assertEqual(self.doc()["$schema"], SCHEMA)

    @unittest.skipUnless(LOADER, "OMX_CONTRACT_LOADER names no omx-contract contract-dir.mjs")
    def test_loader_gets_past_the_schema_check(self):
        with tempfile.TemporaryDirectory() as tmp:
            pkg = os.path.join(tmp, "3", "plugin-qualify-descriptors")
            os.makedirs(pkg)
            body = json.dumps(dict(self.doc(), origin="authored"), indent=2)
            with open(os.path.join(pkg, "d.json"), "w") as f:
                f.write(body)
            with open(os.path.join(pkg, "MANIFEST.json"), "w") as f:
                json.dump({"package": "plugin-qualify-descriptors", "version": "0.0.0", "schemaMajor": 3,
                           "files": {"d.json": hashlib.sha256(body.encode()).hexdigest()}}, f)
            js = ("import(process.argv[1]).then(m=>{try{m.loadContractDir({dir:process.argv[2],env:{}});"
                  "console.log('loaded')}catch(e){console.log(e.code+': '+e.message)}})")
            out = subprocess.run(["node", "-e", js, LOADER, tmp], capture_output=True, text=True).stdout.strip()
            self.assertNotIn("schema.major", out, out)
            print("loadContractDir:", out[:300])


if __name__ == "__main__":
    unittest.main()
