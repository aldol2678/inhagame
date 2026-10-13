# PHONE-NOTI-01A · INHA WORLD smartphone notification center

Status: implemented on Draft PR for review; **not merged/deployed**. Scope is an in-game read-only status summary, not Web Push nor a server historical inbox.

## Authority and integration
- Existing `Phone Shell` owns app navigation, Home/Dock preferences and World InputFocus; `notifications` is a single new appId automatically migrated into spare slots.
- Existing Hub Messages client owns unread counts and actual message read state. The center displays the aggregate count, links to the existing Messages app, and **cannot mark server messages read**.
- Attendance and Daily Quiz clients own account-scoped READY snapshots and **server-supplied** `rewardDate`. Only today's unclaimed attendance and available/active quiz appear. Center never calls claim/start/answer or an RPC.
- Local per-account `seen` and category mutes are **display preferences only**, not an audit trail, server records or cross-device sync. No fabricated historical notifications, read receipts, rewards, times, subscriptions or OS badges.
- Filtering: All, Messages, Today's tasks. Clicking an actionable card marks only its own local seen flag and opens the existing app. Mark-all locally clears daily cards; actual message unread counts persist until read via Messages.
- On sign-out/account switch, clear current memory immediately, show nothing from stale client snapshots, and load only the new account's local preferences. Readback/storage failures show a warning without claiming save success.
- No Service Worker, VAPID, Push API, new Supabase tables, schema migrations or autonomous jobs.

## QA and release gates
- Run `node --test apps/world/tests/phone-notification-center.test.mjs apps/world/tests/phone-preferences.test.mjs` and the required scoped World checks. Do not repeatedly trigger CI.
- Account A↔B and sign-out, async stale client state, server KST date rollover, badge count, daily claim/quiz noninterference, messages readback, local storage disabled, Phone Home/Back/World navigation, mobile 360px touch and Safe Area.
- Browser/real device QA is required before merge. The user's prior successful **PWA installation R1** does not validate this new app.
- A future NOTI-01B server history or NOTI-02 real push requires a separately approved contract and subscription/abuse guards.

Reference: [PWA/noti Roadmap](https://app.notion.com/p/3f827155213b8112b0c1e7d3edec811b) and [Smartphone Canonical](https://app.notion.com/p/3f227155213b8145a2cdd19833e7d62f).
