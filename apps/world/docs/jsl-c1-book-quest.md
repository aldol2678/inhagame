# JSL-C1 · 정석의 첫 도서 탐색 (Draft / NOT DEPLOYED)
Base: main bfa08ad78f92fba51eb1a3978dd97a12182fc82c.
- Reuse the publicly accessible 1F lobby; add one fictional librarian prop and one public-side search kiosk.
- Intro loop: talk to librarian → approach kiosk → search → select Jane Austen book → report. Both props are game adaptations.
- Three titles/authors are a fixed illustrative sample, **not a live library inventory, loan status or shelf coordinates**. Link visitors to the real library's official site.
- Authenticated permanent nonbanned accounts save stages 0–4 through a new account-scoped RPC; anonymous visitors can browse the catalog without quest advancement.
- Server awards **no XP, coins, inventory, relationship, or other value**. Progress itself is not reliable proof of player proximity. Do not use it for compensated rewards until stronger trust is designed and approved.
- Quest Journal reads a side-quest presentation from verified RPC responses; main quests remain untouched. Never reimplement Wallet or the smartphone player-to-player inbox.
- Fail closed on RPC absence/timeout; do not fake progress or allow local fallback awards.
- Reuse current JSL-A server gate. Nothing added inside protected B1, no new access bypass.
- Runtime integration uses existing Context Action and Blocking UI focus. Back/Escape, account swap and room departure close the panel.
- No new workflow. Run targeted Node and disposable pgTAP when local tools are available, then existing required exact-head CI once. Browser, GPU and Production status remain UNKNOWN until separately checked.
- Migration is repository code only. This PR does not authorize applying SQL to Production, merging, changing JSL gate policy or deploying.
