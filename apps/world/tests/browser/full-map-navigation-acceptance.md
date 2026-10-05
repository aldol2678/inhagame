# Full Map navigation acceptance

This lane runs on the exact PR head in GitHub-hosted Chromium. It was not executed in the dot cloud: its browser process/socket and localhost restrictions remain in force. No local restriction bypass, hosted site upload or Preview/Production deployment is used.

## Automated lane for an approved browser environment

From the repository root, install the pinned browser test dependencies using the repository workflow, then run:

```sh
EXPECTED_MAP_HEAD="$(git rev-parse HEAD)" WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/full-map-navigation-smoke.mjs
```

This uses the committed offline browser harness. It checks real map modules, existing campus POIs, production HTML/CSS, desktop/360px/short-landscape layouts, native Tab/Shift+Tab loops, result activation, locked/undiscovered destination guards, clearing/no-results, and reopening/restoring focus to the minimap opener. It does not load the game engine or call account/production services. Reports and screenshots go to `test-results/full-map-navigation/`.

Also run `full-map-readability-smoke.mjs` for the existing full-campus renderer, map gesture and navigation regressions. The new search row consumes 54px of vertical space; the landscape map size calculation accounts for it.

## Manual checks not established by Node mocks or Chromium CDP composition events

- In a Korean IME, compose a place name. Enter should finish composition before selecting a result; Escape during composition should not close Full Map
- At 360×800 and 844×390, inspect the screenshot with results open, no-match state, a selected POI and visible destination actions. No horizontal overflow, hidden search controls or inaccessible close control
- Use Tab repeatedly through the search field, clear button, results, marker buttons, map controls and dynamic POI actions. Shift+Tab must stay inside too. At zoom limits skip disabled controls
- Open from the minimap, wait at least one frame, then Escape. Focus returns to the visible opener. Reopen and repeat using the close button
- Select 우남호 and 인경호 정자. The marker position comes from existing FACILITIES. Search alone only selects and recenters; it must not start navigation or movement
- Existing guidance targets the nearest existing walkway approach. No new geometry or direct cross-water route to the gazebo was introduced. Actual player movement remains an existing-runtime acceptance concern
- Remove/hide an opener before close or open another panel in the close callback. Do not focus a hidden/detached node or steal the newer panel's focus

Public CI and unit evidence do not establish any of the unexecuted browser checks above.
