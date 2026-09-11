# CURRENT STATE

_Last updated: Sep 11, 2026 (font shaping crash fixed; text truncation traced to bubble sizing)_

> **Next Claude reading this:** Also attached — PROJECT_CONTEXT.md (architecture), DECISIONS.md (locked rules + never-do), SESSION_LOG.md (recent narrative), schema.prisma. This doc = "where are we right now." Read all four before responding.

## Status: DEPLOYED. Preview generation now works end to end with a real font and a real photo — verified Sep 11 with a complete cover. Shiprocket still built-but-unverified, blocked on client GST.

## DONE

### Live in production (since Aug 22)
- Backend on Render at `api.unilakekids.com`, frontend on Vercel at `www.unilakekids.com`
- Cookies first-party via `crossSubDomainCookies` on `.unilakekids.com`
- Full catalogue + CMS CRUD, auth, checkout + Razorpay webhooks, send-to-print, PDF compile, Shiprocket client/worker/webhook, user order endpoints

### Sep 9–11 — font rendering
- **opentype.js patched** (`patches/opentype.js+2.0.0.patch`, via `patch-package` + `postinstall`) — unsupported GSUB lookups are skipped, not thrown. Calistoga now shapes cleanly; `unshapedFonts: []` confirmed in production logs.
- **Dockerfile** now `COPY patches ./patches` before `npm ci` (without this the patch silently does not apply in prod).
- **Fallback per-glyph renderer** added to `textStamp.ts` (`layoutUnshaped`, `detectShapingSupport`, `LoadedFont.canShape`). Geometry verified identical to the shaped path (0.000px delta across 3 fonts). **Now dead code** — the patch means `canShape` is always true.
- **`Bubble layout resolved` log** (info level) in `stampTextOnPage` — dumps text, artwork dims, normalized bubble, box px, chosen font size, `fitted`, `overflowPx`. Plus a `fitted` flag on `FittedText`.
- **Name truncation resolved** — cause was the bubble box being too small for the text; the SVG canvas is the box, so the excess was clipped away silently. Admin widened the box; log now shows `boxWidthPx: 788 / measuredWidthPx: 327 / overflowPx: -461`. Long names verified to auto-shrink correctly (13–20 chars → 111px/97px/75px, all fitting).

### Sep 11 — frontend preloader
- `ComicPreloader` rewritten: 55 s, single linear CSS keyframe (`preloader-fill` in `globals.css`), `onComplete` behind a ref, interval + `Math.random()` jitter deleted.
- Two bugs fixed: random offset re-rolled per tick (bar moved backwards), and `[onComplete]` deps restarting the timer on every parent re-render (bar reset toward zero).
- Preview page: `preloaderInterrupted` dismisses the preloader immediately on expired / no-preview-pages / FAILED / no-snapshot, instead of stalling 55 s before showing the error.
- Verified: `tsc` clean, `eslint` clean on changed files, `next build` passes, keyframe present in the production CSS bundle.

## IN PROGRESS
Nothing.

## NEXT (priority order)

1. **Runtime-verify the preloader in a browser (~15 min).** Code and build verified; never actually watched. Confirm the bar sweeps smoothly for ~55 s, keeps advancing while TanStack polls fire (the regression test for the restart bug), and that an expired session errors immediately.
2. **🔴 Rotate `RAZORPAY_WEBHOOK_SECRET` and the Redis Cloud password (~30 min).** Outstanding since Aug 22 / Aug 24. Both were exposed.
3. **No-clip fix for `buildBubbleSvg` (~2–3 h).** Size the SVG canvas to the painted text and shift the composite offset, clamped to page edges, so overflow spills visibly instead of being silently amputated. Designed, deferred by decision.
4. **Frontend failed-page state (~1–2 h).** `PreviewPageCard.tsx:59` treats every non-`SD_READY` status as "generating", so a FAILED page shows an infinite spinner. `errorMessage` is in the type and rendered nowhere.
5. **Delete the dead fallback renderer in `textStamp.ts` (~30 min).** Unreachable with the patch in place; an untested second render path is how this class of bug survives. Do only after the patch has run in production for a while.
6. **Upload-time font render validation (~3–4 h).** Test-render a sample string on upload; reject or flag fonts whose ink disagrees with their metrics. Converts a bad printed book into an admin-panel error.
7. **Section 6 — user tracking endpoint (~30 min–1 h).** `GET /api/user/orders/:orderId/tracking`.
8. **Section 7 — admin order endpoints (~4–6 h).** List, detail, confirm-dimensions (triggers Phase B), retry-shiprocket, cancel, print-label, refresh-tracking, SHIPROCKET_FAILED queue. **Without these nothing can actually ship.**
9. **Frontend variant-selection + send-to-print UI (~4–6 h).** Backend endpoint exists; there is no UI, so a paying customer still cannot finish an order. Both orders pages are 17-line "coming soon" stubs.
10. **Section 8 — Zod validators for Sections 6 & 7 (~1–2 h).**
11. **Paid-page generation first run (~1–2 h).** Never executed.
12. **Section 9 — Shiprocket E2E in sandbox (~2–3 h).** Blocked on client GST.
13. **Rate limiting (~1–2 h).** Nothing throttles `/checkout`, session creation, or `POST /feedbacks`.
14. **Add `PAID` to `REGENERATABLE_STATUSES` or give the webhook enqueue a real recovery path (~1 h).**
15. **Lower `Bubble layout resolved` to `debug` (~5 min).** Once bubble geometry is no longer under investigation.
16. **Trim idle worker polling (~30 min).** `drainDelay` 5s→60s, `stalledInterval` 30s→300s.

## OPEN QUESTIONS

- **Why did `fitTextToBox` not shrink during the original truncation?** Never explained. With a correct font it shrinks; with Calistoga it rendered at full size and got clipped. The old bubble row was overwritten when the box was resized, so the evidence is gone. Working now — but "working" ≠ "understood", and it could recur.
- **Client GST status?** Still blocks Shiprocket pickup activation → blocks all Sections 9–10 runtime testing.
- **International shipping in launch scope, or Phase 2?** Not built. ~6–10 h additive; needs client IEC + AD Code (3–6 weeks of paperwork).
- **Is the Render instance paid or free?** Unanswered since Aug 22. Free spins down after ~15 min, taking workers + sweeper with it.
- **Font upload validator: reject WOFF2?** Renderer still cannot parse it; currently fails at generation time.
- **Hindi blog content?** Slugs strip non-Latin, fall back to `post`, `post-2`.

## VERIFY / LOOSE ENDS

### 🔴 Immediate
- **`RAZORPAY_WEBHOOK_SECRET` needs rotating** — exposed in a screenshot Aug 22.
- **Redis Cloud password needs rotating** — full `REDIS_URL` with credentials pasted into a chat transcript Aug 24. Update `.env` **and** Render.
- **Both repos have uncommitted work** — this session's `textStamp.ts`, `patches/`, `Dockerfile`, `package.json` (backend) and `ComicPreloader.tsx`, `globals.css`, preview page (frontend).
- **Confirm `NODE_ENV=production` on Render.** `crossSubDomainCookies` and secure cookies both gate on it. Note the Sep 11 logs were pretty-printed, i.e. **not** production mode — worth checking what that box is actually set to.
- **Verify the patch is live in the deployed image**, not just locally. Tell-tale: no `Font cannot be shaped by opentype.js` warning and `unshapedFonts: []`.

### 🔴 Never runtime-verified
- Entire Shiprocket integration end to end (blocked on GST)
- Paid-page generation, `maybeMarkPaidReady`, `session:paid-ready`
- Send-to-print (real and irreversible — do not call casually)
- PDF compilation, PDF worker retry-then-`PDF_FAILED`
- Post-payment field lock, paid session surviving past 24 h
- WebSocket over `wss://` through Cloudflare → Render
- All 20 CMS endpoints with an admin session
- The new preloader in a real browser

### 🟡 Known open items (deferred, not forgotten)
- **`buildBubbleSvg` clips silently.** The single most dangerous remaining behaviour — a printed book can lose characters with no error. See NEXT #3.
- Pre-existing lint errors in `preview/page.tsx:218` (`react/no-unescaped-entities`, "We've"/"You'll").
- `ComicPreloader` shows for 55 s but a single page takes ~110 s through RunPod — users still land on `GENERATING…` placeholders.
- `childNameFromStorage` can be empty → "Generating 's Book".
- `Order.status` transition to `CONFIRMED` is not explicit anywhere.
- PAID recovery gap when Redis is down during `payment.captured`.
- Bubbles with no font assigned FAIL generation rather than rendering blank. Worth an audit query.
- Neon cold-start 500s — first DB query in a fresh process can fail with an empty `ErrorEvent`. Undiagnosed.
- **Helmet ordering** — still runs above the Better Auth handler, reversing a documented decision.
- **`winston`** still in `dependencies`, imported by nothing.
- **No typecheck in CI.** `tsc --noEmit` passes clean on both repos; should be a pipeline step.
- `app.set("trust proxy", 1)` trusts one hop; Cloudflare + Render is arguably two.

## AUDIT REFERENCES
- `CODE_VS_DOCS_AUDIT.md` — frozen Aug 11, 125 items. Not re-audited since.
- `production.md` — go-live runbook, current as of Aug 22.
