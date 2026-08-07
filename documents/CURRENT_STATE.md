# Unilake Backend — Current State

**Rewritten every session.** Overwrite, don't append. Keep it small.

**Last updated:** August 7, 2026 (Part E complete and verified end-to-end)

---

## DONE

**Everything through prior sessions** (auth, CRUD, R2, BullMQ scaffold, ComfyUI/RunPod endpoint deployed, comic wizard endpoints, page/bubble/font/thumbnail management, normalized bubble geometry, dimension probing, frontend integration guide, SD worker Parts A–D) — see prior CURRENT_STATE / SESSION_LOG for detail.

**This session — Part E complete: full SD worker orchestration + supporting fixes.**

**Enqueue side (`session.service.ts`):**
- `enqueuePreviewGenerationJobs` refactored to create `PageVersion` rows atomically in a `$transaction` before enqueuing to BullMQ. DB commit precedes Redis write — clean separation for two-system atomicity.
- Query source-of-truth changed from `pageNumber <= freePreviewPages` to `isPreviewPage: true`. Admin's per-page flag is authoritative; comic-level counter is metadata + sanity-check warning only.
- `regeneratePage` refactored: count + cap check + variant-index computation + row creation all in one `$transaction` — race-safe against double-click.
- Job payload simplified to `{ pageVersionId }` — worker looks up everything else from DB.
- Priority formula compressed to fit BullMQ's 21-bit limit: `sessionSecondsInDay + (pageNumber * 80_000)`. Max value = 2,006,399 < 2,097,151. Still gives correct cross-user round-robin.
- `computeJobPriority(sessionCreatedAt, pageNumber)` helper in `session.service.ts` used by both enqueue and regenerate.
- `triggerGeneration` flips session status to `GENERATING_PREVIEW` AFTER enqueue succeeds, not before — recoverable on enqueue failure.

**Worker side (`generationWorker.ts`):**
- Full pipeline built: fetch → idempotency guard → invariant guards → text stamp (reuse if `textStampedUrl` exists) → upload → fork on `hasFace` → face branch (RunPod submit + poll + upload) OR non-face branch (re-upload stamped as final) → mark SD_READY → emit `page:ready` → check for PREVIEW_READY.
- Non-face pages skip RunPod entirely and skip `GENERATING_SD` status — go straight `TEXT_STAMPED → SD_READY`. `comfyJobId` stays null for those rows.
- Non-face pages re-upload the stamped image to `sessions/{sessionId}/final/{pageVersionId}.png` — every session owns a full copy of every page (option A). Prevents referential breakage if a comic gets deleted.
- Idempotency guard at top of worker: if row is already `SD_READY` with `finalImageUrl`, re-emit `page:ready` and bail. Handles BullMQ retry-after-success-ack-lost edge case.
- Error handling wraps the pipeline in outer try/catch/finally: mark row `FAILED` with `errorMessage`, emit `page:error`, release photo cache in finally block, re-throw so BullMQ retries per attempts:3 policy.
- `photoAcquired` flag ensures `releasePhoto` only runs if `acquirePhoto` succeeded — no cache-refcount leaks on early failure.
- SD_READY write clears `errorMessage: null` so retries-that-succeed don't leave stale error text in the DB.
- BullMQ concurrency = 5 to match RunPod max workers.

**PREVIEW_READY transition (`generationWorker.ts` — `maybeMarkPreviewReady`):**
- Called after every SD_READY write. Runs inside a `$transaction` that locks the OrderSession row.
- Guards on `session.status === "GENERATING_PREVIEW"` inside the lock — prevents duplicate transitions when multiple pages finish concurrently.
- Counts distinct `SD_READY` pageIds via `distinct: ["pageId"]`. When count reaches `freePreviewPages`, flips session to `PREVIEW_READY`.
- Also runs on regenerations post-`PREVIEW_READY` but the status guard makes it a cheap no-op.
- Emits `session:preview-ready` event exactly once.

**Photo cache (`src/jobs/workers/sd/photoCache.ts` — NEW FILE):**
- In-memory `Map<sessionId, {bufferPromise, refCount, lastAccessedAt}>` with reference counting.
- Promise memoization: first `acquirePhoto` triggers R2 download and stores the Promise; concurrent callers await the same in-flight fetch. No wasteful re-downloads at concurrency 5.
- `releasePhoto` decrements refCount; entry is evicted when it hits zero.
- Background sweep every 5 min force-evicts entries idle >15 min as a safety net against leaked entries from crashed workers.
- Failed downloads self-evict via `.catch` to prevent poison-Promise reuse.

**WebSocket emit helpers (`src/websocket/event.ts`):**
- `emitPageReady`, `emitPageError` (built in prior session), plus new `emitSessionPreviewReady` added this session.
- All three: get room → bail with debug log if no sockets → iterate sockets → send only if `readyState === OPEN`.

**Photo endpoint renamed:**
- `POST /sessions/:id/photo/validate` → `POST /sessions/:id/photo/confirm`. Python validation gone from the path since validation now lives on the frontend.
- Service function renamed `validateSessionPhoto` → `confirmSessionPhoto`. Zod schema renamed `photoValidateSchema` → `photoConfirmSchema`.
- Confirm endpoint accepts either `CREATED` or `PHOTO_UPLOADED` status (allows photo re-uploads before generation starts).
- Legacy `runPhotoValidation` import removed. Python service file kept on disk pending overall Python cleanup.

**GET /sessions/:id response redesigned:**
- Response now nests `variants` under each page instead of returning flat `pageVersions[]`.
- Returns ALL comic pages (not just preview ones) so the frontend can render the full book with paywall overlays on non-preview pages.
- Each page exposes: `pageId`, `pageNumber`, `isPreviewPage`, `hasFace`, `variants[]`.
- Each variant exposes: `pageVersionId`, `variantIndex`, `status`, `finalImageUrl`, `isSelected`, `errorMessage`. Internal fields (`seed`, `textStampedUrl`, `comfyJobId`, `steps`, `cfg`, `pagePrompt`) deliberately excluded.
- Response also includes `comic: { id, title, freePreviewPages, coverThumbnailUrls }` — one-shot for frontend rendering.
- Sensitive fields (`rawPhotoUrls`, `photoScoreJson`) removed.

**BigInt serialization fix (`app.ts`):**
- Added `(BigInt.prototype as any).toJSON = function () { return this.toString(); }` at the top of `app.ts`.
- `PageVersion.seed` (BigInt) now serializes as a string in JSON responses. Native JSON.stringify can't serialize BigInts otherwise; this is the standard Node/Prisma fix.
- Frontend must type `seed` as `string | null` if they ever consume it.

**JPEG transcode for RunPod payload (`generationWorker.ts`):**
- Before RunPod submit, all three input buffers (stamped artwork, mask, child photo) are transcoded to JPEG q88 via Sharp.
- Fixes RunPod's 10 MiB API payload limit that was blocking 2000×1455 PNG artworks (~8 MB stamped, ~10.6 MB base64).
- R2 STORAGE stays PNG at print quality — the JPEG is only for the API round-trip. The RunPod OUTPUT comes back at ComfyUI's stitched resolution and is saved to R2 as PNG. Print quality preserved.
- Filenames sent to RunPod match extension (`.jpg`).
- Sharp import added to `generationWorker.ts`.

**PNG compression improvement (`textStamp.ts`):**
- Sharp's default PNG compressionLevel:6 was inflating output vs source. Bumped to `.png({ compressionLevel: 9, adaptiveFiltering: true })` — lossless, ~20-40% smaller output.

**Status-flip ordering fix (`session.service.ts`, `triggerGeneration`):**
- Session status flip to `GENERATING_PREVIEW` moved AFTER the enqueue call, not before. If enqueue fails, session stays at `PHOTO_UPLOADED` and user can retry cleanly instead of getting stuck.

**End-to-end verification:**
- Full preview generation flow tested via Apidog + wscat: create session → child details → photo upload → confirm → generate → WebSocket connect → watch `page:ready` events → verify `session:preview-ready` fires exactly once → verify DB row progression → verify final image URLs load in browser.
- Face-swap output on A40 GPU: ~11s delay + ~103s execution + polling gap → ~120s wall clock per face page warm.
- Regenerate + variant cap (3 before payment) verified working with 409 on 4th attempt.
- Non-face page path verified working — completes in seconds, `comfyJobId: null`, no photo cache slot acquired.

---

## IN PROGRESS

Nothing. Part E complete and verified.

---

## NEXT (priority order)

1. **Checkout / confirm endpoints** (~6–8 h)
   - `POST /sessions/:id/checkout` — capture cover type + shipping + notification email, prep for payment.
   - `POST /sessions/:id/confirm` — user selects final variants for all pages, sets `PageVersion.isSelected = true` on the picks, moves session to `CONFIRMED`.
2. **Razorpay integration** (~10–14 h)
   - Order creation, payment webhook + signature verification, order status persistence, retry semantics for failed payments.
3. **Paid page generation** (~4–6 h)
   - Reuses Part E worker with `MAX_VARIANTS_AFTER_PAYMENT = 8`.
   - New service function `enqueuePaidGenerationJobs` — same pattern as `enqueuePreviewGenerationJobs` but filters for `isPreviewPage: false`.
   - `maybeMarkPaidReady` — same pattern as `maybeMarkPreviewReady` but transitions `GENERATING_PAID → PAID_PAGES_READY`.
4. **PDF compilation with pdf-lib** (~6–8 h)
   - Triggered after `CONFIRMED`. Compiles selected variants of all pages into one PDF, uploads to R2 with 30-day retention, generates 7-day signed download URL.
5. **User + admin order endpoints** (~6–8 h)
   - `GET /api/user/orders` (list, detail). Admin `GET /api/admin/orders`.
6. **Shiprocket integration** (~10–14 h)
   - Domestic + international routing based on `shippingCountry` ISO code. Order creation, tracking webhook.
7. **Email notifications** (~6–8 h)
   - Preview-ready email, paid-preview-ready email, PDF-ready email, shipping notification, tracking updates.
8. **Stabilization** (~8–10 h)
   - Bug bash, load smoke test, log cleanup, deployment prep.

**Total remaining: ~50–74 h. At 12 h/day: ~4–7 working days.**

---

## OPEN QUESTIONS

- **CORS origins for deployed frontend** — hardcoded `http://localhost:3000` in `app.ts` and Better Auth `trustedOrigins` (`auth.ts`). Update both together once frontend has a deploy URL.
- **Client RunPod cost sign-off** — currently 1 active worker (~$250/month at 48 GB @ $1.22/hr). BullMQ concurrency is 5, so 4 extra slots wait for the single worker. Client needs to sign off on bumping to 5 workers (~$1,250/month) for real concurrent throughput.
- **JPEG quality for mask** — masks are strict black/white with sharp edges. JPEG q88 could soften them. Verify in production; revert just the mask to PNG if face-swap boundaries look soft.
- **Frontend seed type** — `PageVersion.seed` now serializes as `string | null` due to BigInt fix. Frontend team needs to update their type if they consume it (they probably shouldn't — it's for debugging).
- **Backend hard cap on artwork upload size (5 MB)** — currently admin discipline only; add Zod validator at page upload endpoint later.
- **Payload size ceiling for RunPod** — fixed via JPEG transcode; original PNG limit no longer relevant. If future workflows change the image types, revisit.
- **Photo validation ownership** — validation moved to frontend. Legacy Python service file still on disk; deferred cleanup.
- Razorpay order ID reuse on retry; Shiprocket international address format; email provider; international Razorpay account.
- `validateQuery` middleware — deferred.
- WebSocket rooms in-memory → needs Redis pub/sub for multi-instance.
- No signed-download endpoint for private assets (fonts, child photos).
- Python cleanup — deferred indefinitely.

---

## VERIFY / LOOSE ENDS

**🔴 Priorly-flagged verification items from July 29 session — still not run against a live server.**
- Public bucket CORS re-verify with a real browser PUT from `localhost:3000`
- Page asset flow end-to-end (upload-url → PUT → POST page → paste URL in incognito)
- Dimension probe on artwork populates `artworkWidth`/`artworkHeight`
- Mask size mismatch → 400
- PATCH-only-artwork rejecting stale mask (edge case, likely bug)
- Partial bubble PATCH bounds (edge case, likely bug)
- Bubble bounds sweep (epsilon test, fontSize float)
- Thumbnail delete + reorder (silent-data-loss test)
- R2 cleanup on page/comic delete
- Zero-R2-traffic path (PATCH only `steps`)
- Per-page tunables never tested

**Part E loose ends flagged this session:**
- **Orphaned QUEUED PageVersion rows from failed enqueue.** If `enqueuePreviewGenerationJobs` succeeds committing DB rows but fails during BullMQ enqueue, retrying `POST /generate` fails with a unique constraint error `(orderSessionId, pageId, variantIndex)`. Need a recovery path — either delete-and-recreate on retry, or detect existing `QUEUED` rows and just re-enqueue them.
- **JPEG mask edges** — verify face-swap boundaries in production look clean. Revert mask to PNG if soft.
- **Stale `errorMessage` on old DB rows** — worker fix cleans this going forward, but existing rows with stale error text remain until manually cleared (`UPDATE page_versions SET errorMessage = NULL WHERE status = 'SD_READY' AND errorMessage IS NOT NULL`). Optional cleanup.
- **Comic thumbnail URL prefix `comics/temp/`** — leftover from wizard iteration, cosmetic rename to `comics/thumbnails/` deferred.
- Full Apidog pass on all page/bubble/font CRUD from July 29 still pending — Part E was end-to-end tested but the CRUD endpoints haven't been verified against a real browser.

**Frontend-team dependency:**
- Frontend team has NOT yet built the customer-facing preview viewer / WebSocket consumer. Part E was tested with wscat. Frontend can now build against the redesigned `GET /sessions/:id` shape.
- Handoff doc for frontend covering the new endpoint shape + WebSocket event contract still needs writing (Category 3 of Step 8).

**Code cleanup backlog (none urgent):**
- HD code commented not deleted — `queues.ts`, `workers/index.ts`, `hdWorker.ts`
- LoRA fields retained-but-unused — `Comic.loraFileUrl`, `loraStrength`, `POST /comics/lora/upload-url`
- `Comic.publishJobId` / `publishError` — dead since publish became a sync flip
- Dead code in `comic.controller.ts` (`uploadThumbnailRequestSchema`, commented handler) and `admin.ts` (commented thumbnail route)
- `page.controller.ts`, `bubble.controller.ts`, `font.controller.ts` still double-validate
- Country POST/PUT bypass `validateBody` (raw `.parse()` in controller)
- Stray `// pageNumber Int` comment in `PageVersion`; `npx prisma format` for `fontSize` alignment
- Stale schema comments: `Country.flagUrl` says "path" (stores URL), `rawPhotoUrls` says "up to 2" (decision is 1)
- Frontend integration guide references `/api/admin/status` endpoint — verify this exists in `admin.ts` or the guide is wrong
- Python photo validation service still on disk (`src/services/photoValidation.service.ts`) — sweep during whole-Python cleanup
- Old `photoValidateSchema` / `PhotoValidateInput` exports could be checked for stragglers if any imports missed the rename