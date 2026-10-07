#!/usr/bin/env bash
# Specification tooling only: no application imports, providers, database or writer.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/.." && pwd)
contract_root="$repo_root/apps/world/tml/contracts/v1"
tml_python=${TML_CONTRACT_PYTHON:-python3}

(cd "$contract_root" && sha256sum -c SHA256SUMS)
"$tml_python" - "$contract_root" <<'PY'
import json, sys
from pathlib import Path
import jsonschema
from referencing import Registry, Resource

root = Path(sys.argv[1])
schemas = [json.loads(p.read_text()) for p in sorted((root / 'schemas').glob('*.json'))]
registry = Registry().with_resources((s['$id'], Resource.from_contents(s)) for s in schemas)
for schema in schemas:
    jsonschema.Draft202012Validator.check_schema(schema)
corpus_schema = next(s for s in schemas if s['$id'] == 'urn:tml:v1:corpus')
corpus = json.loads((root / 'conformance-corpus.json').read_text())
jsonschema.Draft202012Validator(corpus_schema, registry=registry).validate(corpus)
case_validator = jsonschema.Draft202012Validator(corpus_schema['properties']['cases']['items'], registry=registry)
for case in corpus['cases']:
    case_validator.validate(case)
ids = [case['id'] for case in corpus['cases']]
previous = json.loads((root / 'provenance/previous-corpus.json').read_text())
previous_ids = {case['id'] for case in previous['cases']}
manifest = json.loads((root / 'canonical-digest-manifest.json').read_text())
reasons = json.loads((root / 'reason-registry.json').read_text())['reasons']
sets = json.loads((root / 'structural-sets.json').read_text())['sets']
assert len(schemas) == 5
assert len(ids) == len(set(ids)) == 244
assert len(previous_ids) == 112 and previous_ids <= set(ids)
assert len(manifest['entries']) == 252
assert len(reasons) == len({reason['code'] for reason in reasons}) == 82
assert len(sets) == 24
oracles = {(entry['canonicalUtf8'], entry['sha256']) for entry in manifest['entries']}
for case in corpus['cases']:
    expected = case['expected']
    if expected['canonicalUtf8'] is not None:
        assert (expected['canonicalUtf8'], expected['digest']) in oracles, case['id']
print('PR1: 5 schemas and all 244 corpus records valid; frozen counts and oracle coverage match')
PY

"$tml_python" "$contract_root/tools/check_semantics.py"
node "$contract_root/tools/check_oracles.mjs"

# Regenerate only in a disposable copy; the checked-in candidate is never rewritten.
tml_scratch=$(mktemp -d)
trap 'rm -rf -- "$tml_scratch"' EXIT
cp -R "$contract_root" "$tml_scratch/v1"
"$tml_python" "$tml_scratch/v1/tools/build.py"
"$tml_python" - "$contract_root" "$tml_scratch/v1" <<'PY'
import hashlib, sys
from pathlib import Path

def inventory(root):
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob('*')
        if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc'
    }

original, regenerated = (inventory(Path(arg)) for arg in sys.argv[1:])
changed = sorted(name for name in original.keys() | regenerated.keys() if original.get(name) != regenerated.get(name))
if changed:
    raise SystemExit('Non-deterministic regeneration: ' + ', '.join(changed))
print(f'PR1: deterministic regeneration matches all {len(original)} candidate files byte-for-byte')
PY
