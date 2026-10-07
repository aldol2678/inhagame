# TML Contract v1 specification baseline

This PR1 imports the reviewed **READY_TO_FREEZE** candidate under [`v1/`](v1/)
without changing any candidate bytes. Read [`v1/CONTRACT.md`](v1/CONTRACT.md)
for the normative specification and [PR1-IMPORT.md](PR1-IMPORT.md) for repository
drift and import provenance.

Branch readiness is not an official freeze. This baseline becomes canonical only
after its PR is merged into public `aldol2678/inhagame` main. Record and read back
the resulting merge SHA separately after merge; this import does not perform one.

The v0.1 schemas, profiles, adapters and P3–P18 runtime remain independent of
these v1 specification artifacts. No application imports this directory, and no
v1 writer, receipt provider, admission provider or evaluator is enabled here.
The included reference harness is bounded validation tooling, not a production
evaluator or a claim of Rust/C++/WASM implementation conformance.

## Artifact inventory

The candidate contains 23 files, including five closed schemas (core records,
evaluation bundle, minimal profile, conformance envelope and host fixture),
244 conformance vectors, 252 canonical/digest entries, 24 structural-set paths,
82 reason codes, the contract, freeze checklist, delta report and reference tools.
All 112 original vector IDs remain. The candidate's `SHA256SUMS` covers its other
22 files; raw file hashes are distinct from domain-separated TML record digests.

The candidate README, delta, checklist and validation report are preserved
historical records of candidate preparation against P15. Their statements that
no commit/PR was created and that P15 regressions were not rerun describe that
earlier task, not the PR1 import or its CI. They are not regenerated import reports.

## Reproduce PR1 validation

From the repository root, with Node 24.19.0 and Python 3.12:

```sh
python3 -m venv /tmp/tml-contract-v1-venv
/tmp/tml-contract-v1-venv/bin/python -m pip install -r apps/world/tml/contracts/v1/tools/requirements.txt
TML_CONTRACT_PYTHON=/tmp/tml-contract-v1-venv/bin/python bash scripts/verify-tml-contract-v1.sh
node --test apps/world/tests/tml-*.test.mjs
bash scripts/public-ci.sh
```

`verify-tml-contract-v1.sh` checks every schema and corpus envelope/record,
the frozen inventory and original IDs, then runs all 244 reference cases. The
independent Node oracle checks all 252 manifest entries, 168 applicable direct
input canonical outputs and host profile/request hashes. Regeneration uses
Python RFC 8785 plus hashlib in a disposable copy and requires all 23 files to
remain byte-identical. Expected values never come from a production evaluator.

Negative vectors intentionally contain invalid runtime inputs. Validation of
the conformance envelope must succeed while the reference path must return the
specified rejection. JSON Schema alone does not prove provenance, raw-token
validation, exact integer ranges or all normative semantic constraints.

The `tml-contract-v1` job in `Public local checks` reproduces the specification
checks. The existing `verify` job still runs the repository's unchanged local
checks and disposable-database tests. No new DB test or migration is introduced.
The commands above do not start a database, execute a migration or contact a
production service; package installation may fetch public dependencies.
