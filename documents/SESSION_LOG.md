# Unilake Backend — Session Log

**Rules:** Last 2 sessions in full detail. Older sessions collapsed to one-liners. Anything worth keeping long-term should already be in `PROJECT_CONTEXT.md`, `DECISIONS.md`, or `CURRENT_STATE.md` — the log is for narrative memory, not source of truth.

---

## Session — August 7, 2026 — Part E complete: full SD worker orchestration + supporting fixes + end-to-end verification

**Triggered by:** Parts A–D of the SD worker were done and verified individually on August 3, but nothing was wired together. Guts wanted to build the full orchestration (Part E), verify it end-to-end with real RunPod jobs, and close out Part E. Ended up doing that plus five significant supporting fixes uncovered during testing, plus a full redesign of the GET /sessions/:id response for the frontend.

**Decisions made:**
- **PageVersion row created BEFORE BullMQ enqueue** — inside a `$transaction` so the DB write is atomic. Enqueue happens after commit. If Redis fails afterward, orphan QUEUED rows exist in DB (recoverable) but no data is lost. Two-system atomicity — always commit the durable system first, then trigger the transient one.
- **Job payload minimized to `{ pageVersionId }`** — worker looks up everything else from DB. Keeps the queue contract tiny and makes idempotency simpler.
- **Regenerate uses transactional variant-index computation** — count + cap check + row create all inside `$transaction`. Prevents double-click race producing duplicate `variantIndex` values with the unique constraint.
- **BullMQ concurrency 5 shipped despite RunPod having 1 active worker** — code stays at the target; when client bumps RunPod workers the code "just works" without needing a redeploy.
- **BullMQ priority formula compressed to fit 21-bit limit** — original `sessionStartTime + (pageNumber * 100000)` exceeded BullMQ's 2,097,151 max by 800,000×. Replaced with `sessionSecondsInDay + (pageNumber * 80_000)`. Max value = 2,006,399. Extracted to `computeJobPriority(sessionCreatedAt, pageNumber)` helper used in both enqueue and regenerate.
- **Session status flip moved to AFTER enqueue succeeds** — was firing before. Enqueue failure was leaving sessions stuck at `GENERATING_PREVIEW` with no PageVersion rows, and retries hit 409. Now failure leaves session at `PHOTO_UPLOADED` and retry works cleanly.
- **`PREVIEW_READY` transition uses transaction with row lock** — chose Option B over the naive "count-and-flip." Prevents duplicate `session:preview-ready` events when the last few pages complete concurrently. Uses `session.status === "GENERATING_PREVIEW"` guard inside the transaction; if another worker already flipped it, we no-op cleanly. Counts distinct SD_READY pageIds via `distinct: ["pageId"]`.
- **Photo cache built with reference counting + Promise memoization** — concurrent jobs for the same session share one download via awaiting the same in-flight Promise. Refcount tracks who's using it; entry evicts when refcount hits zero. Background TTL sweep every 5 min catches leaked entries from crashed workers idle >15 min. Failed downloads self-evict via `.catch` to prevent poison-Promise reuse.
- **Non-face pages skip RunPod entirely** — fork on `page.hasFace`. Non-face pages go text-stamp → re-upload as `finalImageUrl`. Skip `GENERATING_SD` status; go `TEXT_STAMPED → SD_READY` directly. `comfyJobId` stays null.
- **Non-face pages re-upload the stamped image under `/final/{pageVersionId}.png`** — option A over option B (direct URL reuse). Every session owns a full copy of every page. Prevents referential breakage if comic gets deleted. Extra R2 traffic is worth the safety.
- **Photo endpoint renamed** `POST /sessions/:id/photo/validate` → `POST /sessions/:id/photo/confirm`. Backend Python validation is fully gone. Frontend runs MediaPipe.js and only calls confirm after passing. Confirm accepts either `CREATED` or `PHOTO_UPLOADED` current status (allows re-upload before generation).
- **Preview page query changed from `pageNumber <= freePreviewPages` to `isPreviewPage: true`** — `Page.isPreviewPage` is the source of truth. Admin picks WHICH pages are preview (any subset, not necessarily first N). `Comic.freePreviewPages` is a counter used only for sanity-check log warnings. Bug discovered when a `freePreviewPages: 1` comic with page 4 flagged as preview was generating page 1 instead.
- **JPEG q88 for RunPod payload; PNG stays for R2 storage** — RunPod's 10 MiB API cap was hit when stamped 2000×1455 PNG grew from 4.6 MB source to 8 MB via Sharp re-encoding. JPEG transcode right before `submitAndAwaitResult` brings payload to ~400 KB. R2 storage stays PNG at print quality; RunPod OUTPUT comes back at ComfyUI's stitched resolution and is saved to R2 as PNG. Filenames sent to RunPod match `.jpg` extension.
- **PNG compression tuned for R2 storage** — `.png()` with defaults was inflating output vs source. Changed to `.png({ compressionLevel: 9, adaptiveFiltering: true })`. Lossless, ~20-40% smaller.
- **BigInt serialization patched globally** — added `(BigInt.prototype as any).toJSON` in `app.ts`. `PageVersion.seed` is BigInt; native JSON.stringify throws. Standard Node/Prisma fix. Frontend must type `seed` as `string | null` if consumed.
- **GET /sessions/:id response redesigned** — flat `pageVersions[]` replaced with nested `pages[].variants[]`. Response now includes ALL comic pages (not just preview ones) so frontend can render locked/paywalled pages. Each page exposes `pageId`, `pageNumber`, `isPreviewPage`, `hasFace`, `variants[]`. Each variant exposes `pageVersionId`, `variantIndex`, `status`, `finalImageUrl`, `isSelected`, `errorMessage`. Internal fields (`seed`, `textStampedUrl`, `comfyJobId`, `steps`, `cfg`, `pagePrompt`, `rawPhotoUrls`, `photoScoreJson`) deliberately excluded via explicit `select`. Response includes `comic: { id, title, freePreviewPages, coverThumbnailUrls }` for one-shot rendering.
- **Snapshot + stream pattern locked as the frontend contract** — GET is source of truth (initial load, reconnect, return-after-away). WebSocket is delta stream during active generation. Both together = full state sync. Frontend must call GET on reconnect to reconcile any missed events.
- **`SD_READY` write clears `errorMessage: null`** — otherwise successful retries keep stale error text from the failed attempt. Fixed in worker; existing bad rows can be cleaned optionally via SQL.
- **`comfyJobId` allowed null on SD_READY** — non-face pages don't have one. Schema field was already nullable; worker just needs to write null explicitly.

**Work done:**
- **Step 1 (WebSocket emit):** confirmed `event.ts` already had `emitPageReady` and `emitPageError`. Added `emitSessionPreviewReady` matching the same pattern. Nudged both existing helpers' "no sockets" log lines from `info` to `debug` to keep production logs clean.
- **Step 2 (photo cache):** built `src/jobs/workers/sd/photoCache.ts` from scratch — ~120 lines. In-memory Map with `bufferPromise`, `refCount`, `lastAccessedAt`. `acquirePhoto` handles first-download vs cache-hit via Promise memoization. `releasePhoto` decrements + evicts. `sweepStaleEntries` runs on 5-min timer. Explained the Promise-memoization pattern to Guts in detail — this was new for him.
- **Step 3 (service refactor):** rewrote `enqueuePreviewGenerationJobs` to use `$transaction` for row creation, then enqueue with priority. Rewrote `regeneratePage` to do count + cap check + row create in transaction, then enqueue. Both use the new `computeJobPriority` helper. Simplified job payload to `{ pageVersionId }`.
- **Step 4 (worker happy path):** replaced the stub `generationWorker.ts` with the full pipeline. Wrote ~180 lines with numbered stage comments. Idempotency guard, invariant guards (initially all-or-nothing), text stamp with reuse-on-retry, R2 upload, photo cache acquire, workflow build, RunPod submit-and-await, result upload, SD_READY write, WebSocket emit. No error handling yet — that was Step 5.
- **Step 5 (worker error handling):** wrapped pipeline in try/catch/finally. Added `markPageVersionFailed` helper (never throws; nested throw in catch would mask original error). `photoAcquired` boolean tracks whether release should fire in finally. Error path marks row FAILED, emits `page:error`, re-throws so BullMQ retries.
- **Step 6 (PREVIEW_READY):** added `maybeMarkPreviewReady` helper with the transaction-based race protection. Wired into worker success path after `emitPageReady`. Added `emitSessionPreviewReady` call when the transition fires.
- **Photo confirm endpoint rename:** touched four files — `session.schema.ts` (renamed schema + type), `session.service.ts` (renamed function, removed Python validation call, added CONFIRMABLE_STATUSES gate accepting CREATED or PHOTO_UPLOADED), `session.controller.ts` (renamed handler), `public.ts` (renamed import + route path). Left the Python service file on disk pending overall Python cleanup.
- **hasFace fork added to worker (post-Step 6):** Guts flagged that non-face pages shouldn't hit RunPod. Refactored Section 3 guards into "always required" vs "only if hasFace." Added Section 5 fork: non-face path downloads stamped image and re-uploads under `/final/` prefix. Face path unchanged, just relabeled 5a–5e. Consolidated Section 6 to one SD_READY write feeding both branches.
- **`isPreviewPage` fix:** replaced `pageNumber <= freePreviewPages` filter with `isPreviewPage: true` in `enqueuePreviewGenerationJobs`. Added sanity-check warning log if `previewPages.length !== freePreviewPages` (data-integrity drift).
- **BullMQ priority formula fix:** hit the 21-bit ceiling first attempt. Rewrote to seconds-in-day. Verified math: max `86,399 + 24 × 80,000 = 2,006,399 < 2,097,151`. Fixed variable naming slip (`session.createdAt` vs parameter `sessionCreatedAt`) that TypeScript caught immediately.
- **Session status flip ordering fix:** moved `orderSession.update({ status: "GENERATING_PREVIEW" })` from before to after `enqueuePreviewGenerationJobs` in `triggerGeneration`.
- **JPEG transcode for RunPod payload:** added `import sharp from "sharp"` to `generationWorker.ts`, added Section 5c.5 with three `sharp(...).jpeg({ quality: 88 }).toBuffer()` calls. Changed all three RunPod filenames to `.jpg`. Updated `submitAndAwaitResult` call to use the JPEG buffers.
- **PNG compression tuning:** one-line change in `textStamp.ts` — `.png()` → `.png({ compressionLevel: 9, adaptiveFiltering: true })`.
- **BigInt patch:** added six-line block at top of `app.ts` before `const app = express();`.
- **GET /sessions/:id redesign:** rewrote `getOrderSessionId` in `session.service.ts`. Three sequential queries (session with comic, all pages, all pageVersions). Built `Map<pageId, PageVersion[]>` for O(n) grouping. Reshaped output to `pages[].variants[]` with explicit field selection. Guts confirmed frontend hasn't built against the old shape yet, so no need to keep flat `pageVersions[]` for backwards compat.
- **`errorMessage: null` in worker's SD_READY write** — cleaner audit trail on rows that succeed after a prior failure.
- **End-to-end test plan executed:** Guts ran full Step 7 flow via Apidog. Prep, session create, child details, photo upload/confirm, WebSocket connect, generate, watch page:ready events, verify DB progression, verify final image URLs load in browser, regenerate variant, cap enforcement (409 on 4th attempt). All passed. Preview-ready fired exactly once. RunPod timing on A40: ~11s delay + ~103s execution per face page warm.
- **Code cleanup (Step 8 Category 1):** identified 7 stale "CHANGED:" and "NEW:" diff-marker comments in `generationWorker.ts` (accurate mid-build, misleading permanently). Rewrote all 7 comment blocks in place. Header comment updated to describe the finished worker rather than "Step 5 layers error handling..." `photoCache.ts` was already clean — false alarm on my part when I flagged it.

**Tasks added to backlog (in CURRENT_STATE loose ends):**
- Orphaned QUEUED PageVersion rows if enqueue fails after DB commit — needs recovery path (delete-and-recreate or reuse existing).
- Verify JPEG mask edges don't soften face-swap boundaries in production — revert just the mask to PNG if artifacts appear.
- Stale `errorMessage` on old DB rows from before the worker fix — worker fix cleans forward, but existing rows need optional SQL cleanup.
- Frontend handoff document still needs writing (Step 8 Category 3) — covers new `GET /sessions/:id` shape, renamed confirm endpoint, WebSocket event contract.
- Client RunPod cost sign-off — BullMQ concurrency 5 vs currently 1 active worker. 4 BullMQ slots idle waiting for RunPod worker.
- Frontend must type `seed` as `string | null` when consuming — BigInt patch serializes as string.

**Mistakes caught:**
- Claude proposed the BullMQ priority formula without checking BullMQ's 21-bit ceiling. First test failed immediately with `Priority should be between 0 and 2097152`. Should have known the limit before recommending the formula. Rewrote to seconds-in-day; Guts didn't need to hunt for the fix, but should not have hit the error at all.
- Claude wrote `computeJobPriority(session.createdAt, ...)` inside `enqueuePreviewGenerationJobs` where the parameter is actually named `sessionCreatedAt`. Local naming slip. TypeScript caught it before Guts ran the code.
- Claude initially wrote guards checking `pagePrompt` and `maskUrl` for every page in Step 4. Non-face pages don't need them and would crash. Guts flagged that only face pages need those. Refactored to split guards into "always required" vs "only if hasFace."
- Claude initially forgot `errorMessage: null` in the SD_READY write. Rows that failed once and succeeded on retry kept the old error text — misleading in DB and in GET response. Added on second pass.
- Claude initially proposed downscaling images for RunPod payload as the fix for the 10 MiB cap. Would have hurt print quality since ComfyUI stitches back at input resolution. Course-corrected to JPEG-only-for-transport, PNG-for-storage.
- Claude flagged that `photoCache.ts` had stale "Part E" references during Step 8 code cleanup. Was wrong — file was clean. Corrected the diagnosis when Guts uploaded the file.
- Claude wrote comments containing "CHANGED:" and "NEW:" as diff-marker annotations during Steps 4-6. Useful mid-review, misleading permanently as file-level documentation. Guts caught the pattern during Step 8 cleanup review; all 7 were rewritten as steady-state comments.
- Claude forgot to include `orphaned QUEUED rows retry` as a proactive fix. Guts's earlier failed test left orphan rows and the next generate hit unique constraint on retry. Documented as a loose end but not fixed this session.

---

## Session — August 3, 2026 — SD worker Parts A–D complete, Part D live-tested against real RunPod

**Triggered by:** frontend team was building the comic wizard for a day and a half; Guts wanted to use the time to make real progress on the SD worker instead of waiting. Ended up completing four of five planned parts of the SD pipeline (foundation, token substitution, Sharp text stamping, ComfyUI/RunPod client).

**Decisions made:**
- **Polling over webhook for RunPod** — after walking through the trade-offs (ngrok pain in dev, timeout fragility with `/runsync`, BullMQ retry composition), polling won. Also rejected `/runsync` for the same fragility reasons. Locked as never-do.
- **BullMQ priority formula for cross-user fairness** — `sessionStartTime + (pageNumber * 100000)`. Client raised the concern that a second user's 10 pages sit waiting for a first user's queue to drain (~6 minutes). Round-robin via priority solves it in 3 extra lines of code. Not complex enough to defer. **(Note: this formula was found in Aug 7 session to exceed BullMQ's 21-bit ceiling; replaced with `sessionSecondsInDay + (pageNumber * 80_000)`. Original reasoning about round-robin fairness stands; only the compression differs.)**
- **BullMQ concurrency bumped to 5** to match RunPod max workers (was 3, misaligned since we have 5 RunPod workers). Wasted RunPod capacity previously. Old rule superseded.
- **`Page.pagePrompt` becomes required** at Zod layer (create + update), DB stays nullable. No migration. Client confirmed positive prompt is admin-controlled per page.
- **Node 111 patched per request from `pagePrompt`** (full replacement); node 473 negative prompt stays hardcoded forever.
- **Worker file renamed** `sdWorker.ts` → `generationWorker.ts`. Queue name, enum values, variable name unchanged (schema cost too high).
- **`randomUUID()` in font upload keys reverted** — briefly implemented, then Guts explicitly kept the sequential-only contract instead. Locked as final.
- **A40 as the working GPU tier** — RTX 4090 in US-NC-1 had driver heterogeneity (some workers CUDA <12.6, container fails on those). A40 works consistently. Not a fix path in code; escalate via GPU tier / region switch.
- **Artwork upload soft cap 5 MB** (admin discipline for now, hard validator later).
- **No client-side TTL** — endpoint-level 600s execution timeout in RunPod dashboard handles it.
- **Sharp text stamping design** locked: SVG-per-bubble, `text-anchor: middle`, base64 font embedding, `<tspan>` multi-line, `fontSizePx * 0.6` char-width approximation, decrement-by-1 auto-shrink with pixel floor.

**Work done:**
- **Task A1:** re-read the SD worker stub, `queues.ts`, and `workers/index.ts`; confirmed understanding of BullMQ mechanics.
- **Task A2:** created `src/jobs/workers/sd/` with four placeholder files.
- **Task A3:** added `RUNPOD_ENDPOINT_ID` and `RUNPOD_API_KEY` to `env.ts` (required list + config export), `.env.example`, and local `.env`. Server starts cleanly.
- **Task A4:** placed `api-workflow.json` at `src/config/workflows/`, confirmed node IDs 78/435/519/466/471/467/111 all match. Verified `resolveJsonModule` in tsconfig. Tested import with temporary console.log.
- **Task A5:** confirmed `src/config/generation.ts` already had every constant Parts B–E would import.
- **Part B:** built `PronounKey` lookup table + `substituteTokens` function. Verified with hardcoded test.
- **Part C:** built `wrapText`, `fitTextToBox`, `escapeXml`, `buildBubbleSvg`, `detectFontFormat`, and the main `stampTextOnPage` function. Fixed a Sharp type import issue (`sharp.OverlayOptions` → `import type { OverlayOptions } from "sharp"`). Live-tested with a real comic page from DB — output looked correct.
- **Part D:** built `WorkflowPatch` type + `buildWorkflow` function (deep-clone + 7-field patch). Built full `runpodClient.ts` with submit + polling loop + base64 decode. Live-tested end-to-end against A40 endpoint — real face-swapped PNG returned.
- **Diagnosed the CUDA container startup failure** on RTX 4090 workers by reading the container logs. Explained it wasn't a code issue (same image works on some workers). Guts fixed it by switching to A40.

**Tasks added to backlog (in CURRENT_STATE loose ends):**
- Part E open questions (concurrency bump to 5, PREVIEW_READY transition, priority formula verification). **All resolved in Aug 7 session.**
- Whether to add hard artwork size validator at upload endpoint. **Still open; less urgent now that JPEG-for-RunPod removed the payload pressure.**
- Bumping RunPod worker count (currently 5 vs client's active workers = 1 configured; needs client sign-off for cost). **Still open.**

**Mistakes caught:**
- Claude wrote `import sharp from "sharp"` then referenced `sharp.OverlayOptions` in Part C, which failed in Sharp 0.35.3 (stricter type namespace rules than older versions). Fixed to named type import. Should have used the named import from the start.
- Claude wrote a `.ts` extension in the Part C imports for `MIN_FONT_SIZE from "../../../config/generation.ts"` — should have been `.js` per the project's ESM convention. Caught mid-writing.
- Claude initially told Guts the Part C `console.log` test would fire on server startup; it didn't, because `workflow.ts` was never imported by anything (tsx only executes imported files). Suggested a temporary import in `sdWorker.ts` as the workaround.
- Claude was initially going to write Part D with 6 patched fields (not 7); Guts corrected: `pagePrompt` is now required and gets patched into node 111.
- Claude misread the first Part C output image and initially flagged pronoun substitution as broken; on second look, all pronouns were correctly substituted. Corrected mid-message.

---

## Older sessions (collapsed)

- **July 29, 2026** — Frontend integration guide + public page assets + normalized bubble coordinates. Page artwork + masks moved to public bucket. Bubble geometry became normalized 0–1 fractions. `Page.artworkWidth`/`artworkHeight` Sharp-probed server-side. `fontSize` became `Float @default(0.02)` fraction of artwork height. Wrote `FRONTEND_COMIC_INTEGRATION.md`. Blockers 1–3 fixed with 7 code changes; blockers 4–8 resolved by product decision. `react-konva` recommended for bubble mapper. Publish gate stays 2-check (thumbnails + pricing); the other 9 checks are frontend's job. Sharp installed. Single-thumbnail delete works via `thumbnailKeys` re-send.
- **July 28, 2026** — Multi-thumbnail feature (schema, batch upload endpoint, full-array PATCH pattern) + single-LoRA lock-in (client-confirmed baked in Docker) + base64-everything transport architecture confirmed. Publish flow stays synchronous DB flip; async ComfyUI asset sync worker deleted from NEXT list.
- **July 26, 2026** — Client-account ComfyUI endpoint deployed end-to-end on RunPod; four sequential build failures diagnosed (30-min build timeout → cut 815 MB of unused downloads; KJNodes missing `cv2` → added `pip install -r requirements.txt`; ReActor missing `onnxruntime` → explicit install; `libcudart.so.13` → pinned `onnxruntime-gpu<1.27` for CUDA 12). Validated at 6.6 s delay + 1m 16s execution. Added per-page `steps`/`cfg` tunables with bounds constants in `src/config/generation.ts`. Rule locked: never propose a Dockerfile fix from a RunPod status error without reading container logs.
- **July 25, 2026** — Product simplification pass: HD pipeline removed, Sharp text stamping order reversed to FIRST, variant caps changed to payment-based. Schema fields renamed (`textStampedUrl`, `comfyJobId`, `finalImageUrl`). Deep bug audit found 3 latent bugs (variant ordering, `.map()` returning undefined, job name typo). HD code commented not deleted.
- **July 24, 2026** — Frontend-impact bug audit, response-envelope standardization (`sendSuccess()` across all 13 controllers), comic thumbnail R2 cleanup on update, authored `FRONTEND_HANDOFF.md`. Bugs found: WS `connection` missing `sessionId` arg, raw `.parse()` in generate/regenerate handlers, `"devlopment"` typo in error handler, duplicate `/team-members` route.
- **July 21, 2026 (afternoon/evening)** — ComfyUI/RunPod deployment via comfy.getrunpod.io: face-swap workflow processed, GitHub repo pushed, Docker "Ready", personal-account testing halted at credit step. Locked decisions: api-workflow.json as backend template, filename-match invariant, cold-start mitigation.
- **July 21 (morning)** — Schema migration (CoverType, OrderSession/Order fields, SavedAddress), `requireLoggedIn`/`attach-user` built, full CRUD completion, CORS `PATCH` fix, admin route reorg.
- **July 13** — Deployment planning (Cloud Run asia-south1, GitHub Actions CI/CD), customer-auth introduction via Better Auth, cover type pricing dimension, `OrderSession.userId` nullable FK, `SavedAddress` design, payment retry model, Docker rewrite ~250MB.
- **July 10** — CMS features (Theme, HeroImage, CustomerReview, TeamMember, Feedback, AnnouncementBar), Comic CRUD expansion, Docker setup complete, ~40+ new endpoints.
- **Days 1–3** — Core scaffold: Express/TypeScript/ESM, Prisma+Neon, two-bucket R2, Redis/BullMQ, Better Auth, Country and Comic base CRUD, public catalogue, `OrderSession` create/update/get, authenticated WebSocket.
- **Day 4 Block 1** — Generate-trigger + per-page regenerate endpoints. `PageVersion` schema fix.
- **Day 4 Block 2** — Page/Bubble/Font admin CRUD, unified comic update, LoRA upload. Double-validation cleanup (later found incomplete).
- **Day 4 Block 3** — Real Python photo validation, later moved to frontend.