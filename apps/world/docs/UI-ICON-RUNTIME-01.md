# INHA WORLD UI-ICON-RUNTIME-01 · approved P0 SVG integration

This Draft binds the approved 19 original SVGs from PR #307 to the existing interface. **The asset files and original asset-only manifest remain untouched.** The manifest's historical `runtimeIntegrated:false` describes PR #307's original scope, not this unmerged integration candidate.

| Family | Assets | Existing runtime surface |
| --- | --- | --- |
| Smartphone 5 | student-id, map, camera, album, settings | Existing Home/Dock icons (current app ID `maps`) |
| HUD 10 | profile, quest, shop, inventory, mobility, wardrobe, quiz, attendance, friends, chat | Existing World HUD and social buttons |
| Other 4 | collection, help, lock, notification | Inventory collection-title, keyboard help, locked back gate, existing Phone status message |
| Reused | chat, camera, settings etc. | Photo HUD, lobby, optional draft #357's `messages` icon |

Notification is **not** a new inbox, unread system, alert feed, or server feature. The only notification-icon surface is the *already present* Phone status message rendered while nonempty.

A small allowlisted presentation module uses decorative `<img alt="" aria-hidden="true">` elements, retains original emoji as load/error fallback and keeps all button event handlers, IDs, accessible labels, page focus and gameplay state. MutationObserver handles re-renders, including Home/Dock and dynamic HUD labels, without editing `smartphone.js`, `phone.css`, `phone-preferences.js` or `main.js` currently changed by Draft #357.

Scope exclusions: original university CI, reward/permissions/RPC/account logic, new apps and notifications, ACTIVE8 item-icon renderer, asset-file edits, merge, deployment, and production data operations.

Verification contract: source manifest completeness; Node mapping assertions; browser local World (desktop 1280×800, portrait 390×844, landscape 844×390), SVG fetch/load, screenshots, button labels and focus, re-render, image-error fallback. Real-member RPC, real devices and Production deployment are NOT claimed by this local offline acceptance.

## Pointer drag regression guard

The presentation layer marks each image `draggable=false` and makes decorative icon trees pointer-transparent. Phone owns pointer capture, gesture cancellation and persistence; no Phone controller or CSS is changed. Existing main stylesheets retain their relative order, including the commission stylesheet.

The existing icon browser QA now runs an icon-off control and the fixed SVG presentation with real mouse/touch input on all three viewports, verifies unique Dock placement and reload persistence, and repeats fixed Dock moves. A desktop fixture restores only the previous image dragging/hit-testing defaults and requires an actual native `IMG` dragstart, pointercancel and an unchanged Dock. This establishes the cause through an A/B comparison instead of inferring it from source. The existing full Phone browser QA remains unchanged and must also pass at the exact candidate head. Browser results are not claimed until the workflows finish.
