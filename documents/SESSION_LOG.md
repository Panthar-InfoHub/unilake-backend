# Unilake Backend — Session Log

**Rules:** Last 2 sessions in full detail. Older sessions collapsed to one-liners. Anything worth keeping long-term should already be in `PROJECT_CONTEXT.md`, `DECISIONS.md`, or `CURRENT_STATE.md` — the log is for narrative memory, not source of truth.

---

## Session — August 24, 2026 — Full-project analysis, one data-loss bug fixed, three CMS modules built end to end

**Triggered by:** Guts opened with "analyze both the projects completely" and no task. The analysis surfaced a data-loss bug and a frontend gap, which set the rest of the agenda: fix the bug, then design and build the three content modules the marketing site still needed (How It Works, FAQ, Blog). First session that went requirements → schema → plan → implementation → handoff docs in one pass.

### Phase 1 — Analysis of both repos

Read backend and frontend as two independent git repos under one folder. Two findings mattered:

**The frontend post-payment path dead-ends.** `POST /api/user/sessions/:id/send-to-print` and `GET /api/user/orders` are built, irreversible, and **called by nothing** — grepped the whole frontend for `send-to-print`, `sendToPrint` and `api/user/orders`, all zero. There is no variant-selection UI. A customer who pays today cannot finish their order. Nine admin/dashboard pages are 17-line "🚧 Under construction" placeholders, three of them (feedback, customer-reviews, team-members) fronting backends that have been complete for weeks.

**`FRONTEND_HANDOFF.md` is badly stale** — still says checkout, payments, webhooks and orders are unbuilt and the SD worker is a stub. Conversely `PROJECT_CONTEXT.md` §6 claimed both order endpoints were broken by a `coverImageUrl` field that doesn't exist; the code had already been fixed Aug 21 and the doc wasn't updated. Drift in both directions.

### Phase 2 — The team-member bug

Reviewing the three older CMS modules for integration-readiness found a real defect in `updateTeamMember`: it queued the old R2 photo for deletion whenever `imageKey` was present, with **no `oldUrl !== newUrl` comparison**. An edit form that resends every field on save — which is what React Hook Form does by default — would change the job title and silently delete the live photo from R2, leaving the DB row pointing at a 404. No error anywhere.

`page.service.ts` has exactly this guard with a comment explaining why. `teamMember.service.ts` was written without it. Also fixed in the same pass: five optional fields were `.optional()` but not `.nullable()`, making them set-once-forever — no request could clear a LinkedIn URL once set.

### Phase 3 — Schema design for the three new modules

Deliberately front-loaded the questions instead of guessing. Two rounds of structured questions before writing any Prisma, then two more before each implementation plan. The shape that came out:

- **How It Works** started as two tables (section + steps with `sortOrder`), and Guts asked whether it could be one. It could — steps became a `Json` array on a singleton row. That collapse removed 4 endpoints, a cascade, a reorder route, and the "which section is live" question, and it matches the existing full-array-PATCH rule for `Comic.coverThumbnailUrls`.
- **FAQ** clarified to two *global* lists, not per-comic. `Faq` has no relation to `Comic` at all.
- **Blog** landed on HTML body from a rich-text editor, auto-generated frozen slug, `isActive` rather than a status enum, and `tags String[]` (Guts overrode the earlier `category` answer, citing SEO).

Guts asked directly whether the admin would have to write HTML by hand — answered no, explained the WYSIWYG → `getHTML()` → stored-HTML → sanitize-on-render flow, plus the three traps: base64-inlined images, Tailwind preflight flattening the article, and sanitize-on-render vs on-write.

### Phase 4 — Implementation, three modules

Each module: plan → questions → approval → implement → typecheck → smoke test. All 20 endpoints built, `tsc --noEmit` clean throughout.

### Decisions locked

Full detail in `DECISIONS.md` under the Aug 24 entries. The load-bearing ones:

**Every asset-replace path needs an `oldUrl !== newUrl` guard.** Generalized from the team-member bug and applied to How It Works (video + poster) and Blog (cover) as they were written.

**`.optional()` without `.nullable()` on a nullable column is a bug, not a style choice** — it makes the field unclearable.

**How It Works is a singleton with a JSON steps array**, `isActive` as a plain PATCH field, and backend-enforced public readiness (`isActive && videoUrl && steps.length > 0`).

**FAQ reorder is strict and infers its placement from the rows** — complete list for one placement, inactive rows included.

**Blog slugs are frozen after create**, body stored unsanitized with sanitizing owned by the frontend at render time.

### Work done

**Backend fixes:** `teamMember.service.ts` (old≠new guard, widened `data` signature), `teamMember.schema.ts` (five fields `.nullable()`). Guts applied both, I verified.

**Schema:** three models + `FaqPlacement` enum added to `schema.prisma` by Guts, reviewed by me, migrated as `20260823212030_add_how_it_works_faq_blog`. Purely additive — `CREATE TYPE` + 3 `CREATE TABLE` + 3 indexes, zero `ALTER`.

**New modules (9 new files, 2 edited):** `howItWorks.{schema,service,controller}.ts`, `faq.{schema,service,controller}.ts`, `blog.{schema,service,controller}.ts`, plus routes in `admin.ts` and `public.ts`.

**Docs:** `REVIEWS_TEAM_FEEDBACK_API.md` (755 lines) and `HOWITWORKS_FAQ_BLOG_API.md` (755 lines) — frontend handoffs for all six CMS modules.

### Tasks added

- Apidog pass on all 20 new endpoints — nothing beyond typecheck and unauthenticated smoke tests has run.
- Decide whether the How It Works section needs an editable headline (`title`/`subtitle` columns — cheap now, migration later).
- Decide whether Hindi blog content is planned; slugs currently strip all non-Latin characters and fall back to `post`.
- Blog `tags` are not deduplicated — one-line `.transform` if wanted.
- The stale `FRONTEND_HANDOFF.md` needs rewriting or deleting.

### Mistakes caught mid-session

- **I specified `z.coerce.boolean()` in my own Blog plan.** Caught it while implementing: `Boolean("false")` is `true`, so `?isActive=false` would have returned published posts when asked for drafts — silently wrong, and no typecheck would catch it. Replaced with an enum + transform.
- **Twice I saw a `500` and nearly attributed it to the code I had just written.** Both times it was the first DB query in a freshly started process failing with an empty `ErrorEvent` from the Neon serverless WS adapter. Proved it by calling the service function directly (worked), then re-hitting the endpoint warm (worked). The first time I wrongly blamed a `tsx watch` reload race; the second investigation produced the better explanation and corrected the first.
- **Started a dev server without checking whether one was already running** — got `EADDRINUSE` on 8080. Tested against the existing one instead, which was the right call anyway.
- **Left a claim in an early analysis that both order endpoints were broken**, taken from `PROJECT_CONTEXT.md` rather than the code. Checked `order.service.ts` directly and found it already fixed. The doc was stale, not the code — corrected in the same message.

### What is explicitly not done

None of the 20 new endpoints has been exercised with an admin session. The team-member bug fix has not been runtime-verified either — the repro (`PATCH` with an unchanged `imageKey`, then reload the image) needs Apidog plus an R2 check. Everything from the Aug 22 not-done list still stands: the paid half of the pipeline has never run, and no real payment has completed end to end.

---

## Session — August 22, 2026 — Production deployment + three payment-path bugs, one of them found in live logs

**Triggered by:** Guts opened with "analyze both folders" and no specific task. It became three connected phases: (1) confirm the backend was ready for the frontend to open the Razorpay modal, (2) go live on Render + Vercel, (3) debug why the webhook wasn't working in production. First session where a bug was diagnosed from real production logs rather than by reading code.

### Phase 1 — Readiness check, and the first bug

Question was narrow: is the backend complete for *open modal → pay → watch paid pages generate*? Answer was yes, with one blocker.

**The checkout re-call dead end.** `initiateCheckout` validated status (`PREVIEW_READY`) *before* checking for an existing `Order` — but the function itself flips the session to `AWAITING_PAYMENT`. So on any second call the status guard rejected first and the reuse branch was unreachable dead code. Anyone who closed the Razorpay modal without paying was 409'd forever, and the Aug 21 post-payment field lock also froze `coverType`, so they couldn't restart either.

Guts asked for the reasoning before the fix, twice, and specifically asked whether removing the `@unique` on `Order.orderSessionId` would help — it wouldn't, and working through *why* was useful: `OrderSession.status` is the payment state machine and has exactly one slot, so two live orders per session is structurally impossible regardless of the constraint. Fixed by hoisting the Order check above the status guard.

### Phase 2 — Production deployment

Backend → Render, frontend → Vercel, both on subdomains of `unilakekids.com`. Guts had already bought the domain and mapped both before asking for the checklist, which made the cookie strategy question moot in the best way — same registrable domain means first-party cookies and no Brave/Safari problem.

Two things caught during the sweep that would have broken login silently:

- **Better Auth prefixes its cookie with `__Secure-` when `baseURL` is https.** Verified in `node_modules/better-auth/dist/cookies/index.mjs` rather than assumed. The frontend's `proxy.ts` hardcoded the unprefixed name, so every protected route would have bounced a logged-in user to `/login`.
- **`next.config.ts` fallback still pointed at the dead Cloud Run URL**, so a missing env var at build time would have silently proxied auth to a stale service.

`documents/production.md` was rewritten from a three-line stub into an 11-step runbook with real domains, a symptom→cause troubleshooting table, and a note that `NEXT_PUBLIC_*` is baked at build time so Vercel needs a redeploy, not a restart.

### Phase 3 — Two bugs found in production

**The expiry bug.** Guts hit "session expired" clicking Pay on a session that was minutes old. The `checkout.service.ts` private copy of `assertNotExpired` was missing one line — `if (session.expiresAt >= new Date()) return;` — so it never checked expiry at all and flipped *every* non-exempt session to `FAILED`. The proof was in the sequence: the address PATCH seconds earlier went through `session.service.ts`'s correct copy and passed. Two functions with the same name, checking different things, on the same session, seconds apart.

Fixed by deletion rather than by patching the missing line. `PROJECT_CONTEXT.md` had recorded the duplication as deliberate — *"leave until a third caller appears"* — which optimised for the wrong risk: the copies drifted long before a third caller showed up, and nothing typechecks divergent copies against each other.

**The webhook dedupe collision.** Payment succeeded, session stuck at `AWAITING_PAYMENT`. Predicted from the code and the "15 events" subscription in the Razorpay dashboard, then confirmed exactly from Render logs:

```
payment.authorized → eventId pay_TSrandEpXquomL → "Razorpay webhook event ignored"
payment.captured   → eventId pay_TSrandEpXquomL → "Duplicate ... skipping"
order.paid         → eventId pay_TSrandEpXquomL → "Duplicate ... skipping"
```

`WebhookEvent.eventId` was the Razorpay *payment* id, but all three event types carry the same one. `payment.authorized` arrived 671 ms first, claimed the unique key, and `payment.captured` — the only state-changing event — was discarded. The logs also ruled out everything else: 200s in 22–39 ms, no signature failures, service awake. The fix was already sitting in the request headers as `x-razorpay-event-id`, unique per event and stable across retries.

### Decisions locked

Full detail in `DECISIONS.md` under the Aug 22 entries. The load-bearing ones:

**Webhook idempotency keys on `x-razorpay-event-id`, never the payment id.** Fallback is `` `${eventType}:${entityId}` `` so the collision can't return if the header is ever absent.

**`assertNotExpired` has exactly one copy, exported from `session.service.ts`.** Duplication-by-convention is now an explicit never-do.

**The existing-Order check sits above the status guard in `initiateCheckout`**, which makes the invariant structural: no Order row ⇒ the session must still be `PREVIEW_READY`.

**Checkout retries return the `Order`'s snapshotted amount**, never a fresh `PricingRule` lookup — a repriced amount disagrees with the Razorpay order and the gateway rejects it.

**Hosting is subdomains of one owned domain, single instance, on a host that doesn't suspend idle instances.** All three are consequences of in-process workers + in-memory WS rooms.

### Work done

**Backend:** `checkout.service.ts` (guard reorder, null-`razorpayOrderId` guard, self-heal flip, `assertNotExpired` import), `session.service.ts` (exported `assertNotExpired`), `webhook.controller.ts` + `webhook.service.ts` (event-id header), `schema.prisma` (corrected `eventId` comment — no migration), `app.ts` + `auth.ts` (production origins, cross-subdomain cookies — applied by Guts).

**Frontend (separate repo):** audited the full checkout implementation Guts had built and found seven issues; fixed the three blocking ones — a `useEffect` feedback loop that turned the 2-second payment poll into a request storm burning 90 seconds of budget in ~5; a relative `fetch()` resolving to the Next server instead of the API, which left Pay Now permanently disabled for first-time users; and `redirect()` inside a `try/catch` that swallowed every `NEXT_REDIRECT` and sent users home. Also `proxy.ts` and `next.config.ts` (applied by Guts).

**Docs:** `production.md` rewritten twice — first as a URL-change checklist, then as the step-by-step runbook once the domains were mapped. New `frontend/api documentation/CHECKOUT_PAYMENT_API.md` (16 parts) covering checkout → Razorpay → verifying overlay → paid generation → stubbed send-to-print, with a full address-book section added on request.

### Tasks added

- End-to-end payment verification is now priority 1, ahead of Shiprocket — the fix is deployed but a capture has never completed successfully.
- Rotate `RAZORPAY_WEBHOOK_SECRET` (exposed in a screenshot this session).
- Confirm `NODE_ENV=production` on Render and check the live cookie domain shows `.unilakekids.com`.
- Confirm whether the Render instance is paid — free tier kills the workers and sweeper.
- Four frontend bugs left open: regeneration cap still shows 3 post-payment, no post-login auto-resume, order summary prices off the browsing country instead of `shippingCountry`, and `isPaid` counts `AWAITING_PAYMENT` as paid.

### Mistakes caught mid-session

- **First typecheck of `checkout.service.ts` was meaningless.** `tsc` bailed on TS5112 (config present but files named on the command line) before checking anything, and I initially read the empty output as "0 errors." Caught it by re-running with `-p tsconfig.json` and confirming 121 files were actually compiled. Empty output is not the same as a clean pass.
- **A stray `.` appeared in `CheckoutPage.tsx` between my read and my edit** — the file had changed on disk. The Edit tool's mismatch caught it; re-reading showed a syntax error that would have failed the build. Re-read before editing when a tool reports the file moved under you.
- **Nearly asserted that Cloudflare was proxying `api.unilakekids.com`** based on `cf-ray` headers in the logs. Render fronts its own infra with Cloudflare, so those headers prove nothing about Guts's zone. Downgraded to "check whether" rather than stating it.
- **Guts's "webhook verification is not working" framing was wrong and worth correcting.** Verification was working perfectly — 200s, no signature failures. The failure was one layer deeper, in the idempotency gate. Accepting the framing would have sent us hunting the secret.

### What is explicitly not done

The paid half of the pipeline has still never run: `enqueuePaidGenerationJobs` → worker → RunPod, `maybeMarkPaidReady`, `session:paid-ready` over `wss://` through Cloudflare → Render. Send-to-print, PDF compilation and the stub Shiprocket flip are all unverified. The next session should start by completing one real test payment end to end before building anything new.

---

## Older sessions (collapsed)

- **August 21, 2026** — Five-bug sprint + three features shipped. Closed Bugs 1–4 and 6 from Aug 19 (paid-session expiry exemption via `EXPIRY_EXEMPT_STATUSES`; `coverImageUrl` → `coverThumbnailUrls`; stranded-`PAID` fixed by re-throwing so Razorpay retries, deleting the `WebhookEvent` row first; `checkoutParamsSchema` wired; 12-field post-payment PATCH lock). Deferred Bug 5 (rate limiting) and Bug 7 (Country toggle). Built `maybeMarkPaidReady` + `session:paid-ready`, the send-to-print endpoint (all-pages selection, in-flight rejection, idempotent retry), and PDF compilation via pdf-lib with a stub Shiprocket worker. Locked: post-`CONFIRMED` state machine with explicit `PDF_FAILED`/`SHIPMENT_FAILED` branches; PDF pages sized to source images; PDF in the public bucket for permanent re-download; PNG→JPEG@85 before embedding. Nothing runtime-verified — typecheck + boot only, by explicit policy.
- **August 19, 2026** — Checkout + Razorpay + customer order endpoints built in one day (`razorpay.ts` singleton, `toSmallestUnit`, `verifyWebhookSignature`, `initiateCheckout`, the webhook handler, `enqueuePaidGenerationJobs`, `GET /orders`). Locked: selection is a single batch commit at send-to-print (no per-page select endpoint); `OrderStatus` rewritten to 9 values; customer-facing status derived via `toPublicStatus()`; Order row created at checkout initiation; webhook-only with no client-side verify; currency-agnostic amounts; no refunds; country matching deliberately unenforced. A doc-sync pass afterwards read the source against the session's own report and found three defects it had claimed as done — `coverImageUrl` (nonexistent field) breaking both order endpoints, the "no expiry after payment" decision never implemented, and the stranded-`PAID` recovery path referencing a `REGENERATABLE_STATUSES` entry that didn't exist. All three plus two smaller findings were fixed Aug 21 as Bugs 1–4 and 6. The standing recommendation — do one real ngrok test payment before layering more on top — was overruled that session and, in hindsight, would have caught the Aug 22 webhook dedupe collision three days earlier.
- **August 15, 2026** — P1 fix verification found two defects in the fixes themselves. `FAILED` sessions couldn't recover because `regeneratePage` never reset session status back to `GENERATING_PREVIEW` — fixed by flipping BEFORE enqueue (the deliberate exception to the flip-after rule). `distinct: ["pageId"]` in the terminal-state query was nondeterministic — could read a FAILED row for a page that succeeded on retry. Fixed by loading all terminal rows and reducing into two Sets. Eight fixes confirmed correct; 1.1 (CI/CD) reported resolved but unverified. Full doc sync across all four docs. `CODE_VS_DOCS_AUDIT.md` frozen at Aug 11.
- **August 11, 2026** — Full codebase audit against the four docs, then doc sync. No application code changed — documentation work only. Produced `documents/CODE_VS_DOCS_AUDIT.md` — 125 numbered findings (P1 13 / P2 40 / P3 72). Found undocumented features (whole `displayImageUrl`, page reordering, re-entrant preview enqueue, `GET /api/public/countries`, `deleteComic` sweeping page assets). Introduced the `⚠️ CONTRADICTORY (Aug 11 audit)` marker convention. Four loose ends closed by inspection.
- **August 7, 2026** — Part E complete: full SD worker orchestration + supporting fixes + end-to-end verification against real RunPod. Photo cache with refcount + Promise memoization built. `isPreviewPage: true` filter replaced `pageNumber <= freePreviewPages` throughout. BullMQ priority formula compressed to fit 21-bit ceiling. Session status flip moved to AFTER enqueue succeeds. `hasFace` fork added — non-face pages skip RunPod. `GET /sessions/:id` redesigned to nested `pages[].variants[]`. JPEG q88 for RunPod payload / PNG for R2 storage. BigInt serialization patched globally. Photo endpoint renamed `.../validate` → `.../confirm`.
- **August 3, 2026** — SD worker Parts A–D complete, Part D live-tested against real RunPod. Polling over webhook locked (rejected `/runsync`). Round-robin priority formula shipped. Concurrency bumped to 5 to match RunPod. `Page.pagePrompt` became required at Zod layer. Worker file renamed `sdWorker.ts` → `generationWorker.ts`. A40 GPU tier confirmed stable; RTX 4090 in US-NC-1 had driver heterogeneity. Sharp text stamping design locked (SVG-per-bubble, base64 font embedding, decrement-by-1 auto-shrink).
- **July 29, 2026** — Frontend integration guide + public page assets + normalized bubble coordinates. Page artwork + masks moved to public bucket. Bubble geometry became normalized 0–1 fractions. `Page.artworkWidth`/`artworkHeight` Sharp-probed server-side. `fontSize` became `Float @default(0.02)` fraction of artwork height. Wrote `FRONTEND_COMIC_INTEGRATION.md`. `react-konva` recommended for bubble mapper. Publish gate stays 2-check.
- **July 28, 2026** — Multi-thumbnail feature (schema, batch upload endpoint, full-array PATCH pattern) + single-LoRA lock-in (client-confirmed baked in Docker) + base64-everything transport architecture confirmed. Publish flow stays synchronous DB flip; async ComfyUI asset sync worker deleted from NEXT list.
- **July 26, 2026** — Client-account ComfyUI endpoint deployed end-to-end on RunPod; four sequential build failures diagnosed. Added per-page `steps`/`cfg` tunables with bounds constants in `src/config/generation.ts`. Rule locked: never propose a Dockerfile fix from a RunPod status error without reading container logs.
- **July 25, 2026** — Product simplification pass: HD pipeline removed, Sharp text stamping order reversed to FIRST, variant caps changed to payment-based. Schema fields renamed. Deep bug audit found 3 latent bugs. HD code commented not deleted.
- **July 24, 2026** — Frontend-impact bug audit, response-envelope standardization (`sendSuccess()` across all 13 controllers), comic thumbnail R2 cleanup on update, authored `FRONTEND_HANDOFF.md`.
- **July 21, 2026 (afternoon/evening)** — ComfyUI/RunPod deployment via comfy.getrunpod.io: face-swap workflow processed, GitHub repo pushed, Docker "Ready". Locked decisions: api-workflow.json as backend template, filename-match invariant, cold-start mitigation.
- **July 21 (morning)** — Schema migration (CoverType, OrderSession/Order fields, SavedAddress), `requireLoggedIn`/`attach-user` built, full CRUD completion, CORS `PATCH` fix, admin route reorg.
- **July 13** — Deployment planning (Cloud Run asia-south1, GitHub Actions CI/CD), customer-auth introduction via Better Auth, cover type pricing dimension, `OrderSession.userId` nullable FK, `SavedAddress` design, Docker rewrite ~250MB.
- **July 10** — CMS features (Theme, HeroImage, CustomerReview, TeamMember, Feedback, AnnouncementBar), Comic CRUD expansion, Docker setup complete, ~40+ new endpoints.
- **Days 1–3** — Core scaffold: Express/TypeScript/ESM, Prisma+Neon, two-bucket R2, Redis/BullMQ, Better Auth, Country and Comic base CRUD, public catalogue, `OrderSession` create/update/get, authenticated WebSocket.
- **Day 4 Block 1** — Generate-trigger + per-page regenerate endpoints. `PageVersion` schema fix.
- **Day 4 Block 2** — Page/Bubble/Font admin CRUD, unified comic update, LoRA upload. Double-validation cleanup (later found incomplete).
- **Day 4 Block 3** — Real Python photo validation, later moved to frontend.