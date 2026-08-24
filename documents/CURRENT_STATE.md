# CURRENT STATE

_Last updated: Aug 24, 2026 (end of session)_

> **Next Claude reading this:** Also attached — PROJECT_CONTEXT.md (architecture), DECISIONS.md (locked rules + never-do), SESSION_LOG.md (recent narrative), schema.prisma. This doc = "where are we right now." Read all four before responding.

## Status: DEPLOYED. Payment path fixed but still never completed end-to-end. Three new CMS modules built this session, none runtime-tested.

## DONE

### Live in production (since Aug 22)
- Backend on Render at `https://api.unilakekids.com`, frontend on Vercel at `https://www.unilakekids.com`
- Cookies first-party via `crossSubDomainCookies` on `.unilakekids.com`
- Checkout re-call dead end, `assertNotExpired` duplicate, and webhook dedupe collision all fixed and deployed

### Built this session (Aug 24) — code-complete, typecheck clean, NOT runtime-tested
- **Team member bug fix** — `updateTeamMember` was deleting the live R2 photo when an edit form resent an unchanged `imageKey`. Added the `oldUrl !== newUrl` guard.
- **Team member nullable fields** — `description`, `imageKey`, and the three social URLs are now `.nullable()`, so they can actually be cleared. Previously set-once-forever.
- **Migration `20260823212030_add_how_it_works_faq_blog`** — applied to Neon, purely additive (`CREATE TYPE` + 3 `CREATE TABLE`, zero `ALTER`).
- **How It Works module** — 4 endpoints. Singleton row, JSON `steps` array, video+poster upload, backend-enforced readiness rule.
- **FAQ module** — 7 endpoints. Two global sets via `placement`, strict reorder, plain-text answers.
- **Blog module** — 9 endpoints. Auto-generated frozen slug, HTML body, cover image, tags, draft-by-default.

### Docs written this session
- `REVIEWS_TEAM_FEEDBACK_API.md` — frontend handoff for the three older CMS modules
- `HOWITWORKS_FAQ_BLOG_API.md` — frontend handoff for the three new ones

## IN PROGRESS
Nothing.

## NEXT (priority order)

1. **End-to-end payment verification** (~1 h) — still the top item, unchanged from Aug 22. Fresh session, test card, confirm the log sequence: `payment.authorized` ignored → `Payment captured — Order + Session flipped to PAID` → `Paid-page generation enqueued after payment`. The fix is deployed but a capture has never completed.
2. **Paid-page generation first run** (~1–2 h) — never executed anywhere. Watch RunPod round-trips, `maybeMarkPaidReady`, and `session:paid-ready` over `wss://`.
3. **Apidog pass on the three new CMS modules** (~1–2 h) — all 20 endpoints are unverified beyond typecheck + unauthenticated smoke tests. Sharp cases listed under VERIFY below.
4. **Feature #4 — Real Shiprocket integration** (~10–14 h) — replaces the stub worker. Must flip `Order.status`; the stub never touches it.
5. **Feature #5 — `notifyUser`** (~1–2 h) — three TODO call sites. No email fires anywhere today.
6. **Feature #6 — Admin order endpoints** (~4–6 h) — list, detail, retry Shiprocket, mark shipped, `SHIPROCKET_FAILED` queue.
7. **Feature #7 — Admin catalog endpoints** (~2–3 h) — includes Bug 7 (`Country.isActive` toggle).
8. **Feature #8 — Admin auth hardening** (~2–4 h).
9. **Feature #9 — Rate limiting** (~1–2 h) — Bug 5 lives here. Nothing throttles `/checkout`, session creation, or `POST /feedbacks` in production.
10. **Feature #10 — Structured observability** (~2–3 h).

## OPEN QUESTIONS

- **Is the Render instance paid or free?** Still unanswered from Aug 22. On free, the service spins down after ~15 min idle and takes the BullMQ workers and hourly sweeper with it. Blocks item 2.
- **Does the How It Works section need its own editable headline?** The screenshot was cropped; if the "How It Works" heading above the video should be admin-editable, that's `title`/`subtitle` columns and a migration.
- **Blog slugs strip all non-Latin characters.** A Devanagari title slugifies to empty and falls back to `post`, `post-2`. Does the client plan Hindi blog content? Decide before launch.
- **PDF regeneration for a `PDF_FAILED` session** — how does an admin re-trigger? Still not designed. Deferrable to feature #6/#7.
- **Should the Razorpay subscription stay at 15 events?** Correctness no longer depends on it, but every event writes a `webhook_events` row.

## VERIFY / LOOSE ENDS

### 🔴 Immediate
- **`RAZORPAY_WEBHOOK_SECRET` must be rotated** — still outstanding from Aug 22. Exposed in a screenshot. Change it in Render *and* the Razorpay dashboard, byte-for-byte.
- **Confirm `NODE_ENV=production` on Render.** `crossSubDomainCookies` and `secure` cookies are both gated on it.
- **Live cookie check:** after login, DevTools → Application → Cookies should show `__Secure-better-auth.session_token` on domain `.unilakekids.com` (leading dot).

### 🔴 Never runtime-verified
- Paid-page generation, `maybeMarkPaidReady`, `session:paid-ready`
- Send-to-print (real and irreversible — do not call casually during testing)
- PDF compilation, PDF worker retry-then-`PDF_FAILED`
- Stub Shiprocket flip to `COMPLETED`
- Post-payment field lock (Bug 6, Aug 21)
- Paid session surviving past 24 h (Bug 1, Aug 21)
- WebSocket over `wss://` through Cloudflare → Render

### 🔴 New this session, needs Apidog with an admin session
- **Team member:** `PATCH { imageKey: <the key already stored> }` → image must still load. This is the repro for the bug fixed this session.
- **Team member:** `PATCH { linkedinUrl: null }` → field clears. Previously a 400.
- **How It Works:** save steps with no video → `GET /public/how-it-works` must still return `null`. Then upload video → must appear.
- **How It Works:** re-send the same `videoKey` → video must still play (old≠new guard).
- **FAQ:** create 3 HOME + 2 COMIC → sortOrder must be 0,1,2 and 0,1 independently.
- **FAQ:** `PATCH { placement: "COMIC" }` twice on the same row → `sortOrder` must not move the second time.
- **FAQ:** reorder with a partial list, or with IDs spanning both placements → 400 both times.
- **Blog:** create two posts with the same title → second slug must be `-2`.
- **Blog:** create with title `"!!!"` → slug must fall back to `post`.
- **Blog:** unpublished post fetched by its exact slug → 404, not the draft.
- **Blog:** confirm list endpoints omit `body` and detail endpoints include it.
- **Singleton check:** `SELECT count(*) FROM how_it_works;` → exactly 1 after all of the above.

### 🟡 Known open items (deferred, not forgotten)
- **Neon cold-start 500s** — the first DB query in a freshly started process can fail with an empty `ErrorEvent` from the serverless WS adapter; every subsequent query succeeds. Observed twice this session. Affects whichever endpoint is hit first, not any specific module. Matters on Render after a spin-up. Not diagnosed further.
- **Bug 5** — no rate limiting anywhere, including `/checkout` and the unauthenticated `POST /feedbacks`.
- **Bug 7** — no admin endpoint for `Country.isActive`.
- **Helmet ordering** — `helmet()` still runs above the Better Auth handler, reversing a documented decision. Intent never confirmed.
- **`winston`** still in `dependencies`, imported by nothing.
- **No typecheck in CI.** `tsc --noEmit -p tsconfig.json` passes clean today — it should be a pipeline step, not a manual habit.
- **`app.set("trust proxy", 1)`** trusts one hop; Cloudflare + Render is arguably two. Will matter once rate limiting lands.
- **Blog `tags` are not deduplicated** — `["SEO","seo"]` stores both. One-line `.transform` if wanted.
- **No `.max()` on FAQ `question`/`answer`** or on the older CMS text fields. Frontend is the only length limit.
- Frontend bugs #4–#7 from Aug 22 still open: regeneration cap shows 3 post-payment instead of 8; no post-login auto-resume; order-summary price reads the browsing country rather than `shippingCountry`; `isPaid` counts `AWAITING_PAYMENT` as paid.
- **Frontend has no send-to-print UI and no variant-selection screen.** The backend endpoint is built and irreversible; nothing calls it. A customer who pays today cannot finish their order.

## AUDIT REFERENCES
- `CODE_VS_DOCS_AUDIT.md` — frozen Aug 11, 125 items. Not re-audited since.
- `production.md` — go-live runbook, current as of Aug 22.
- `REVIEWS_TEAM_FEEDBACK_API.md`, `HOWITWORKS_FAQ_BLOG_API.md` — frontend handoffs, current as of Aug 24.
