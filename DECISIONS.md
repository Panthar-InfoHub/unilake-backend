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
- **Modifying face-swap positive/negative prompts per request** — they're generic head-swap instructions, not content prompts; per-page tone/emotion prompting is a concern of the (separate) style-conversion workflow.
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
- **Guessing a fix from a RunPod status error alone** — the top-level error message (`missing_node_type`, etc.) is often ambiguous. Always pull container logs and read the actual Python traceback before proposing a fix. Verified twice this session as the correct instinct.
- **Magic numbers in Zod validator bounds for generation-tunable fields** — bounds like `min(1).max(8)` for steps must live as named constants in `src/config/generation.ts` and be imported. The SD worker will import the same constants for defensive checks.
- **Raw `git checkout <hash>` without confirming the commit contains the exact nodes/classes the workflow references** — comfy.getrunpod.io picks a commit that exists, not one validated against your workflow. If time-pinning, verify the target commit against a known-working local run.

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

**Generation** (updated this session)
- Single-flow SD pipeline only. No HD upscale stage. SD output = final print-ready image.
- Pipeline order: Sharp text stamping FIRST (onto raw `Page.artworkUrl`) → ComfyUI face-swap SECOND (receives text-stamped image as input) → `finalImageUrl` uploaded to R2.
- Variant cap is payment-based: 3 before payment (`MAX_VARIANTS_BEFORE_PAYMENT`), 8 after payment (`MAX_VARIANTS_AFTER_PAYMENT`). Pre-payment variants persist and count toward the post-payment cap.
- Free preview count from `Comic.freePreviewPages`.
- `PageVersion` uses `pageId` FK.
- Prompts page-specific only (`Page.pagePrompt`).
- `PageVersion` pipeline fields: `textStampedUrl` (Sharp output = ComfyUI input) → `comfyJobId` (RunPod job ID) → `finalImageUrl` (user-visible, PDF-bound).
- **Per-page generation tunables** — `Page.steps` (Int, default 3, range 1–8) and `Page.cfg` (Float, default 1.0, range 1.0–3.0). Bounds live in `src/config/generation.ts` as `MIN_STEPS` / `MAX_STEPS` / `MIN_CFG` / `MAX_CFG` — enforced in Zod, referenced by SD worker at patch time. Ranges reflect the Lightning LoRA training envelope; going outside degrades output. Client-configurable via admin PATCH per page.

**ComfyUI/RunPod integration (updated this session)**
- **Deployment tool: comfy.getrunpod.io (ComfyUI-to-API)** for wrapping the client's workflow into a deployable GitHub repo + Dockerfile. Not a manual Dockerfile build, not a network-volume path. Base image is `runpod/worker-comfyui:5.8.4-base` (CUDA 12.x).
- **Upload Normal export (`File > Export`), NOT API export**, to comfy.getrunpod.io — the tool's analyzer needs the full graph, not the stripped API format.
- **api-workflow.json IS the backend template.** Deep-clone per request, patch per-job fields, send in `input.workflow`. Committed to backend git under `src/config/workflows/`. The client's Export API JSON (not the tool's derived one) is the source of truth.
- **Fields patched per request:** node 78 (comic page artwork filename), node 435 (child image filename), node 519 (mask filename), node 466 (`noise_seed`), node 471 (`steps` from `Page.steps`), node 467 (`cfg` from `Page.cfg`). Prompts (111, 473) stay hardcoded.
- **Filename-match rule:** `input.images[].name` must exactly equal the workflow's LoadImage `inputs.image` string — same variable in both places in code.
- **Seed conversion:** `Number(seed)` from BigInt before JSON stringify; keep seeds in safe 53-bit range.
- **Async pattern via webhook**, not `/runsync` polling.
- **Cold-start mitigation stack (priority):** Active Workers ≥ 1 (biggest impact), FlashBoot enabled, Idle Timeout ≥ 90s.
- **Production endpoint config target:** Active=1, Max=3–5, Idle=90s, FlashBoot on, 48 GB VRAM tier (~$1.22/hr) — 48 GB tier chosen over 24 GB because peak inference VRAM sits at 22–30 GB. Test config: Active=0, Max=5, execution timeout 300s.
- **Test config live on client account** as of this session — deployed and end-to-end validated with a real request producing a face-swapped image (delay 6.6s, execution 1m 16s, warm ~86s).
- **Client owns the pipeline**: GitHub repo (`unilakebooks-web/comfyui-normal-for-docker-image-bfs-v5-draft-18-workflow-inpaint-mas`), RunPod endpoint (`bwdfkrlaocqm3o`) on client account. Backend needs only endpoint URL + API key as env vars.
- **Response shape** — `output.images[]` array, each element has `filename`, `type: "base64"`, `data` (raw base64 PNG). Worker decodes → uploads to R2 as `finalImageUrl`.
- **RunPod build timeout** — 30-min hard limit on GitHub-integration builds; not user-configurable. Fallback if hit: build locally, push to Docker Hub / GHCR, deploy from registry.

**ComfyUI Dockerfile requirements — client repo baseline (new this session)**
- Custom-node repos cloned via raw `git clone` MUST have `pip install -r requirements.txt` appended in the same RUN step.
- **ReActor specifically** needs `pip install "onnxruntime-gpu<1.27"` in addition to its requirements.txt — onnxruntime is not in the requirements.txt file, it's normally installed by ReActor's `install.py` script.
- **Strip unused downloads** — anything not referenced by the workflow. Currently commented in the client repo: the 2509 Lightning LoRA (line 19) and the three convex.cloud placeholder input images (lines 27–29).
- Commit pins on custom nodes (`git checkout <hash>`) kept but must be validated against the workflow before shipping — not automatic.

**Infra** (unchanged from prior sessions)

**CMS** (unchanged from prior sessions)

**SavedAddress** (unchanged from prior sessions)

**Sunglasses/hat detection** — brightness+uniformity heuristic is final.

**Python cleanup** — deferred indefinitely.

**Response envelope** (unchanged from prior sessions)

---

## MISTAKES CAUGHT & CORRECTED

- Bare `new PrismaClient()` in `auth.ts` — fixed.
- Double validation anti-pattern — cleaned up (partially — see July 24 note).
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
- **STUCK_NO_CALLBACK build failures on comfy.getrunpod.io** — infrastructure issue on their side (Blacksmith runner death), not user error. Resolved by retrying on a fresh session.
- **Node 78's `clipspace/clipspace-painted-masked-*.png` value in api-workflow.json** — test-time artifact from ComfyUI's browser painting tool; would fail in production if left unchanged. Patched at runtime with `Page.artworkUrl` filename.
- **Claude initially under-emphasized comfy.getrunpod.io tool** — steered toward manual network-volume path when the tool was labeled "Easiest & Recommended" in RunPod's own docs for this exact use case. Corrected mid-session.
- **WebSocket `connection` handler never received `sessionId`** — fixed.
- **`generateSessionHandler`/`regeneratePageHandler` used raw `.parse()`** — fixed with safeParse.
- **`errorHandler.ts` compared `config.nodeEnv === "devlopment"` (typo)** — fixed.
- **`admin.ts` registered `GET /team-members` twice** — split into `/team-members` and `/team-members/active`.
- **`country.controller.ts` sent `messages` (typo key)** — dropped during response-envelope sweep.
- **Earlier "Double validation anti-pattern — cleaned up" entry was incomplete** — `page.controller.ts`, `bubble.controller.ts`, and `font.controller.ts` still call `schema.parse()` a second time; not yet fixed.
- **`getOrderSessionId` variant ordering** — fixed to order by `page.pageNumber` then `variantIndex`.
- **`enqueuePreviewGenerationJobs` `.map()` returning undefined** — fixed to implicit-return the promise.
- **Job name typo** — `"generate--page"` → `"generate-page"`.
- **`textRenderedUrl`/`sdImageUrl`/`hdImageUrl` naming confusion** — renamed to `textStampedUrl`, `finalImageUrl`.
- **RunPod build timed out at 30 min on first attempt** — root cause was image size + layer export duration, not a code error. Fixed by commenting out unused 2509 LoRA download and 3 convex.cloud placeholder image downloads.
- **KJNodes `Cannot import ... No module named 'cv2'`** — root cause was comfy.getrunpod.io Dockerfile cloning custom nodes without `pip install -r requirements.txt`. Fixed by adding it.
- **ReActor `Cannot import ... No module named 'onnxruntime'`** — requirements.txt fix uncovered a second layer: onnxruntime is not in ReActor's requirements.txt; it's installed by `install.py` normally. Fixed with explicit `pip install onnxruntime-gpu`.
- **ReActor `ImportError: libcudart.so.13`** — installed `onnxruntime-gpu` without version pinning, pip pulled 1.27.0 which is CUDA-13-built; base image is CUDA 12. Fixed with `pip install "onnxruntime-gpu<1.27"`.
- **Claude proposed a Dockerfile fix (unpin commits) from a RunPod status error without container logs** — the actual cause turned out to be missing `pip install`, not a version mismatch. User pushed back and asked for logs; the logs told a different story. Documented as a rule.
- **Claude repeated the same mistake pattern shortly after** — proposed `pip install -r requirements.txt` as sufficient without checking whether the requirements.txt actually listed the missing module. It didn't (`onnxruntime` wasn't listed). User caught it again by asking for logs. Same rule applies: read the artifact before proposing the fix.

---

## SUPERSEDED (kept only when useful context)

- **"No userId on OrderSession"** (before July 13) → superseded when customer auth added.
- **"Warm Python Flask server needed"** (July 10) → superseded July 13, validation moved to frontend.
- **"Node serverless + Python always-on hosting"** (July 10) → superseded July 13, single Cloud Run service.
- **"requireLoggedIn (planned)"** → built and operational July 21.
- **"PricingRule data migration strategy"** → resolved July 21.
- **"Deploy ComfyUI via network volume + base image (Option A)"** → superseded by comfy.getrunpod.io (Option C) as recommended path. Network volume remains a valid fallback.
- **"Assumption that Docker build must complete on comfy.getrunpod.io before RunPod deployment"** → superseded; RunPod builds from GitHub independently.
- **"SD variant cap: 3/page. HD variant cap: 8/page."** → superseded July 25 by payment-based caps.
- **"Sharp text stamping runs LAST after all ComfyUI generation."** → superseded July 25; text is stamped FIRST.
- **"Two endpoints total: face-swap + HD upscale."** → superseded July 25; HD stage removed.
- **"RunPod job ID stored in `comfyPromptId1/2/3`."** → superseded July 25; consolidated to `comfyJobId`.
- **"ComfyUI face-swap endpoint pending deployment on client's RunPod account (~4–8h)."** → superseded July 26; deployed, validated end-to-end, currently in test config on client account.