# PHONE-MOTION-02 · Standalone smartphone UX prototype

Status: **design/interaction prototype only** (2026-10-15). Not a World runtime feature and not a release or deployment approval.

## Artifact
- [Run standalone HTML prototype](./inha-world-phone-motion-v0.2.html) (download and open in a browser).
- Works without network, credentials, game backend, or external data.
- Intended for mouse/touch UX review. It does not modify accounts, installs, attendance, game currency or progression.

## Interaction contract demonstrated
- App open/close motion; home-page swiping; notifications slide-up/down; contextual map action sheet.
- Home edit: long press; more visible wiggle; blurred wallpaper; drag reordering and dock placement.
- Tap remove badge -> warning/cancel/confirm -> shrinking delete transition; simulated hidden app + library restore.
- Folder create by dwell-and-drop, open/rename/extract; dock-specific unpin/move treatment.
- Empty album and demo photo; notification read vs task completion; reduced-motion option.
- Tap free home space to leave edit mode. All prototype state can be reset locally.

## Why not copy directly into live Phone
The World app currently uses `apps/world/src/phone/smartphone.js`, `phone-shell.js`, `phone-preferences.js`, `phone-app-catalog.js`, and `apps/world/phone.css`. The actual Store/Home installation model is authoritative and is also being modified on PR #418. This mockup has its own in-memory app model, simulated installs, and demo data. Overwriting real Phone with it would bypass app authority, focus/isolation, accessibility, and persistence contracts.

## Production integration acceptance (separate implementation)
1. Adapt motion and edit visuals to actual shell states; preserve the existing app and input ownership lifecycle.
2. Preserve `phone-preferences` Home/Dock/hidden/installed app readback and account scope. Decide folder schema/version compatibility and rollback before introducing folders.
3. Only hide/unpin actual installed shortcuts via the existing allowlisted Phone/Store operations; no real uninstall, deletion of account/game data or privilege changes.
4. Keep navigation + push notification state independent of attendance claims and rewards. Maintain map, photo, daily panels and Store transitions.
5. Add keyboard, touch and motion-reduction QA, across mobile portrait/landscape and desktop. Run exact-head Smartphone and required public CI before any merge.

## Verification and constraints
The interactive v0.2 artifact was exercised in its standalone context in the preceding prototype work. This commit adds **only docs/prototype files**; it does **not** validate real World integration or physical-device behavior. No deployment, SQL, CI relaxation, secrets, or gameplay changes.
