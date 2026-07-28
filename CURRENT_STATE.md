# Unilake Backend — Current State

**Rewritten every session.** Overwrite, don't append. Keep it small.

**Last updated:** July 26, 2026 (post RunPod client-endpoint deployment + per-page tunables session)

---

## DONE

**Infrastructure & scaffold:**
- Express + TypeScript ESM, `app.ts`/`server.ts` split, centralized error handling, `asyncHandler`
- Prisma schema on Neon Postgres
- Two-bucket R2 setup + `r2.ts` helper library
- Redis + BullMQ: `sd-generation` + `pdf-compilation` queues, stub workers, graceful shutdown
- Better Auth: Google + Facebook + email/password, custom `role` field
- Docker: multi-stage, Python stripped, ~250 MB, deployed to Cloud Run `asia-south1`
- GitHub Actions CI/CD → Artifact Registry → Cloud Run

**Auth:**
- `requireAdmin`, `requireLoggedIn` middleware
- Three-tier route structure (`/api/admin`, `/api/user`, `/api/public`)
- `PATCH /api/public/sessions/:id/attach-user`
- `createOrderSession` optionally reads cookie for auto-attach

**Full CRUD complete (admin + public where relevant):**
- Country, Theme, Comic, Page, Bubble, Font, AnnouncementBar, HeroImage, CustomerReview, TeamMember, Feedback
- SavedAddress CRUD (5 endpoints) with ownership + auto-default + default-promotion

**Order flow (partial):**
- `OrderSession` create/patch/get, WebSocket server with token auth
- Photo upload URL + Python validation pipeline (still live — see Open Questions)
- Generate trigger + per-page regenerate endpoints (enqueue jobs only — SD worker is a stub)

**ComfyUI/RunPod endpoint (LIVE on client infra):**
- Deployed via comfy.getrunpod.io → GitHub → RunPod GitHub integration on `unilakebooks-web` org
- End-to-end proven: real payload (comic page + kid photo + mask) → 6.6s delay + 1m 16s execution → face-swapped image returned
- Endpoint ID `bwdfkrlaocqm3o`, base image `runpod/worker-comfyui:5.8.4-base` (CUDA 12.x)
- Test config live: Active=0, Max=5, FlashBoot on, 48 GB tier ($1.22/hr), 90s idle, 300s exec timeout, RTX 3090/L4/A5000/PRO 6000 MIG enabled
- Warm-request latency measured at ~86s per job
- Rough projected timing for 10 preview pages across 5 workers: fully warm ~3 min, FlashBoot cold ~2.5–3.5 min, fully cold ~5–8 min

**This session — per-page generation tunables (all `npx tsc --noEmit` clean, migration applied):**
- Added `Page.steps` (Int, default 3) and `Page.cfg` (Float, default 1.0) via migration `add-page-generation-tunables`
- Bounds constants in `src/config/generation.ts`: `DEFAULT_STEPS=3`, `MIN_STEPS=1`, `MAX_STEPS=8`, `DEFAULT_CFG=1.0`, `MIN_CFG=1.0`, `MAX_CFG=3.0`
- `createPageSchema` + `updatePageSchema` accept both fields, bounds-enforced via imported constants
- `page.service.ts` create + update flow both new fields through
- Bounds reflect Lightning LoRA training envelope — Zod blocks out-of-range values before they reach RunPod

---

## IN PROGRESS

Nothing actively in progress. Ready to start real SD worker pipeline.

---

## NEXT (priority order)

1. **Update CORS allowed origins** once frontend has a real deploy URL — currently hardcoded to `http://localhost:3000` only (`app.ts:26`). `credentials: true` already set. (~15 min)
2. **Seed real comic data** (~3–4 h)
3. **SD worker real implementation** — the big one (~24–32 h combined with Sharp):
   - Sharp text renderer: load font from R2, read bubble coords + dialogue template, replace `{name}`/`{pronoun_*}` tokens, render SVG text, composite onto `Page.artworkUrl`, upload result to R2 as `textStampedUrl`.
   - ComfyUI submission: deep-clone `api-workflow.json`, patch nodes 78/435/519/466 + 471 (steps) + 467 (cfg), upload three images, submit to RunPod endpoint `bwdfkrlaocqm3o` with webhook URL, store returned job ID as `comfyJobId`.
   - RunPod webhook endpoint: receive completed image, decode base64 from `output.images[0].data`, upload to R2 as `finalImageUrl`, update `PageVersion.status = SD_READY`, emit `page:ready` WebSocket event.
4. Checkout / confirm endpoints (~6–8 h) — `POST /sessions/:id/checkout`, `POST /sessions/:id/confirm`.
5. Razorpay integration (~10–14 h) — webhook with signature verification, `WebhookEvent` idempotency.
6. Paid page generation (~4–6 h) — reuse SD pipeline for pages 11–24 with 8-variant cap.
7. PDF compilation (~6–8 h) — pdf-lib, upload to R2 with 30-day retention, 7-day signed download.
8. User + admin order endpoints (~6–8 h)
9. Shiprocket integration (~10–14 h) — auth, order creation, tracking webhook, international routing.
10. Email notifications (~6–8 h) — provider selection, PDF-ready + tracking-shipped emails.
11. Publish flow (~6–8 h) — admin one-click publish, `ComicStatus` transition.
12. Stabilization (~8–10 h) — end-to-end testing, session expiry cleanup, edge cases.

**Total remaining: ~85–115 h. At 12 h/day: ~7–10 working days. At 8–10 h/day: ~10–14 working days.**

---

## OPEN QUESTIONS (currently unresolved)

- **Photo validation ownership** — docs/decisions say this moved to frontend MediaPipe.js, but `POST /sessions/:id/photo/validate` still runs the full legacy Python pipeline server-side and still gates `status → PHOTO_UPLOADED` on it. Decide: turn off now, or keep as secondary gate.
- **`https://unilake-backend.onrender.com`** in Better Auth `trustedOrigins` — confirm live vs stale.
- **Client-project cost sign-off**: ~$250/month baseline for 1 active RunPod worker (48 GB tier @ $1.22/hr) — needs client approval before flipping Active=0 → Active=1 in production.
- **retinaface_resnet50 cold-start pre-download** — not baked into Docker image. First request per fresh worker pays 60–120s auto-download from HuggingFace. Currently acceptable; revisit if user-visible latency becomes an issue.
- **GFPGAN location** — currently at `models/insightface/`. ReActor's expected path may be `models/facerestore_models/`. No error observed in the working end-to-end test but not explicitly confirmed working. If face-restoration quality looks off in real generations, move it.
- **`PREVIEW_READY` status transition** — nothing currently transitions a session out of `GENERATING_PREVIEW`. Needs designing in SD worker completion logic (last page done → flip session status).
- **Sharp coordinate scaling** — bubble-mapper pixels (admin drew on browser-rendered image) → output resolution. Not designed.
- **Sharp variable substitution** — `{name}`, `{pronoun_subject}`, `{pronoun_object}`, `{pronoun_possessive}` mapping from `PronounKey` enum. Need lookup table.
- **Variant generation eagerness** — do we auto-generate variant 0 for all pages on trigger, or lazy per-request? Current code queues variant 0 only.
- **BullMQ concurrency alignment** — worker concurrency is 3, must match client's RunPod Max Workers when flipped to production.
- Razorpay order ID reuse vs regeneration on payment retry.
- Shiprocket international address fields — customs declaration format; country name vs ISO codes.
- `validateQuery` middleware — not built, deferred.
- WebSocket room map is in-memory → needs Redis pub/sub for multi-instance (Cloud Run pinned to 1 for now).
- Email provider — not chosen.
- International Razorpay — external account setup needed.
- No signed-download endpoint for private-bucket assets (fonts, raw child photos).
- Python cleanup timing — deferred, code retained.
- **Client comic-metadata cleanup** — the LoadImage nodes in the deployed workflow still reference `Astranaut.png` / `Sunny Kid 1.jpeg` / `Astranaut - Mask.png` as placeholder filenames. Worker code patches these at runtime; ensure the filename-match invariant lands correctly when writing the worker.

---

## VERIFY / LOOSE ENDS

- **Per-page tunables end-to-end test not run** — this session verified via `npx tsc --noEmit` only. Before starting the SD worker, hit PATCH `/api/admin/pages/:pageId` with `steps: 999` and confirm 400. Confirm defaults populate on POST with no fields. (~5 min)
- **HD code is commented, not deleted** — `queues.ts`, `workers/index.ts`, `hdWorker.ts` still have commented-out HD blocks. Sweep post-launch.
- **Stray `// pageNumber   Int` comment** in `PageVersion` model in `schema.prisma` — cosmetic, delete when convenient.
- `page.controller.ts`, `bubble.controller.ts`, `font.controller.ts` still double-validate — low risk, not yet cleaned up.
- **BigInt seed → JSON**: `PageVersion.seed` is BigInt; must `Number(seed)` before serializing into workflow. Watch 53-bit precision limit. Bake into `sdWorker.ts`.
- **Filename-match invariant**: `input.images[].name` MUST equal the workflow's LoadImage `inputs.image` string exactly. Bake into worker code as a single variable, not two.
- **`comfyJobId` semantics**: stores RunPod job ID, not ComfyUI native `prompt_id`. Document in `sdWorker.ts` when writing it.
- **RunPod response shape reference**: `output.images[0].data` is base64 PNG, `output.images[0].filename` is `ComfyUI_XXXXX_.png`, `output.images[0].type` is `"base64"`. Worker decodes → uploads to R2.
- **Client-side Dockerfile evolution** — `unilakebooks-web/comfyui-normal-...` repo `main` branch is the working version. Commit log documents: unused 2509 LoRA line commented, custom-node `pip install -r requirements.txt` added, `pip install "onnxruntime-gpu<1.27"` added for CUDA 12 compat.