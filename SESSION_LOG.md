# Unilake Backend — Session Log

**Rules:** Last 2 sessions in full detail. Older sessions collapsed to one-liners. Anything worth keeping long-term should already be in `PROJECT_CONTEXT.md`, `DECISIONS.md`, or `CURRENT_STATE.md` — the log is for narrative memory, not source of truth.

---

## Session — July 26, 2026 — Client-account ComfyUI endpoint deployed end-to-end + per-page generation tunables added

**Triggered by:** Guts's client had shared Gemini's take on RunPod deployment; Guts wanted a sanity-check before pushing anything and to actually finish deploying the face-swap endpoint on the client's RunPod account. Then, near end of session, Guts flagged that his client wanted per-page control over `steps` and `cfg` in the workflow — asked to design the schema/validator/service pattern for it.

**Decisions made:**
- Which workflow JSON to use in which context: **Normal export** for comfy.getrunpod.io analysis and Dockerfile generation; **API export** as the backend runtime template. Two different files, two different purposes.
- Client repo (`unilakebooks-web/comfyui-normal-...`) is the canonical location for the deployed pipeline. Backend only stores endpoint URL + API key as env vars.
- Cleared confusion from Gemini's response: build-locally-and-push is a valid fallback (documented by RunPod itself) if the GitHub build path hits the 30-min timeout, but the GitHub integration is the recommended path and does bake models into the image automatically.
- Endpoint config: 48 GB VRAM tier chosen over 24 GB (peak inference VRAM 22–30 GB, safer margin, actually cheaper than 24 GB PRO). Test config Active=0, Max=5, FlashBoot on, Idle 90s, exec timeout 300s. Production config (pending client cost sign-off): Active=1.
- Custom nodes cloned via raw `git clone` in the Dockerfile MUST include `pip install -r requirements.txt`. Not automatic in comfy.getrunpod.io's output.
- ReActor specifically needs `pip install "onnxruntime-gpu<1.27"` — its requirements.txt doesn't list onnxruntime, and the base image is CUDA 12.x (so onnxruntime-gpu 1.27+ which is CUDA-13-built breaks).
- Per-page generation tunables: two dedicated columns (`Page.steps` + `Page.cfg`) with `@default` values matching Prisma pattern used for `loraStrength`. Bounds live as named constants in `src/config/generation.ts`, imported by Zod validator (and later by SD worker). Defaults 3 and 1.0. Ranges 1–8 and 1.0–3.0, reflecting Lightning LoRA training envelope.
- Explicit non-decision: no runtime rebuild for retinaface pre-download yet — the working end-to-end run's 1m 16s execution suggests the auto-download isn't crippling; revisit only if warm-request p95 gets bad.

**Work done:**
- Reviewed Gemini's deployment response with client. Corrected several of its recommendations (Docker Hub path, base64 in LoadImage nodes, Flux+Qwen compat worry) and preserved the one valid catch (retinaface pre-download).
- Diagnosed and resolved 4 sequential deployment failures on client's RunPod endpoint:
  1. Build timed out at 30 min → cut ~815 MB unused downloads (2509 LoRA + 3 placeholder images) + 4 layer-export steps
  2. KJNodes import failed on `cv2` → root cause was Dockerfile skipping `pip install -r requirements.txt` for custom nodes cloned via raw `git clone` (comfy.getrunpod.io's oversight)
  3. ReActor import failed on `onnxruntime` → root cause was ReActor's requirements.txt not listing onnxruntime (installed by install.py normally, which the Dockerfile didn't run) → added explicit `pip install onnxruntime-gpu`
  4. ReActor `ImportError: libcudart.so.13` → root cause was unpinned pip pulling `onnxruntime-gpu 1.27.0` which is CUDA-13-built; base image is CUDA 12.x → pinned to `<1.27`
- End-to-end validated the endpoint with a real request from Apidog: 6.6s delay + 1m 16s execution, returned a base64-encoded face-swapped comic page image. Confirmed via online base64 decoder that the face swap actually worked (kid's face on the astronaut/train conductor).
- Walked through Payload structure and confirmed Guts's `payload.json` was valid before firing (all three LoadImage filenames matched images[] names, correct nesting, no `data:image/` prefix).
- Rough timing projections for 10 preview pages across 5 workers under different warm/cold/FlashBoot combinations, for planning UX expectations.
- Added `Page.steps` + `Page.cfg` schema migration (`add-page-generation-tunables`), constants in `src/config/generation.ts` (`DEFAULT_STEPS`, `MIN_STEPS`, `MAX_STEPS`, `DEFAULT_CFG`, `MIN_CFG`, `MAX_CFG`), updated `createPageSchema` and `updatePageSchema` to accept both fields with imported bounds, updated `page.service.ts` create + update to flow both fields through.
- Explicitly discussed why constants over magic numbers — Guts asked for reasoning, ended up choosing the constants path for defensive-programming reasons.
- Explicitly discussed Claude's role in earlier mistakes — twice in the deployment thread, Claude proposed a Dockerfile fix from a plausible interpretation of a top-level RunPod error without asking for container logs. User pushed back both times and asked for logs first; the logs told a different story both times. Locked the rule.
- End-of-session pep talk when user shared they were feeling underconfident, mid-session — grounded in what was actually shipped rather than reassurance.

**Tasks added to backlog:**
- Apidog verification of per-page tunables (POST default population, PATCH round-trip, out-of-bounds rejection) — 5 min, before writing the SD worker.
- retinaface_resnet50 Dockerfile pre-download — deferred until warm-request p95 becomes a problem.
- GFPGAN location verification — only if face-restoration quality looks off in real generations.
- Update SD worker patch list: nodes 78, 435, 519, 466 PLUS 471 (steps) PLUS 467 (cfg) — 6 fields, not 4.

**Mistakes caught:**
- Claude proposed a Dockerfile commit-pin change based on the RunPod status error (`missing_node_type`) without container logs. Root cause was a missing `pip install`, unrelated to commit versions. User pushed back → logs → correct fix.
- Claude repeated the same mistake right after — proposed `pip install -r requirements.txt` as sufficient without checking whether onnxruntime was actually in the requirements.txt. It wasn't. User pushed back again → build logs → onnxruntime-gpu install.
- Earlier framing of build/deployment as "one or two fixes from working" was too optimistic — three separate errors surfaced sequentially. Corrected calibration when user asked directly for a confidence estimate.
- Guts's initial payload.json had a truncated base64 in `result.b64.txt` (5.89 MB vs actual 7.80 MB) because of a browser copy-paste truncation on very large strings; the image was still viewable via lenient online decoders, but strict local decoders reported corruption. Explained the truncation was client-side and doesn't affect the actual pipeline.

---

## Session — July 25, 2026 — HD pipeline removal + Sharp-before-ComfyUI reversal + schema simplification

**Triggered by:** Guts announced a product simplification — no more HD upscale stage, single SD flow only, and text stamping order flipped (Sharp runs BEFORE ComfyUI so face-swap receives the text-stamped image as its input). Wanted to walk through the change scope, update schema, and clean the code before starting the real SD worker.

**Decisions made:**
- HD stage removed entirely from the product. `hdGenerationQueue`, `hdWorker`, `MAX_HD_VARIANTS_PER_PAGE`, and all HD-related `PageVersion`/`OrderSessionStatus` enum values dropped.
- Pipeline order reversed: Sharp text stamping runs FIRST on raw artwork; ComfyUI face-swap SECOND on the text-stamped image; SD output is final print-ready.
- Variant cap logic changed from SD/HD-stage-based to payment-based. Pre-payment variants persist and count toward the post-payment cap.
- `PageVersion` fields consolidated and renamed: `textStampedUrl`, `comfyJobId`, `finalImageUrl`.
- HD code is COMMENTED OUT, not deleted, until post-launch — preserves rollback path.

**Work done:**
- Deep bug audit of 18 files touching the generation pipeline. Found 3 latent bugs beyond the workflow change:
  1. `getOrderSessionId`'s `pageVersions` ordering interleaved variants across different pages.
  2. `enqueuePreviewGenerationJobs`'s `.map()` callback wrapped `.add()` in braces without a return; `Promise.all` awaited undefined.
  3. Preview enqueue used job name `"generate--page"` (double dash) vs regenerate's `"generate-page"` — inconsistent.
- Wiped database via `npx prisma migrate reset` (pre-launch, safe).
- Applied migration `simplify-pipeline-remove-hd`: `PageVersionStatus` and `OrderSessionStatus` enums updated, `page_versions` fields renamed.
- Updated `src/config/generation.ts` constants renamed to `MAX_VARIANTS_BEFORE_PAYMENT` / `MAX_VARIANTS_AFTER_PAYMENT`.
- Updated `src/services/session.service.ts` (imports, ordering, `.map` bug, job-name, regenerate cap logic).
- Commented out HD blocks in `queues.ts`, `workers/index.ts`, `hdWorker.ts`.
- Added TODO comment to `sdWorker.ts`.
- All changes verified with `npx tsc --noEmit` (clean).

**Tasks added to backlog:**
- Real SD worker implementation (Sharp + ComfyUI + webhook + WS emit).
- Sweep and delete commented-out HD code post-launch.
- Cosmetic: delete stray `// pageNumber   Int` comment in `PageVersion` model.
- Apidog verification of session's fixes.
- Design `PREVIEW_READY` transition logic.
- Design Sharp coordinate scaling.
- Design Sharp variable substitution table.

**Mistakes caught:**
- `getOrderSessionId` was silently returning `PageVersion`s in wrong order.
- `enqueuePreviewGenerationJobs` was `await`ing undefined.
- Old field naming (`sdImageUrl`/`textRenderedUrl`/`hdImageUrl`) would have been actively misleading in the new pipeline.

---

## Older sessions (collapsed)

- **July 24, 2026** — Frontend-impact bug audit, response-envelope standardization (`sendSuccess()` across all 13 controllers), comic thumbnail R2 cleanup on update, authored `FRONTEND_HANDOFF.md` from actual code. Bugs found: WS `connection` missing `sessionId` arg, raw `.parse()` in generate/regenerate handlers, `"devlopment"` typo in error handler, duplicate `/team-members` route, `messages` typo in country controller, incomplete earlier "double-validation cleaned up" claim.
- **July 21, 2026 (afternoon/evening)** — ComfyUI/RunPod deployment via comfy.getrunpod.io: face-swap workflow processed, GitHub repo pushed, Docker "Ready", personal-account testing halted at credit step. Locked decisions: api-workflow.json as backend template, filename-match invariant, cold-start mitigation, client owns the pipeline.
- **July 21 (morning)** — Schema migration (CoverType, OrderSession/Order fields, SavedAddress), `requireLoggedIn`/`attach-user` built, full CRUD completion, CORS `PATCH` fix, admin route reorg.
- **July 13** — Deployment planning (Cloud Run asia-south1, GitHub Actions CI/CD), customer-auth introduction via Better Auth, cover type pricing dimension, `OrderSession.userId` nullable FK, `SavedAddress` design, payment retry model, Docker rewrite Python-stripped ~250MB.
- **July 10** — CMS features (Theme, HeroImage, CustomerReview, TeamMember, Feedback, AnnouncementBar), Comic CRUD expansion, Docker setup complete, ~40+ new endpoints.
- **Days 1–3** — Core scaffold: Express/TypeScript/ESM, Prisma+Neon, two-bucket R2, Redis/BullMQ, Better Auth, Country and Comic base CRUD, public catalogue, `OrderSession` create/update/get, authenticated WebSocket.
- **Day 4 Block 1** — Generate-trigger + per-page regenerate endpoints. `PageVersion` schema fix.
- **Day 4 Block 2** — Page/Bubble/Font admin CRUD, unified comic update, LoRA upload. Double-validation cleanup (later found incomplete).
- **Day 4 Block 3** — Real Python photo validation, later moved to frontend.