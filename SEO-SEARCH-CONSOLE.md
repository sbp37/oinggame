# Search Console indexing notes

## Confirmed GSC issues (2026-09-17)
1. Duplicate without user-selected canonical: `/index.html` and `/?share=v3`
2. Soft 404 junk URL: `/5자` (leave as 404 — correct)

## Fixes on this branch
- Early `<link rel="canonical" href="https://oinggame.com/">` immediately after charset in `index.html` (preferred URL for both `/index.html` and `/?share=*`) — **see commit for index.html**
- Client redirect `/index.html` → `/` (preserves query/hash; skipped in Capacitor)
- Secondary pages: nav links use `/` instead of `index.html` to reduce duplicate discovery
- `404.html`: `noindex,follow` (junk URLs like `/5자` stay 404)
- `favicon.ico` + favicon links (nice-to-have)
- Sitemap already lists `/` only (14 URLs) — OK

## Manual / follow-up
- www SSL still needs DNS / GitHub Pages manual fix
- After merge: GSC → Validate fix for the 3 URLs
- `?share=v3` clears once Google honors canonical (no server-side noindex on GH Pages)
