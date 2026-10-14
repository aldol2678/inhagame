# Integrated portal SEO + PWA A1

Base: `d67b1ba2b1fab882b0136dd22c5a36c4f92661ba` (portal #412).

## Scope

- Six existing public documents (`/`, `/campus/`, `/support.html`, `/privacy.html`, `/terms.html`, `/updates.html`) get unique titles/descriptions, absolute self-canonicals, matching Open Graph metadata and a Twitter summary card. The homepage restores the same title after hash-panel navigation.
- Homepage `WebSite` JSON-LD identifies INHA WORLD / 인하월드, not the university or an officially operated university service.
- The existing public 512px icon is a **summary-card app icon, not a gameplay screenshot**. No new mascot artwork or rights are assumed.
- `robots.txt` and `sitemap.xml` enumerate only the existing canonical public documents. No speculative game-detail URLs, user records, query strings or fragment URLs are included. No invented `lastmod` dates.
- Profile, achievements, editor and studio documents use `noindex, follow`; the existing WorldForge alias serves the same noindex studio document. These pages remain crawlable so the directive can be read. Authentication and authorization, not robots metadata, protect private data.
- Account, friends and messages remain hash panels of the same homepage HTTP document. No hash-dependent homepage noindex toggle is introduced. OAuth query URLs retain the clean homepage canonical; no tokens or account data enter metadata.
- PWA A1 shares the existing manifest with the homepage and expands its scope to `/`. Existing identity `/campus/`, launch URL `/campus/?lobby=1`, names, icons and four shortcut destinations are preserved. No service worker, cache, push or extra app identity is added.
- Portal body, game addresses, account/social behavior, policy text and dates, game storage and rendering are outside this change.

## Relationship to existing work

This reimplements the useful metadata, noindex and static-validation ideas from Draft PR #370 on the integrated #412 portal. #370's old portal files must not replace current files wholesale. This candidate does not merge, close or otherwise modify #370 or diagnostic PR #383. CI policies from #360/#379 remain unchanged. Expanded pages, JSON-LD, hub code and PWA changes are allowed to receive normal full/impact CI; no gate is weakened to force a metadata-only fast path.

## Validation and release gates

- Run `node --test apps/world/tests/seo-metadata.test.mjs` plus existing editorial, public-copy and PWA contracts, then the normal required exact-head checks.
- Inspect source HTML and a real browser after initial load, private-panel navigation and return home. Canonical and social URLs remain stable; gameplay entry and four independent game links still work.
- Confirm all six canonical targets return 200 HTML on the production domain. After release, confirm robots text, sitemap XML, manifest JSON and icon MIME types; verify they do not fall back to homepage HTML. Check missing URLs still return 404.
- Confirm production serves the approved commit and metadata, not merely that GitHub checks are green.
- Existing install identity continuity across browser/OS versions and physical-device upgrades is UNKNOWN until actually tested. Browser emulation and manifest contract tests do not establish it.
- Search Console ownership, Google-selected canonical, actual indexing, query rankings and Core Web Vitals field results are UNKNOWN without direct observation. Search-ready metadata does not prove indexing or ranking.

## Deferred work

- Five substantive game-description landing pages with real text, verified screenshots and links to the unchanged play destinations.
- PWA A2 changing the installed launch URL to `/`, only after existing-install to update behavior is verified on physical devices. A1 preserves the launch URL deliberately.
- New app-only account paths, service worker/offline caching, push, Search Console configuration, external-domain redirects and legal-policy changes.

## References

- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/appearance/site-names
- https://github.com/aldol2678/inhagame/pull/370
