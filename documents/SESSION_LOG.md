# Unilake Backend — Session Log

**Rules:** Last 2 sessions in full detail. Older sessions collapsed to one-liners. Anything worth keeping long-term should already be in `PROJECT_CONTEXT.md`, `DECISIONS.md`, or `CURRENT_STATE.md` — the log is for narrative memory, not source of truth.

---

## Session — August 29, 2026 — Shiprocket integration end to end, sections 1–5 of 10

**Triggered by:** Guts opened with the full-project analysis prompt asking for a stance-check and remaining-work estimate. After confirming the four docs, decided the biggest single unbuilt block was the real Shiprocket integration and started sectioning it out. Ended the session with 5 of 10 sections complete, ~5.5–9 h of unblocked work remaining and the rest gated on the client's GST activating their Shiprocket pickup address.

### Phase 1 — Sectioning the work

Before writing any code, laid out a 50-task, 10-section plan (config → schema → client module → worker → webhook → user endpoint → admin endpoints → validation → testing → cutover). The plan front-loaded questions Guts hadn't asked yet: who owns the Shiprocket account, who owns the pickup address, is manifest generation ours to build, is international in launch scope. Answers: client owns account, single pickup at admin's home, manifest handled by admin from Shiprocket dashboard, international deferred to Phase 2.

The 10-section structure held for the whole session — nothing needed to be re-scoped mid-build.

### Phase 2 — Config, schema, client module (Sections 1–3)

Section 1 was mostly account setup. API user was initially created under Guts's personal email as a placeholder; swapped to a client-owned email later in the session — architecturally free because credentials live only in `.env` + Render. Pickup address registered but stuck in "not active" pending client GST; agreed to continue building and defer only the runtime E2E test.

Section 2 revealed the schema had already anticipated a lot of this work — `shiprocketOrderId`, `awbNumber`, `courierName`, `trackingStatus`, `trackingUpdatedAt`, `isInternational` were already on `Order` from an earlier session, and `OrderStatus` already had `READY_TO_SHIP` with a comment matching the two-stage packaging flow. Cut my proposed 12 fields down to what wasn't already there. Migration added 12 nullable columns and 0 enum changes.

Section 3 was the biggest single code push of the session. Split into 3A (infrastructure — SystemConfig helpers, base fetch wrapper with retry, auth-token lifecycle) and 3B (nine public API functions, one at a time as Guts pasted the docs for each). Built one function per turn: `createOrder`, `updateOrder`, `assignAwb`, `generatePickup`, `generateLabel`, `generateManifest`, `printManifest`, `trackByAwb`, `cancelOrder`. Every function got a private raw response type, public params/result types, structured logs, and typed AppError codes distinguishing transport failures from Shiprocket rejections.

Two Shiprocket API quirks worth remembering: `printManifest` takes `order_ids` while `generateManifest` takes `shipment_id` (a different Shiprocket identifier — this is why we store both `shiprocketOrderId` AND `shiprocketShipmentId` separately on `Order`), and `cancelOrder` returns 204 No Content on success which needed a special-case in the base fetch wrapper.

### Phase 3 — Worker + webhook (Sections 4–5)

Section 4 introduced `src/services/shiprocket.service.ts` as the sole business-logic layer between the raw client and its two callers (worker for Phase A, admin endpoint for Phase B). The worker file itself became a thin wrapper matching `pdfWorker`'s pattern exactly. The two-stage flow — Phase A auto-creates the Shiprocket order with placeholder dimensions immediately after PDF compilation, Phase B pushes real dimensions and generates AWB + pickup after admin packages — was Guts's own idea from Session 3 questioning and turned out to be correct: dimensional weight matters for courier pricing, and hardcoded defaults would cause silent overcharges.

Section 5 built the webhook receiver by cloning the razorpay pattern almost line-for-line. The only real design work was the idempotency key — Shiprocket sends no event ID, so synthesized `shiprocket:${awb}:${current_status_id}:${current_timestamp}` which is stable across their retries and distinct across genuinely new scans. The `WEBHOOK_ALLOWED_TRANSITIONS` table was added to prevent the webhook from overwriting terminal states (DELIVERED cannot be un-delivered by a late status ping).

Real webhook payloads Guts pasted revealed three issues the docs would have missed: `current_status` casing is inconsistent (`"IN TRANSIT"` vs `"Delivered"`), timestamp formats vary between `"yyyy-mm-dd HH:mm:ss"` and `"dd mm yyyy HH:mm:ss"`, and the `scans` array order flips between webhooks. All three handled defensively.

### Phase 4 — Documentation for the two-audience status split

The most productive product conversation of the session was the third from the end. Guts asked whether users should see raw Shiprocket messages. The answer settled: users see mapped `Order.status` only, admins see both mapped status AND raw `trackingStatus` on the list view plus the full webhook payload history on the detail view. Nothing hidden from users — organized by audience. If users ever ask for more detail, exposing `trackingStatus` is a zero-backend-change frontend addition.

### Decisions locked

Full detail in `DECISIONS.md` under the new "Shiprocket integration (added Aug 29)" section. Load-bearing ones:

**Never cache Shiprocket-owned URLs** (labels, manifests). Fetched fresh every time. Shiprocket may rotate storage.

**Manifest generation deferred to Shiprocket dashboard for launch.** Backend functions built as a building block; no admin UI. Revisit if switching contexts becomes friction.

**Users see mapped status only, admins see both mapped and raw.** Fully documented in the new decisions section.

**`WEBHOOK_ALLOWED_TRANSITIONS` gates every status flip.** Webhook can never move status backwards, never overwrite DELIVERED or CANCELLED.

**Auth token cached in `SystemConfig`, not in-memory.** One login per 10 days across all four processes.

**International deferred to Phase 2.** Schema already anticipates; requires 3–6 weeks of client-side paperwork (IEC, AD Code, Shiprocket International activation).

### Work done

**New files:** `src/config/shipping.ts`, `src/lib/systemConfig.ts`, `src/lib/shiprocket.ts`, `src/services/shiprocket.service.ts`.

**Modified files:** `src/config/env.ts` (4 env vars added, boot count 22→26), `src/jobs/workers/shiprocketWorker.ts` (full rewrite from stub), `src/services/webhook.service.ts` (added `handleShiprocketWebhook`), `src/controllers/webhook.controller.ts` (added `shiprocketWebhookHandler`), `src/routes/webhooks.ts` (added route), `schema.prisma` + migration (12 nullable columns on `Order`).

**Not touched:** app.ts (existing raw-body middleware on `/api/webhooks/*` covers the new route), main routes wiring, existing Order enum, other services. Zero breaking changes to existing behavior.

**Nothing committed yet.** Two combined commit messages drafted, one for schema migration and one for the code — Guts planned to commit both after doc updates.

### Tasks added

- Enable webhook toggle in Shiprocket dashboard after Section 5 deploys (currently disabled — endpoint didn't exist when Guts tried to save it earlier).
- Section 6 (user tracking endpoint) — ~30 min – 1 h. Small.
- Section 7 (admin endpoints) — ~4–6 h. Eight endpoints including the Phase B trigger.
- Section 8 (Zod validators + cleanup) — ~1–2 h.
- Section 9 (E2E in Shiprocket sandbox) — ~2–3 h, blocked on GST.
- Section 10 (production cutover) — ~1 h, at launch.
- `notifyUser` call sites are now FIVE, not three — Section 5 added SHIPPED and DELIVERED transitions.
- Consider whether `Order.status → CONFIRMED` should be explicit in send-to-print (currently jumps GENERATED → READY_TO_SHIP; worker accepts both source states).

### Mistakes caught mid-session

- **Wrote a `.ts` extension on the `shipping.ts` import** in `shiprocket.service.ts` instead of `.js` — the project uses NodeNext resolution which requires `.js` extensions in imports even for TS files. Guts caught it on `tsc --noEmit`; one-line fix.
- **Left a dead `const orderDate = ...` line in `createOrder`** after extracting `buildAdhocOrderPayload`. Not flagged by tsc because `noUnusedLocals` isn't enabled. Caught on the final file review Guts requested and cleaned up.
- **Three `session.order` null-narrowing errors** in the worker's failure handler — TypeScript loses null narrowing across `await` in a `$transaction` callback. Fixed by extracting `const orderId = session.order.id;` before the transaction; three references replaced with the local.
- **Doc comment on `generatePickup` referenced "next step is generateManifest"** which stopped being true after Guts locked the "manifest generation deferred to Shiprocket dashboard" decision. Flagged as a small drift, not fixed inline — worth a small edit if it bugs anyone.
- **Suggested skipping `cancelOrder` when Guts noted there's no user-facing cancel**, then walked it back after listing the real admin use cases (wrong address, refund, defect, duplicate, abandoned READY_TO_SHIP). Guts agreed to build.
- **Twice recommended a decision, twice was talked into a better one** — Guts pushed back on caching label URLs (I initially waffled, then landed on "never cache") and on generating manifests via our admin (I initially recommended building the endpoint, Guts made the smaller call of deferring to Shiprocket's own dashboard). Both were the right calls.

### What is explicitly not done

Nothing from Sections 1–5 has been runtime-verified. Auth flow, Shiprocket API calls, worker execution, webhook receipt — none tested against real Shiprocket. `tsc --noEmit` clean and app boots clean, that's it. Full E2E test is Section 9, gated on the client's GST activating their Shiprocket pickup address. Every other verification item from previous sessions (paid-page generation, WebSocket over `wss://`, PDF compilation, glyph-outline renderer against a real font) still stands unresolved.

Sections 6–8 can proceed immediately without blocking on GST.

---

## Session — August 24, 2026 (session 2) — The font bug, glyph-outline rendering, per-bubble colour, and a dead Redis

**Triggered by:** Guts opened with another full-project analysis, then reported the real problem: text stamping "works great in local development but in production it doesn't print anything," and — added almost as an afterthought — the uploaded font was never being used *even locally*. Two screenshots came with it: production showing tofu boxes on the sign, dev showing the name in a plain serif that was obviously not the comic font. Those two images turned out to be the whole diagnosis.

### Phase 1 — The font bug

Both symptoms were **one root cause**, and the afterthought was the more revealing half.

`textStamp.ts` embedded the font into the SVG as an `@font-face` with a base64 data URI. Sharp renders SVG through **librsvg**, which delegates all font resolution to **fontconfig** — it can only use fonts *installed on the machine* and discards embedded webfonts entirely. So the font was faithfully downloaded from R2, base64'd, inlined, and ignored.

That single fact explains both environments: Windows has hundreds of installed fonts so fontconfig substituted an arbitrary one (text appeared, wrong typeface); `node:22-bookworm-slim` ships **zero** fonts so there was nothing to substitute (blank). Neither errored — Sharp treats an unresolvable font as empty output and reports success, which is how blank pages reached `SD_READY` unnoticed.

The logs ruled out the obvious suspect before I proposed anything: `fontsLoaded: 1` in **both** dev and prod, counted after the R2 download. Storage, keys and credentials were all fine. The failure was entirely at the render step, after the bytes were already in memory.

Proved it empirically rather than asserting it — rendered the same string twice on the same machine, once via glyph paths (2,353 dark pixels) and once via the old `@font-face` SVG (1,578 pixels, wrong glyphs, system fallback).

### Phase 2 — Options, and the rewrite

Offered two routes: put the font on disk and register it with fontconfig, or stop using SVG `<text>` and convert glyphs to `<path>` outlines. Guts picked outlines.

`textStamp.ts` rewritten around opentype.js. A `<path>` is pure geometry, so rendering depends on nothing installed on the host — **no Dockerfile change needed**, which was the point.

Real font metrics then fixed three things that had been estimates: wrapping now measures actual advance widths instead of `fontSize * 0.6`; `fitTextToBox` checks **width as well as height**, so a single unbreakable word (a long child's name) shrinks instead of spilling — width had never been checked at all; and vertical centring uses the font's own ascender/descender.

Added fail-loud guards for the three conditions that previously rendered nothing: no font assigned, unparseable font (including WOFF2), and a font missing glyphs for the text. `escapeXml()` was deleted — no user string reaches the SVG any more.

Verified by stubbing R2 via `module.registerHooks` and running the real module: six behavioural checks passed, and a visual crop confirmed correct wrapping, centring and shrink-to-fit.

### Phase 3 — Per-bubble colour

Guts asked about colour *and* weight. Colour was easy. Weight was the interesting answer: **a font file holds exactly one weight**, so a weight slider means either a second uploaded font (already possible, zero code) or synthetic stroke-thickened bold (visibly fake at print resolution). Guts deferred weight to a client conversation and took colour alone.

Four structured questions before planning — picker style, new-bubble default, legibility handling, bulk apply. Answers: free hex only, inherit last colour on the page, warn-don't-block, no bulk apply. Wrote a 12-step plan as an artifact, then implemented it.

The plan's own warning turned out to be the load-bearing part: `validateBody` **replaces** `req.body`, so a field absent from the Zod schema is dropped silently and the save still returns 200. Backend had to ship before frontend or the colour would vanish on reload with nothing in the logs.

Verified with 15 schema cases and a pixel test: `#d92b2b` produced 647 exact-match pixels, and three differently-coloured bubbles on one page kept their colours with **zero** foreign pixels between them.

### Phase 4 — Redis died, then moved providers

Deploy went out; logs filled with `ERR max requests limit exceeded. Limit: 500000, Usage: 500003`.

Not traffic. **Idle worker polling.** The stack trace pointed at `bull:shiprocket:*` — the stub worker that has never processed a real job. Checked the installed BullMQ defaults rather than guessing: `drainDelay: 5` seconds, `stalledInterval: 30000` ms. That's ~20,000 commands/day per idle worker, ~60,000/day across three, which burns Upstash's 500k monthly free tier in about eight days of an empty queue.

**Resolved: migrated to Redis Cloud.** Guts moved `REDIS_URL` off Upstash to a Redis Cloud instance, which bills by memory rather than per command, so the quota-exhaustion mode is gone entirely. Upstash is no longer in use.

One deployment trap on the way: after the local `.env` was switched, **Render's `REDIS_URL` was still pointing at the dead Upstash instance**, so production remained broken while local worked — which presents as "the fix didn't work" rather than "the fix wasn't deployed." Updating the Render env var restored the queues.

### Decisions locked

Full detail in `DECISIONS.md` under the `Aug 24 · s2` entries. The load-bearing ones:

**Never put `@font-face` in an SVG handed to Sharp, and never install fonts into the image to "fix" it** — outlines remove host dependence entirely.

**No fallback font.** Falling back is precisely what hid the outage; a bubble with dialogue and no font now fails the job.

**`Bubble.fontColor` accepts exactly `#rrggbb`** — one canonical form end to end, no shorthand, no alpha, no colour names.

**Colour legibility is advisory, never enforced server-side** — the server cannot see the artwork behind a bubble.

**BullMQ is incompatible with per-command-billed Redis** — moved to Redis Cloud (memory-billed) rather than tuning around Upstash's pricing.

**Every env-var change is two changes** — local `.env` and Render. The Redis switch worked locally while production stayed dead for exactly this reason.

### Work done

**Backend:** `textStamp.ts` rewritten (opentype.js, outlines, real metrics, fail-loud); `config/generation.ts` (`DEFAULT_FONT_COLOR`, `FONT_COLOR_PATTERN`); `bubble.schema.ts` (regex → lowercase → default/optional); `bubble.service.ts` (create + update); `schema.prisma` + migration `20260824023534_added_font_color_in_bubble`. Deps: `opentype.js`, `@types/opentype.js`.

**Frontend (separate repo):** hex picker with draft-revert-on-blur, WCAG low-contrast warning, Konva canvas painting real colour, sample-name substitution on canvas (Short/Long toggle lifted to the page so sidebar and canvas agree), and a fix for the editor panel being clipped. Typecheck, lint and `next build` all clean.

**Also produced:** two combined commit messages, and a 12-step implementation plan published as an artifact.

### Tasks added

- Rotate the Redis Cloud password — the full `REDIS_URL` with credentials was pasted into the chat transcript.
- Check for payments stranded at `PAID` during the outage; `PAID` is still not in `REGENERATABLE_STATUSES`.
- Trim idle worker polling when convenient — no longer urgent on Redis Cloud, but ~60k commands/day of noise remains.
- Runtime-verify the font fix on a real generation — the actual uploaded font has **never once** rendered correctly.
- Audit for existing bubbles with no font assigned; those will now fail generation rather than render blank.
- Decide whether the font upload validator should reject WOFF2 at upload rather than at generation.
- Font weight — pending the client conversation.

### Mistakes caught mid-session

- **My first colour-render test reported three FAILs that were the test's fault.** It sampled the *darkest* pixel, which on antialiased glyphs is an edge pixel, so `#d92b2b` read back as `#d82b2b`. Rewrote it to count exact matches and find the dominant ink instead. Nearly reported a working feature as broken.
- **Put a JSX comment between a ternary's `? (` and its element** while fixing the sidebar clipping. `{/* … */}` there parses as an object literal, not a comment — six syntax errors. Caught on typecheck, moved the comment above the ternary.
- **First `ColorField` implementation used a `useEffect` to resync the hex draft**, which React's linter correctly flagged as cascading renders. Rewrote using adjust-state-during-render plus a `key`, which also fixed an edge case the effect version had (switching between two bubbles sharing a colour kept a stale draft).
- **Verified BullMQ's polling defaults in `node_modules` rather than quoting them from memory** — the whole 60k/day figure rests on those two numbers.
- **Nearly wrote one commit message per repo as asked**, then flagged that both repos contain two unrelated bodies of work and a single commit would make the production font fix unrevertable on its own. Guts chose combined anyway, which is a legitimate call — but it was worth surfacing rather than silently complying.

### What is explicitly not done

The font fix has **not** been exercised on a real generation — everything is verified at unit and pixel level with a stubbed R2 and Arial, never against a real comic font through the real worker. Colour has not been round-tripped through the admin UI. Redis is healthy again on Redis Cloud, so nothing is blocked, but everything from the previous not-done list still stands: the paid half of the pipeline has never run, and no real payment has completed end to end.

---

## Older sessions (collapsed)

- **August 24, 2026 (session 1)** — Full-project analysis surfacing a data-loss bug in `updateTeamMember` (no `oldUrl !== newUrl` guard, would silently delete R2 photos on re-save; five schema fields `.optional()` but not `.nullable()`). Then designed and built three CMS modules end to end (How It Works, FAQ, Blog — 20 endpoints total, migration `20260823212030`) with front-loaded structured questioning before schema and again before implementation. How It Works collapsed to a singleton with a JSON steps array (Guts's own simplification), FAQ scoped to global not per-comic, Blog with frozen slugs and HTML body from a rich-text editor. Decisions locked: every asset-replace path needs old≠new guard; `.optional()` without `.nullable()` on nullable columns is a bug not a style choice; frontend owns HTML sanitization on render. Authored `REVIEWS_TEAM_FEEDBACK_API.md` and `HOWITWORKS_FAQ_BLOG_API.md`. Nothing runtime-tested beyond typecheck + boot.
- **August 22, 2026** — Production deployment (Render + Vercel on subdomains of `unilakekids.com`) plus three payment-path bugs, one diagnosed from live logs. Fixed the checkout re-call dead end (`initiateCheckout` validated status before checking for an existing Order, making the reuse branch unreachable and 409-ing anyone who closed the Razorpay modal); deleted the `checkout.service.ts` copy of `assertNotExpired` that had silently lost its `expiresAt` comparison and was failing every session as expired; and re-keyed webhook idempotency onto the `x-razorpay-event-id` header after Render logs showed `payment.authorized` claiming the shared payment id 671 ms early and `payment.captured` being discarded as a duplicate. Locked: hosting on subdomains of one owned domain (first-party cookies), single instance with autoscaling off, no host that suspends idle instances, and checkout retries returning the Order's snapshotted amount. Rewrote `production.md` into an 11-step runbook; fixed three blocking frontend checkout bugs in the other repo. `RAZORPAY_WEBHOOK_SECRET` flagged for rotation.
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