# Unilake Backend — Decisions

**Finalized decisions with one-line reasoning.** Prune superseded entries — don't keep historical footnotes.

---

## NEVER DO (rejected approaches)

- **NestJS** — DI-container overhead not worth it for solo dev.
- **Winston logging** — Pino chosen.
- **Socket.IO** — `ws` sufficient; rooms via `Map`.
- **MongoDB** — Postgres relational fit.
- **Single R2 bucket with prefixes** — R2 public toggle is bucket-level.
- **Prisma `connect` for pricing rules** — direct FK writes preferred.
- **Hardcoded free-preview page counts** — per-comic via `Comic.freePreviewPages`.
- **Comic-level generation prompts** — prompts page-specific only.
- **Backend Python photo validation** — moved to frontend MediaPipe.js.
- **Frontend sending `userId` in body** — always from Better Auth cookie.
- **ComfyUI infra setup as ongoing responsibility** — deployment help is scope-limited to producing an endpoint URL for the client; ongoing GPU ops remains client's job per SOW.
- **`PageVersion` with bare `pageNumber Int`** — must use real `pageId` FK.
- **WebSocket `{ server: httpServer }`** — `{ noServer: true }` needed for pre-handshake auth.
- **Old MediaPipe `mp.solutions` API** — fully removed.
- **Python versions other than 3.11.x** — 3.14 incompatible with TensorFlow.
- **Pupil-shape contour / frame-bridge-uniformity sunglasses detection** — rejected with real evidence.
- **`validateParams` middleware** — retrofit cost too high.
- **Two photos per session** — single photo.
- **Signed R2 URLs to Python** — Node downloads to temp file first.
- **Cloud Pub/Sub over BullMQ** — revisit at scale.
- **Alpine Docker base** — native npm packages need glibc.
- **Cascade-delete font references from bubbles** — silent data loss.
- **Cross-comic font assignment** — validated at bubble update.
- **RunPod Cached Model feature for face-swap endpoint** — designed for single-HF-model LLM workers; face-swap uses 9 heterogeneous files across 4 folders + one-model-per-endpoint limit + custom path-mapping work required. Revisit if RunPod adds multi-model cache support.
- **Serverless as default deployment mode without warm worker** — cold starts on 40+ GB Qwen model = 60–180s; incompatible with live-preview UX. Active Workers ≥ 1 in production.
- **Pointing production endpoint at comfy.getrunpod.io's Docker Hub image** — client should own full pipeline; rebuild on client's RunPod GitHub integration instead.
- **Client sending workflow-JSON round-trips through their own backend routing** — Express backend sends workflow directly to RunPod endpoint via HTTPS; RunPod is the transport, not comfy.getrunpod.io at runtime.
- **Waiting for comfy.getrunpod.io's Docker build to finish before deploying to RunPod** — comfy.getrunpod.io's build is independent; RunPod builds from GitHub separately.
- **Raw `schema.parse()` left uncaught in a controller** — must be `safeParse` + thrown `ValidationError`, or wrapped in try/catch converting `ZodError`; otherwise it escapes as an uncaught 500 instead of a 400.
- **Ad hoc per-controller success response shapes** — replaced by the shared `sendSuccess()` envelope; never hand-roll a one-off `res.json({...})` for a success path again.
- **Omitting `sessionId` when re-emitting the WebSocket `connection` event** — `wss.handleUpgrade`'s callback must pass `sessionId` through to `wss.emit("connection", ws, req, sessionId)`, or every socket silently joins the same "undefined" room.
- **HD upscale stage / `hdGenerationQueue` / `hdWorker` re-introduction** — HD pipeline dropped. SD output is the final print-ready image. All future variants stay in the SD pipeline.
- **Stamping text AFTER ComfyUI** — text is always stamped onto raw artwork FIRST, then the stamped image is sent to ComfyUI for face-swap. Reversing this order breaks the whole flow.
- **SD/HD-stage-based variant caps** — cap is determined by payment status (`hasPaid ? 8 : 3`), never by which generation stage the session is in.
- **Deleting HD code before launch** — commented-out HD code (queues, workers, imports) stays in the repo until product launch is confirmed stable, then gets swept. Explicit choice to keep a rollback path if the product decision reverses.
- **`.map()` callbacks that wrap the promise in braces without returning** — `Promise.all(list.map((x) => { asyncFn(x) }))` awaits `[undefined, ...]`. Always implicit-return or explicit `return`.
- **Bare `pip install onnxruntime-gpu` in ComfyUI Dockerfiles targeting `runpod/worker-comfyui`** — the base image is CUDA 12.x; onnxruntime-gpu 1.27.0+ is CUDA 13. Pin `"onnxruntime-gpu<1.27"` when installing.
- **Trusting comfy.getrunpod.io's Dockerfile output as-is for custom nodes cloned via raw `git clone`** — the tool clones the repo but skips `pip install -r requirements.txt`. Must add manually. Also check whether the custom node has an `install.py` (like ReActor) that installs deps outside requirements.txt.
- **Committing large placeholder images baked into ComfyUI worker Docker builds** — RunPod's GitHub build has a 30-min hard timeout. Every extra layer adds export time. Strip unused downloads and placeholder inputs before pushing.
- **Guessing a fix from a RunPod status error alone** — the top-level error message (`missing_node_type`, etc.) is often ambiguous. Always pull container logs and read the actual Python traceback before proposing a fix.
- **Magic numbers in Zod validator bounds for generation-tunable fields** — bounds like `min(1).max(8)` for steps must live as named constants in `src/config/generation.ts` and be imported. The SD worker will import the same constants for defensive checks.
- **Raw `git checkout <hash>` without confirming the commit contains the exact nodes/classes the workflow references** — comfy.getrunpod.io picks a commit that exists, not one validated against your workflow. If time-pinning, verify the target commit against a known-working local run.
- **Per-comic LoRA sync / publish-time asset sync worker** — client confirmed single face-swap LoRA for entire catalogue (baked in Docker). Publish stays as synchronous DB status flip; no BullMQ publish worker, no ComfyUI asset push, no async progress UI. Revisit ONLY if client reverses on multi-style comics.
- **Deleting LoRA schema fields / endpoint / Zod fields now** — retained-but-unused pattern chosen over deletion. Cost of retention is zero (fields optional, endpoint unused); cost of deletion + potential reversal is high. Sweep post-launch with HD cleanup only if decision holds ~1–2 months.
- **Exposing LoRA upload step in admin wizard UI** — frontend must skip this step. Backend fields stay for schema stability but wizard UI does not surface them.
- **Two thumbnail upload endpoints (single + batch)** — batch endpoint (`POST /comics/thumbnails/upload-urls`) handles single case trivially (`files: [{...}]`). Single-file endpoint removed to avoid two paths doing the same thing.
- **Diff-based thumbnail array patching from frontend** — frontend sends the FULL desired `thumbnailKeys` array on update, backend computes the removed-URLs diff for R2 cleanup. Simpler frontend contract; no `PATCH .../thumbnails/add` or `/remove` sub-endpoints.
- **Page artwork / masks in the private bucket** — moved to PUBLIC July 29; admin bubble-mapper and public preview carousel both need to render them, and a signed-URL layer to protect artwork we already give away free is not worth building.
- **Storing bare R2 keys in `Page.artworkUrl` / `maskUrl`** — store the resolved full public URL, matching thumbnails/flags/hero/team/review. The field is named `Url`; make it be one.
- **Absolute-pixel bubble geometry or `fontSize`** — normalized 0–1 fractions only. Pixels are meaningless without a reference resolution and break when artwork is re-uploaded at a different size.
- **Accepting `artworkWidth` / `artworkHeight` from the client** — always Sharp-probed server-side; a client-supplied value cannot be verified and silently corrupts every bubble on the page.
- **Dedicated thumbnail add / remove / reorder endpoints** — all four operations ride the full-array `PATCH /comics/:comicId`. Index-based deletion is race-prone with two admins on one screen.
- **Using `r2.getKeyFromPublicUrl()` outside the SD worker** — it assumes its input is always a URL. Request-body normalization is a separate concern with its own local helper.
- **Blocking a publish on anything beyond thumbnails + pricing** — the remaining 9 checks are permanently the frontend's responsibility. Deliberate, not a gap to close later.
- **Making fonts public to enable `@font-face` preview** — font selection is by name only; the client picks from the per-comic list. Accepted trade-off: no visual overflow check until a printed proof.
- **Webhook-based RunPod result delivery** — polling was chosen. Adding a webhook route later would create two systems doing the same job.
- **`/runsync` for RunPod jobs** — connection timeouts + BullMQ retry semantics turn a held-open HTTP call into an unpredictable failure mode. Especially bad given 60–180s job durations approaching proxy timeouts.
- **Modifying node 473 (negative prompt) per request** — it's a generic quality guardrail; per-page overrides not planned. The positive prompt (node 111) IS patched per request from `Page.pagePrompt`.
- **Font `randomUUID()` in upload keys** — tried and reverted this session. Font upload contract stays sequential (`Date.now()` only); real-world usage is 1–3 fonts per comic, sequential upload is fine, and one less rule reduces cognitive load for the frontend team. Locked as a decision, not a temporary workaround.
- **Mutating the imported `apiWorkflow` JSON object** — it's a shared module-cached reference in Node ESM; mutation would leak state across concurrent jobs. Always `JSON.parse(JSON.stringify(...))` or `structuredClone` before patching.
- **Preview page selection based on `pageNumber <= freePreviewPages`** — `Page.isPreviewPage` boolean is the ONLY source of truth for which pages are free. Admin picks WHICH pages (not necessarily the first N). `Comic.freePreviewPages` is metadata + sanity-check warning only. Query filter must always be `where: { comicId, isPreviewPage: true }`.
- **BullMQ enqueue inside a Prisma `$transaction`** — Redis is a separate system that doesn't roll back with Prisma. Enqueue AFTER DB commit succeeds. Worst case is orphaned QUEUED rows if Redis is down — recoverable, and rare.
- **Job payload carrying anything beyond `pageVersionId`** — worker looks up all related data from DB. Keeps the enqueue+dequeue contract minimal and the worker's row idempotency clean.
- **Session status flip to `GENERATING_PREVIEW` BEFORE enqueue succeeds** — flip AFTER. Otherwise a failed enqueue leaves session stuck in `GENERATING_PREVIEW` and the user hits 409 on retry with no way to recover.
- **Priority values above BullMQ's 21-bit limit** — max is 2,097,151 (2^21 − 1). Any formula using `Date.now()` values directly is 800,000x too big and throws `Priority should be between 0 and 2097152`. Compress to fit.
- **PNG for RunPod API payload** — a stamped 2000×1455 PNG is ~8 MB; base64 pushes past RunPod's 10 MiB API cap. Transcode to JPEG q88 for the round-trip; R2 STORAGE stays PNG at print quality.
- **PNG with Sharp's default compression settings** — `compressionLevel: 6` inflates output vs source. Use `compressionLevel: 9, adaptiveFiltering: true` for R2 storage (lossless, ~20-40% smaller).
- **Native JSON.stringify with BigInt fields** — throws `Do not know how to serialize a BigInt`. Patch `BigInt.prototype.toJSON` globally in `app.ts` to return `.toString()`. `PageVersion.seed` is the only BigInt in the schema.
- **Backend-side photo validation gate** — validation moved to frontend fully. `POST /sessions/:id/photo/validate` renamed to `POST /sessions/:id/photo/confirm`. Frontend runs MediaPipe.js and only calls confirm after passing its own checks.
- **Flat `pageVersions[]` in GET /sessions/:id response** — replaced by nested `pages[].variants[]` shape. Frontend needs to render locked-page overlays, so response must include ALL pages, not just ones with variants.
- **Server-side R2 CopyObject for non-face pages** — download stamped image and re-upload under `/final/` prefix to match the face-branch code path. Session-owned file copy for referential safety if comic gets deleted.
- **Shared `finalImageUrl` pointing at comic-level artwork for non-face pages without bubbles** — every session owns its own copy. Comic deletion would break referential integrity otherwise. Extra R2 traffic is worth the safety.
- **Photo cache keyed by anything other than `sessionId`** — session has exactly one photo; keying by sessionId matches the acquire/release contract. Keying by `photoUrl` adds complexity for no gain.
- **Photo cache without reference counting** — plain LRU or TTL-only cache would either evict mid-job or leak indefinitely. Refcount + TTL safety net handles both burst-completion and crashed-worker scenarios.

---

## FINALIZED APPROACHES

**Architecture** (unchanged from prior sessions)
- Modular monolith, `routes → controllers → services → lib`.
- `server.ts` = entry; `app.ts` = middleware/routes only.
- Validation in `validateBody` middleware only.
- `asyncHandler` inside controller export.
- Three auth tiers.
- Three route files.
- CORS methods include `PATCH`.
- **Worker file is `generationWorker.ts`; internal names retain "SD" prefix** — the SD/HD distinction was dropped when the HD stage was removed. File renamed for readability; queue name (`sd-generation`), enum values (`GENERATING_SD`/`SD_READY`), and enqueue variable (`sdGenerationQueue`) stay to avoid schema migration. Sweep post-launch alongside HD dead code.
- **SD worker helpers split into `src/jobs/workers/sd/`** — one file per concern: `tokens.ts`, `textStamp.ts`, `workflow.ts`, `runpodClient.ts`, `photoCache.ts`. Keeps `generationWorker.ts` as thin orchestrator.
- **ComfyUI workflow template at `src/config/workflows/api-workflow.json`** — imported directly with `with { type: "json" }`, deep-cloned per job via `JSON.parse(JSON.stringify(x))`. Never mutated in place.
- **`BigInt.prototype.toJSON` patched in `app.ts`** — `PageVersion.seed` is BigInt; `JSON.stringify` can't handle BigInts natively. Patch returns string. Frontend must type `seed` as `string | null` if consumed.

**Data & sessions** (unchanged from prior sessions)

**Comic & pricing** (unchanged from prior sessions)
- **Multi-thumbnail model**: `Comic.coverThumbnailUrls String[] @default([])`, first element is primary (catalogue cards), full array shown on detail page. Max 10 thumbnails per comic.
- **Full-replacement update semantics**: `PATCH /api/admin/comics/:comicId` with `thumbnailKeys: [...]` replaces the entire array. Backend diffs old vs new arrays; removed URLs get best-effort R2 cleanup.
- **Batch upload URL endpoint**: `POST /api/admin/comics/thumbnails/upload-urls` accepts `{ files: [{ fileName, contentType }, ...] }` (min 1, max 10), returns `{ uploads: [{ uploadUrl, key }, ...] }`.
- **Delete cleanup**: `deleteComic` best-effort R2 cleanup of all remaining thumbnails before DB delete.
- **Publish gate**: `updateComicStatus` requires `coverThumbnailUrls.length > 0`.

**Generation pipeline**
- Single-flow SD pipeline only. No HD upscale stage. SD output = final print-ready image.
- Pipeline order: Sharp text stamping FIRST (onto raw `Page.artworkUrl`) → for face pages, ComfyUI face-swap SECOND (receives text-stamped image as input) → `finalImageUrl` uploaded to R2.
- Non-face pages skip RunPod entirely: text stamp → re-upload as `finalImageUrl`. `comfyJobId` stays null.
- Variant cap is payment-based: 3 before payment (`MAX_VARIANTS_BEFORE_PAYMENT`), 8 after payment (`MAX_VARIANTS_AFTER_PAYMENT`). Pre-payment variants persist and count toward the post-payment cap.
- `PageVersion` uses `pageId` FK.
- Prompts page-specific only (`Page.pagePrompt`).
- `PageVersion` pipeline fields: `textStampedUrl` (Sharp output = ComfyUI input) → `comfyJobId` (RunPod job ID, null for non-face) → `finalImageUrl` (user-visible, PDF-bound).
- **Per-page generation tunables** — `Page.steps` (Int, default 3, range 1–8) and `Page.cfg` (Float, default 1.0, range 1.0–3.0). Bounds live in `src/config/generation.ts`.
- **`Page.isPreviewPage` is the source of truth for preview pages** — admin flags each page individually. `Comic.freePreviewPages` is a counter used only for sanity-check warnings when it drifts from the actual isPreviewPage count.
- **`Page.hasFace` drives pipeline forking** — face pages need `bestPhotoUrl`, `maskUrl`, `pagePrompt` and go through RunPod. Non-face pages skip all three and finish after text-stamp.
- **Base64-everything transport to ComfyUI** — text-stamped artwork + mask + child photo all travel as base64 strings inside RunPod's `input.images[]` payload. Result also arrives as base64 in polling response; backend decodes → Buffer → uploads to R2 public bucket → stores public URL as `finalImageUrl`.
- **JPEG q88 for RunPod payload** — Sharp transcodes stamped artwork + mask + child photo to JPEG right before RunPod submit. RunPod caps API payloads at 10 MiB; JPEG keeps that comfortably under 1 MB. R2 STORAGE stays PNG at print quality; the JPEG is only for the round-trip. RunPod OUTPUT comes back at ComfyUI's stitched resolution and is saved to R2 as PNG. Filenames sent to RunPod match `.jpg` extension.
- **PNG compression for R2 storage** — `.png({ compressionLevel: 9, adaptiveFiltering: true })` in `textStamp.ts`. Lossless, ~20-40% smaller than Sharp's default level 6.
- **`Page.pagePrompt` is required in Zod (create + update), nullable in DB** — enforced at API boundary, not schema level.
- **Dialogue token contract mirrored between frontend and backend** — four tokens `{name}`, `{pronoun_subject}`, `{pronoun_object}`, `{pronoun_possessive}`. Unknown tokens render literally in the final image.
- **Pronoun table (backend source of truth):** `HE → {subject: he, object: him, possessive: his}`; `SHE → {she, her, her}`; `THEY → {they, them, their}`. Located in `src/jobs/workers/sd/tokens.ts`.
- **Sharp text stamping design:** SVG-per-bubble with `text-anchor: middle`; font embedded as base64 `@font-face` data URI (fonts in private R2 bucket, no accessible URL); multi-line rendering via `<tspan>` with `dy`; auto-shrink loop decrements 1px until fit or hits `MIN_FONT_SIZE * artworkHeight` floor; log warning at floor if still doesn't fit.
- **Approximation for character width:** `avgCharWidthPx = fontSizePx * 0.6`. Rough but adequate for MVP.

**SD worker orchestration (Part E)**
- **`PageVersion` row created BEFORE BullMQ enqueue** — inside a `$transaction` in `enqueuePreviewGenerationJobs`. Enqueue happens after commit. If Redis fails, orphaned QUEUED rows exist in DB (recoverable) but no data lost.
- **Job payload is `{ pageVersionId }` only** — worker fetches everything else from DB. Minimizes queue coupling.
- **Regenerate uses transactional variant-index computation** — count + cap check + row create all inside `$transaction`. Prevents double-click race producing duplicate `variantIndex` values.
- **Session status transition timing:** `PHOTO_UPLOADED → GENERATING_PREVIEW` fires AFTER `enqueuePreviewGenerationJobs` returns successfully, not before. Recoverable on enqueue failure.
- **BullMQ priority formula:** `sessionSecondsInDay + (pageNumber * 80_000)`. Max value = 2,006,399 — fits BullMQ's 21-bit ceiling of 2,097,151. Session component wraps at 24h (matches session TTL); page-number term dominates so users interleave. Implemented as `computeJobPriority(sessionCreatedAt, pageNumber)` helper in `session.service.ts` used by both enqueue and regenerate.
- **BullMQ concurrency = 5 to match RunPod max workers.** Wasted RunPod capacity if lower; wasted BullMQ slots waiting for RunPod if higher.
- **Idempotency guard at top of worker** — if row is already `SD_READY` with `finalImageUrl`, re-emit `page:ready` and return successfully. Handles BullMQ retry-after-ack-lost edge case cheaply.
- **`SD_READY` write clears `errorMessage: null`** — retries that succeed after a prior failure must not leave stale error text on the successful row.
- **Non-face pages skip `GENERATING_SD` status** — go `TEXT_STAMPED → SD_READY` directly. Consistent visibility of pipeline progress in DB.
- **Non-face pages re-upload the stamped image** — into `sessions/{sessionId}/final/{pageVersionId}.png`. Every session owns a full copy of every page; no shared refs to comic-level artwork.
- **Failure path in worker:** wraps pipeline in try/catch/finally. Catch marks row `FAILED` with `errorMessage`, emits `page:error`, re-throws so BullMQ retries per `attempts:3` policy. Finally releases photo cache if it was acquired. `photoAcquired` boolean flag ensures release only fires if acquire succeeded.
- **`markPageVersionFailed` never throws** — nested throw inside a catch handler would mask the original error. DB failure inside cleanup is logged, not re-raised.
- **PREVIEW_READY transition uses `$transaction` + status guard** — `maybeMarkPreviewReady` opens transaction, reads session status, aborts if not `GENERATING_PREVIEW` (someone else already flipped), counts distinct SD_READY pageIds, flips to `PREVIEW_READY` if count reaches `freePreviewPages`. Race-safe. Emits `session:preview-ready` exactly once.
- **`maybeMarkPreviewReady` runs after every SD_READY** — including regenerations post-`PREVIEW_READY`. Status guard makes it a cheap no-op in that case.

**Photo cache (`src/jobs/workers/sd/photoCache.ts`)**
- **In-memory `Map<sessionId, CacheEntry>` with reference counting** — first `acquirePhoto` triggers R2 download and stores Promise; concurrent callers await the same in-flight fetch. `releasePhoto` decrements refCount; entry evicts when refCount hits zero.
- **Promise memoization (not Buffer memoization)** — storing the Promise means concurrent callers get the same in-flight fetch. Once resolved, still just a resolved Promise — `await` returns the value immediately. No branching needed for "download-in-progress" vs "download-done" states.
- **Failed downloads self-evict** — `.catch` on the bufferPromise deletes the cache entry so poison Promises don't sit forever.
- **Safety-net TTL sweep** — every 5 minutes, evict entries idle >15 minutes. Catches leaked entries from crashed workers that never called `releasePhoto`.
- **Cache is process-memory only** — no persistence across restarts. Reference-counted for the duration of a job burst, not for the user's session lifetime. Different concept from the user's OrderSession.

**WebSocket events (`src/websocket/event.ts`)**
- **Three emit helpers:** `emitPageReady`, `emitPageError`, `emitSessionPreviewReady`. All three: get room → bail silently with debug log if no sockets → iterate sockets → send only if `readyState === OPEN`.
- **Event shapes (locked, frontend building against these):**
  - `page:ready` → `{ type, pageNumber, variantIndex, imageUrl, pageVersionId }`
  - `page:error` → `{ type, pageNumber, variantIndex, errorMessage }`
  - `session:preview-ready` → `{ type }` (no payload)
- **Emit is fire-and-forget** — never awaited. WebSocket send is synchronous; awaiting adds latency for no gain.
- **Empty rooms are silent no-ops** — DB has the source-of-truth state; user reconnects via `GET /sessions/:id` if they missed events.

**Session API contracts**
- **`POST /sessions/:id/photo/confirm`** (renamed from `.../photo/validate`) — accepts `{ key }`. Sets `bestPhotoUrl` + `rawPhotoUrls`, flips status to `PHOTO_UPLOADED`. Accepts both `CREATED` and `PHOTO_UPLOADED` current status (allows photo re-upload before generation).
- **`GET /sessions/:id` response shape** — nested `pages[].variants[]` structure, includes ALL pages of the comic (not just preview ones) so frontend can render locked pages with paywall overlay. Each page exposes `pageId`, `pageNumber`, `isPreviewPage`, `hasFace`, `variants[]`. Each variant exposes `pageVersionId`, `variantIndex`, `status`, `finalImageUrl`, `isSelected`, `errorMessage`. Internal fields (`seed`, `textStampedUrl`, `comfyJobId`, `steps`, `cfg`, `pagePrompt`) deliberately excluded. Response includes `comic: { id, title, freePreviewPages, coverThumbnailUrls }` for one-shot rendering.
- **Snapshot + stream contract for frontend** — GET is the complete state (initial load, reconnect after disconnect, return after being away). WebSocket is the delta stream during active generation. Both together = full state sync.

**ComfyUI/RunPod integration**
- **Deployment tool: comfy.getrunpod.io (ComfyUI-to-API)** for wrapping the client's workflow. Base image is `runpod/worker-comfyui:5.8.4-base` (CUDA 12.x).
- **api-workflow.json IS the backend template.** Deep-clone per request, patch per-job fields, send in `input.workflow`. Committed to backend git under `src/config/workflows/`.
- **Fields patched per request (SEVEN):** node 78 (comic page artwork filename), node 435 (child image filename), node 519 (mask filename), node 466 (`noise_seed`), node 471 (`steps` from `Page.steps`), node 467 (`cfg` from `Page.cfg`), node 111 (positive prompt from `Page.pagePrompt`). Node 473 (negative prompt) stays hardcoded.
- **Filename-match rule:** `input.images[].name` must exactly equal the workflow's LoadImage `inputs.image` string.
- **Seed conversion:** `Number(seed)` from BigInt before JSON stringify; keep seeds in safe 53-bit range.
- **Polling over webhook for RunPod result retrieval** — worker submits to `/run`, gets jobId, then polls `GET /status/{jobId}` every 5s until COMPLETED / FAILED / CANCELLED.
- **Polling settings:** `POLL_INTERVAL_MS = 5000`, `MAX_POLL_ATTEMPTS = 200` (17 min ceiling). RunPod endpoint-level `executionTimeout: 600s`.
- **RunPod status response shapes fully mapped:** `IN_QUEUE` → `{id, status}` only; `IN_PROGRESS` adds `delayTime`, `workerId`; `COMPLETED` adds `executionTime` + `output.images[]`; `FAILED` adds `error` string.
- **No client-side TTL in RunPod payload** — endpoint-level `executionTimeout: 600s`.
- **Single face-swap LoRA baked in Docker (client-confirmed)** — `bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors` applies to every comic. Plus Lightning speed-up LoRA also baked.
- **Cold-start mitigation stack (priority):** Active Workers ≥ 1, FlashBoot enabled, Idle Timeout ≥ 90s.
- **A40 GPU tier confirmed stable; RTX 4090 in US-NC-1 has driver heterogeneity** — some workers have CUDA <12.6 drivers and cannot start the container. Fix path: switch region or GPU tier.
- **Client owns the pipeline**: GitHub repo, RunPod endpoint on client account. Backend needs only endpoint URL + API key.
- **Artwork upload size soft cap: 5 MB (admin discipline)** — with JPEG transcode for RunPod, full payload stays well under 10 MiB even for 2000×1455 stamped artwork.

**ComfyUI Dockerfile requirements — client repo baseline** (unchanged)
- Custom-node repos cloned via raw `git clone` MUST have `pip install -r requirements.txt` appended.
- **ReActor specifically** needs `pip install "onnxruntime-gpu<1.27"`.
- **Strip unused downloads.**
- Commit pins on custom nodes kept but must be validated against the workflow.

**Asset storage** (unchanged)
- **Page artwork + masks are PUBLIC**; fonts, child photos and LoRA stay PRIVATE.
- **Frontend always sends a `key`, backend stores the resolved URL.**
- **`thumbnailKeys` accepts either a full public URL or a raw key.**
- **`normalizeThumbnailInput` is local to `comic.service.ts`.** `r2.getKeyFromPublicUrl` stays reserved for the SD worker.
- **Page upload keys carry `randomUUID()`**; **font upload keys stay `Date.now()`-only**.
- **Best-effort R2 cleanup on page update/delete and comic delete.**

**Bubble geometry** (unchanged)
- **Normalized 0–1 fractions** for `x/y/width/height`.
- **`fontSize` is a fraction of artwork HEIGHT**, `Float @default(0.02)`.
- **Bounds enforced in two places**: Zod object-refine on create; merged-value check in `bubble.service.updateBubble` for partial PATCH.
- **`BUBBLE_BOUND_EPSILON = 0.0001`** absorbs float division noise.
- **`Page.artworkWidth`/`artworkHeight` Sharp-probed** on create and on artwork replace.
- **Mask must match artwork dimensions exactly** → 400.
- **Aspect-ratio change warns, never blocks.**

**Frontend contract** (unchanged)
- **`react-konva` recommended** for the bubble mapper.
- **Normalize only at the API boundary** — work in pixels inside the mapper.
- **Better Auth login is via `better-auth/react`'s `createAuthClient`**; `role` is `input: false`.
- **CORS origin lives in two places** — `app.ts` middleware and Better Auth `trustedOrigins`. Update both or login silently breaks.

**Infra** (unchanged from prior sessions)

**CMS** (unchanged from prior sessions)

**SavedAddress** (unchanged from prior sessions)

**Sunglasses/hat detection** — brightness+uniformity heuristic is final.

**Python cleanup** — deferred indefinitely.

**Response envelope** (unchanged from prior sessions)

---

## MISTAKES CAUGHT & CORRECTED

- Bare `new PrismaClient()` in `auth.ts` — fixed.
- Double validation anti-pattern — cleaned up (partially — see loose ends).
- Pino reversed arg order — fixed.
- `.env` quotes break Docker `--env-file` — noted.
- `prisma.config.ts` importing `env.ts` broke Docker build — decoupled.
- `EXPOSE 3000` was wrong — changed to 8080.
- Source must be COPIED before `prisma generate` in Dockerfile.
- `ZodIssue` deprecated in Zod v4 — inline `{ message }` instead.
- Dockerfile with Python was ~2 GB — rewritten to ~250 MB.
- Old MediaPipe API failed — switched to Tasks API.
- Python 3.14 failed — switched to 3.11.9.
- CORS `methods` missing `PATCH` — fixed July 21.
- `POST /api/admin/comics/:comicId/pages` route never registered — fixed July 21.
- Pricing endpoints missing `coverType` after migration — fixed July 21.
- Public comic endpoints missing `coverType` in pricing select — fixed July 21.
- **Node 78's `clipspace/clipspace-painted-masked-*.png` value in api-workflow.json** — test-time artifact; patched at runtime.
- **WebSocket `connection` handler never received `sessionId`** — fixed.
- **`generateSessionHandler`/`regeneratePageHandler` used raw `.parse()`** — fixed with safeParse.
- **`errorHandler.ts` compared `config.nodeEnv === "devlopment"` (typo)** — fixed.
- **`admin.ts` registered `GET /team-members` twice** — split into `/team-members` and `/team-members/active`.
- **`country.controller.ts` sent `messages` (typo key)** — dropped during response-envelope sweep.
- **`getOrderSessionId` variant ordering** — fixed to order by `page.pageNumber` then `variantIndex`.
- **`enqueuePreviewGenerationJobs` `.map()` returning undefined** — fixed to implicit-return the promise.
- **Job name typo** — `"generate--page"` → `"generate-page"`.
- **`textRenderedUrl`/`sdImageUrl`/`hdImageUrl` naming confusion** — renamed to `textStampedUrl`, `finalImageUrl`.
- **RunPod build timed out at 30 min on first attempt** — commented out unused 2509 LoRA + placeholder image downloads.
- **KJNodes `Cannot import ... No module named 'cv2'`** — added `pip install -r requirements.txt`.
- **ReActor `Cannot import ... No module named 'onnxruntime'`** — added explicit `pip install onnxruntime-gpu`.
- **ReActor `ImportError: libcudart.so.13`** — pinned `"onnxruntime-gpu<1.27"`.
- **`fontSize` was left as `Int @default(24)` while bubble coords were being normalized** — caught during schema review, changed to `Float @default(0.02)`.
- **Claude wrote `import sharp from "sharp"` then referenced `sharp.OverlayOptions` in Part C** — fixed to named type import.
- **Claude wrote a `.ts` extension in Part C imports** — should be `.js` per ESM convention.
- **Claude was going to write Part D with 6 patched fields, not 7** — Guts corrected: `pagePrompt` is now required and patched into node 111.
- **Claude misread the first Part C output image and initially flagged pronoun substitution as broken** — corrected mid-message on second look.
- **Claude gave BullMQ priority formula with raw `Date.now()`** — exceeded 21-bit limit (2,097,151). Fixed to `sessionSecondsInDay + (pageNumber * 80_000)`. Should have known the limit before proposing the formula.
- **Claude wrote `session.createdAt` inside `enqueuePreviewGenerationJobs` where the parameter is named `sessionCreatedAt`** — TypeScript caught it. Local naming slip.
- **Claude initially wrote worker guards checking `pagePrompt` and `maskUrl` for every page** — non-face pages don't need them. Split into "always required" vs "only if `hasFace`" branches.
- **Claude initially forgot `errorMessage: null` in the SD_READY write** — stale error text lingered on rows that failed once and retried successfully. Added to SD_READY update.
- **Session status flipped to `GENERATING_PREVIEW` BEFORE enqueue** — enqueue failure left sessions stuck. Moved status flip after enqueue succeeds.
- **PageVersion query used `pageNumber <= freePreviewPages`** — should have been `isPreviewPage: true`. Admin picks WHICH pages, not the first N.
- **BullMQ retry after DB commit + Redis fail hits unique constraint on retry** — orphaned QUEUED rows from prior attempt block re-insertion. Flagged as loose end; needs recovery path (delete-and-recreate or reuse existing).
- **8 MB PNG payload to RunPod exceeded 10 MiB cap** — Sharp's default PNG re-encoding inflated file size, and RunPod limit was reached. Fixed by transcoding to JPEG q88 for the round-trip while keeping R2 storage as PNG.
- **Native JSON.stringify choked on `PageVersion.seed` BigInt** — fixed with `BigInt.prototype.toJSON` patch in `app.ts`.
- **Flat `pageVersions[]` in GET response was hard to render** — restructured to nested `pages[].variants[]` with all 24 pages included so frontend can render the full book with paywall overlays on non-preview pages.

---

## SUPERSEDED (kept only when useful context)

- **"No userId on OrderSession"** (before July 13) → superseded when customer auth added.
- **"Warm Python Flask server needed"** (July 10) → superseded July 13, validation moved to frontend.
- **"Node serverless + Python always-on hosting"** (July 10) → superseded July 13, single Cloud Run service.
- **"Deploy ComfyUI via network volume + base image (Option A)"** → superseded by comfy.getrunpod.io as recommended path.
- **"SD variant cap: 3/page. HD variant cap: 8/page."** → superseded July 25 by payment-based caps.
- **"Sharp text stamping runs LAST after all ComfyUI generation."** → superseded July 25; text is stamped FIRST.
- **"Two endpoints total: face-swap + HD upscale."** → superseded July 25; HD stage removed.
- **"Comic.coverThumbnailUrl String? (single thumbnail per comic)"** → superseded July 28; multi-thumbnail array.
- **"Publish flow includes async ComfyUI asset sync worker"** → superseded July 28 by single-LoRA + base64 architecture.
- **"Page artwork/masks live in the private R2 bucket; `artworkUrl` stores a bare key"** → superseded July 29; public bucket, full URL stored.
- **"Bubble x/y/width/height are pixel coordinates"** → superseded July 29 by normalized fractions.
- **"`Bubble.fontSize Int @default(24)` (pixels)"** → superseded July 29 by `Float @default(0.02)`.
- **"Modifying face-swap positive/negative prompts per request is rejected"** → superseded August 2026 for node 111 (patched from `Page.pagePrompt`). Node 473 (negative) still not modified.
- **"`Page.pagePrompt` is retained-but-unused; face-swap prompts hardcoded in workflow"** → superseded August 2026; now required per page.
- **"BullMQ concurrency must match RunPod Max Workers = 3"** → superseded August 2026; both bumped to 5.
- **"Font upload keys should include `randomUUID()`"** → tried and reverted mid-session August 2026; sequential-only contract stays.
- **"BullMQ priority formula: `orderSession.createdAt.getTime() + (page.pageNumber * 100000)`"** → superseded August 7, 2026 by `sessionSecondsInDay + (pageNumber * 80_000)`. Original formula exceeded BullMQ's 21-bit priority ceiling (2,097,151). Compressed to fit while preserving ordering behavior.
- **"Backend Python photo validation with `POST /sessions/:id/photo/validate`"** → superseded August 7, 2026. Validation moved fully to frontend MediaPipe.js. Endpoint renamed `POST /sessions/:id/photo/confirm`, service `confirmSessionPhoto`, schema `photoConfirmSchema`. Legacy Python service file remains on disk pending overall Python cleanup.
- **"Preview page selection: pages 1 through `freePreviewPages`"** → superseded August 7, 2026 by `isPreviewPage: true` filter. Admin picks specific pages, not necessarily the first N.
- **"Flat `pageVersions[]` in GET /sessions response"** → superseded August 7, 2026 by nested `pages[].variants[]` shape with all comic pages included.
- **"Session status transitions to `GENERATING_PREVIEW` before enqueue"** → superseded August 7, 2026; flip happens AFTER enqueue succeeds so failure is recoverable.