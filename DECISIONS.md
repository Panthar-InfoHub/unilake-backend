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
- **Serverless as default deployment mode without warm worker** — cold starts on 40+ GB Qwen model = 60-180s; incompatible with live-preview UX. Active Workers ≥ 1 in production.
- **Pointing production endpoint at comfy.getrunpod.io's Docker Hub image** — client should own full pipeline; rebuild on client's RunPod GitHub integration instead.
- **Client sending workflow-JSON round-trips through their own backend routing** — Express backend sends workflow directly to RunPod endpoint via HTTPS; RunPod is the transport, not comfy.getrunpod.io at runtime.
- **Modifying face-swap positive/negative prompts per request** — they're generic head-swap instructions, not content prompts; per-page tone/emotion prompting is a concern of the (separate) style-conversion workflow.
- **Waiting for comfy.getrunpod.io's Docker build to finish before deploying to RunPod** — comfy.getrunpod.io's build is independent; RunPod builds from GitHub separately.
- **Raw `schema.parse()` left uncaught in a controller** — must be `safeParse` + thrown `ValidationError`, or wrapped in try/catch converting `ZodError`; otherwise it escapes as an uncaught 500 instead of a 400.
- **Ad hoc per-controller success response shapes** — replaced by the shared `sendSuccess()` envelope; never hand-roll a one-off `res.json({...})` for a success path again.
- **Omitting `sessionId` when re-emitting the WebSocket `connection` event** — `wss.handleUpgrade`'s callback must pass `sessionId` through to `wss.emit("connection", ws, req, sessionId)`, or every socket silently joins the same "undefined" room.

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

**Data & sessions** (unchanged from prior sessions)

**Comic & pricing** (unchanged from prior sessions)

**Generation** (unchanged base + new ComfyUI/RunPod decisions below)
- SD variant cap: 3/page. HD variant cap: 8/page.
- Free preview count from `Comic.freePreviewPages`.
- `PageVersion` uses `pageId` FK.
- Prompts page-specific only (`Page.pagePrompt`).
- Sharp text stamping runs LAST after all ComfyUI generation.

**ComfyUI/RunPod integration (new this session)**
- **Deployment tool: comfy.getrunpod.io (ComfyUI-to-API)** for wrapping the client's workflow into a deployable GitHub repo + Dockerfile. Not a manual Dockerfile build, not a network-volume path. Base image is `runpod/worker-comfyui`.
- **"runpod.serverless.start() not found" warning is a false positive** for `worker-comfyui`-based repos — the handler lives in the base image. Ignore the warning; deploy proceeds.
- **api-workflow.json IS the backend template.** Deep-clone per request, patch per-job fields, send in `input.workflow`. Committed to backend git under `src/config/workflows/`.
- **Fields patched per request:** node 435 (child image filename), node 519 (mask filename), node 78 (comic page artwork filename), node 466 (noise_seed). Prompts (111, 473) stay hardcoded.
- **Filename-match rule:** `input.images[].name` must exactly equal the workflow's LoadImage `inputs.image` string — same variable in both places in code.
- **Seed conversion:** `Number(seed)` from BigInt before JSON stringify; keep seeds in safe 53-bit range.
- **Reference Body (node 78) must load `Page.artworkUrl`** as a third `input.images[]` file — the current `clipspace/clipspace-painted-masked-*.png` value is a test artifact and would fail in production.
- **RunPod job ID stored in `comfyPromptId1/2/3`** — schema unchanged, semantics shift from ComfyUI native prompt_id to RunPod job id.
- **Async pattern via webhook**, not `/runsync` polling — matches project doc's pre-existing webhook design.
- **Cold-start mitigation stack (priority):** Active Workers ≥ 1 (biggest impact), Flash Boot enabled, Idle Timeout ≥ 60s. Cached Model feature not used.
- **Production endpoint config target:** Active=1, Max=3-5, Idle=90s, RTX 4090, Flash Boot on. Test config: Active=0, Max=1.
- **Two endpoints total:** one for face-swap+style-conversion (this session), one for HD upscale (future). Each = separate GitHub repo, separate Dockerfile, separate RunPod endpoint.
- **BullMQ concurrency should align with RunPod Max Workers** — don't queue more concurrently than RunPod can service.
- **Client owns the pipeline**: GitHub repo on client org, RunPod on client account, HF tokens (if any) on client. Backend needs only endpoint URL + API key as env vars.
- **Dockerfile cleanup before client-account deployment:** remove 2509 duplicate model downloads (~20 GB, unused). Confirmed by scanning api-workflow.json for "2509" references.

**Infra** (unchanged from prior sessions)

**CMS** (unchanged from prior sessions)

**SavedAddress** (unchanged from prior sessions)

**Sunglasses/hat detection** — brightness+uniformity heuristic is final.

**Python cleanup** — deferred indefinitely.

**Response envelope (new this session)**
- All success responses standardized to `{ success: true, data, message? }` via `sendSuccess(res, statusCode, data, message?)` in `src/utils/response.ts`. Swept across all 13 controllers.
- R2 cleanup-on-replace pattern (previously TeamMember/CustomerReview only) now also applies to Comic thumbnails — `updateComic` best-effort-deletes the old public-bucket file after a successful `thumbnailKey` update.
- CORS production origin update deliberately deferred — `localhost:3000` remains the only allowed origin until the frontend has a real deploy URL to add; explicit call this session, not an oversight.

---

## MISTAKES CAUGHT & CORRECTED

- Bare `new PrismaClient()` in `auth.ts` — fixed.
- Double validation anti-pattern — cleaned up.
- Pino reversed arg order — fixed.
- `.env` quotes break Docker `--env-file` — noted.
- `prisma.config.ts` importing `env.ts` broke Docker build — decoupled.
- `EXPOSE 3000` was wrong — changed to 8080.
- Source must be COPIED before `prisma generate` in Dockerfile.
- `ZodIssue` deprecated in Zod v4 — inline `{ message }` instead.
- Dockerfile with Python was ~2GB — rewritten to ~250MB.
- Old MediaPipe API failed — switched to Tasks API.
- Python 3.14 failed — switched to 3.11.9.
- CORS `methods` missing `PATCH` — fixed July 21.
- `POST /api/admin/comics/:comicId/pages` route never registered — fixed July 21.
- Pricing endpoints missing `coverType` after migration — fixed July 21.
- Public comic endpoints missing `coverType` in pricing select — fixed July 21.
- **First push-to-github attempts to comfy.getrunpod.io failed with 502 Bad Gateway** — root cause was missing input-image uploads in workflow submission, not GitHub permissions or their infrastructure.
- **STUCK_NO_CALLBACK build failures on comfy.getrunpod.io** — infrastructure issue on their side (Blacksmith runner death), not user error. Resolved by retrying on a fresh session.
- **Node 78's `clipspace/clipspace-painted-masked-*.png` value in api-workflow.json** — test-time artifact from ComfyUI's browser painting tool; would fail in production if left unchanged. Must be patched at runtime with `Page.artworkUrl` filename.
- **Dockerfile downloads 2509 Qwen model + LoRA that workflow doesn't use** — comfy.getrunpod.io's analyzer over-included based on filename mention. Safe to remove; do so before client-account deployment.
- **Claude initially under-emphasized comfy.getrunpod.io tool** — steered toward manual network-volume path when the tool was labeled "Easiest & Recommended" in RunPod's own docs for this exact use case. Corrected mid-session.
- **WebSocket `connection` handler never received `sessionId`** — every socket was joining a room literally named "undefined"; `page:ready`/`page:error` events were silently undeliverable. Fixed by passing `sessionId` through `wss.emit(...)`.
- **`generateSessionHandler`/`regeneratePageHandler` used raw `.parse()`** — malformed `sessionId`/`pageNumber` produced an uncaught `ZodError` → 500 instead of 400. Fixed with `safeParse` + `ValidationError`.
- **`errorHandler.ts` compared `config.nodeEnv === "devlopment"` (typo)** — dev-mode error detail was permanently disabled, even locally. Fixed.
- **`admin.ts` registered `GET /team-members` twice** — second handler (`getActiveTeamMembersHandler`) was dead code, unreachable. Split into `/team-members` and `/team-members/active`.
- **`country.controller.ts` sent `messages` (typo key, also misspelled "successfully")** instead of `message` — dropped during the response-envelope sweep.
- **Earlier "Double validation anti-pattern — cleaned up" entry was incomplete** — `page.controller.ts`, `bubble.controller.ts`, and `font.controller.ts` still call `schema.parse()` a second time on already-validated `req.body` in their create/upload-url handlers. Low risk since data's already valid, but the earlier claim was inaccurate. Not yet fixed.

---

## SUPERSEDED (kept only when useful context)

- **"No userId on OrderSession"** (before July 13) → superseded when customer auth added.
- **"Warm Python Flask server needed"** (July 10) → superseded July 13, validation moved to frontend.
- **"Node serverless + Python always-on hosting"** (July 10) → superseded July 13, single Cloud Run service.
- **"requireLoggedIn (planned)"** → built and operational July 21.
- **"PricingRule data migration strategy"** → resolved July 21.
- **"Deploy ComfyUI via network volume + base image (Option A)"** → superseded by comfy.getrunpod.io (Option C) as recommended path. Network volume remains a valid fallback if comfy.getrunpod.io builds keep failing on Qwen scale.
- **"Assumption that Docker build must complete on comfy.getrunpod.io before RunPod deployment"** → superseded; RunPod builds from GitHub independently.