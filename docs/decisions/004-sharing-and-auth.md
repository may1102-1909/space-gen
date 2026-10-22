# ADR 004: Client sharing and authentication

Status: accepted (2026-10-22)

## Context

T17 lets a designer show a project to a client. SpaceGen has no accounts: the designer side (editor, `/api/projects/*`) is unauthenticated and assumes a trusted localhost. A client must be able to open a design without an account and must never be able to change it.

## Decision

- Accounts and login are out of scope. The designer side stays unauthenticated localhost for now.
- A share link is a bearer capability. `POST /api/projects/{id}/shares` mints `secrets.token_urlsafe(32)` (256 bits) and returns it once. Only its SHA-256 is stored, in `<project>/shares.json`, with an id, label, creation time and revocation time. The token cannot be listed or recovered later; a lost link is revoked and replaced.
- `GET /api/share/{token}` returns a sanitized, read-only projection: name, scan, scene snapshots, variants, viewpoints, hero images (http/https only) and asset refs with product links (http/https only). It omits the project id, edit history (`history` and node `editHistory` metadata), the room interpretation, and URLs into other projects. Project asset URLs are rewritten to `/api/share/{token}/assets/{file}`.
- `GET /api/share/{token}/assets/{file}` serves only content-addressed files (64 hex chars plus a known suffix) resolved inside that project's `assets/` directory. No `/api/share` route accepts a write.
- Revoked, unknown, malformed and orphaned (project deleted) tokens all return the same 404.
- Share responses send `Cache-Control: no-store`, `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`; the `/p/[shareToken]` page sets `robots: noindex` and `referrer: no-referrer`.
- Contracts were extended, not forked: `ProjectManifest.viewpoints` and `heroImages` (optional lists), `AssetRef.productUrl`.

## Risks

- Anyone holding a link can view and forward it; there is no per-viewer identity, expiry or view audit.
- The token is in the URL, so it can land in browser history, screenshots or chat previews. `no-referrer` limits leakage to third parties, not to the person who pasted it.
- Rewritten asset URLs embed the token, so asset requests are bearer URLs too.
- The designer API (create/list/revoke shares, edit, delete) is open to anyone who can reach the backend. Exposing the backend beyond localhost today exposes everything.
- Token lookup scans every project's `shares.json`; fine for a local store, not for thousands of projects. Responses are not rate limited.
- Hero image and product links are designer-supplied external URLs; the viewer only renders http(s) and opens links with `noopener noreferrer nofollow`, but the image host sees the client's IP.

## Next step

Add designer accounts and an auth boundary on `/api/projects/*` before any non-local deployment (the share routes stay token-only). Then: optional link expiry and passcode, a token-hash index in the database `ProjectRepository`, rate limiting on `/api/share/*`, and last-viewed tracking.
