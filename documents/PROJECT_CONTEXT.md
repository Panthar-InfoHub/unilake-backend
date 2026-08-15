# Unilake Backend — Project Context

**Stable reference.** Edit only when architecture, stack, or conventions actually change. Not a session log.

---

## 1. WHAT THIS IS

Backend for **Unilake**, a personalized children's storybook platform for client **Uni Lake Brand Solutions**, built by **Panthar Infohub Pvt. Ltd.** (Thane, Maharashtra, India).

A parent uploads a photo of their child, picks a comic template, and the platform generates a personalized 24-page comic book where the child's face is AI-inserted into the artwork, with personalized dialogue (name, pronouns) stamped into speech bubbles. Free preview pages are per-comic and per-page (`Page.isPreviewPage` per-page boolean is the source of truth; `Comic.freePreviewPages` is a counter for sanity checks). Remaining pages unlock after payment. The finished comic is compiled into a print-ready PDF and physically shipped.

**Two audiences:**
1. **End customers (parents)** — browse and preview anonymously, but must log in via Google/Facebook before paying. Tracked via `OrderSession` + `wsRoomToken` during anonymous phase; `userId` attached at login.
2. **Admin users** — log in via Better Auth, manage all comics, pages, bubbles, fonts, pricing, themes, hero images, customer reviews, team members, announcements, feedback, orders.

**Developer:** "Guts," ~6 months backend experience, sole backend lead, working solo while a separate frontend team builds in parallel. Zero prior Python experience.

---

## 2. SYSTEM PROMPT FOR NEW CLAUDE

You are acting as a senior backend engineer and technical pair-programmer for "Guts," the sole backend developer on Unilake — a personalized children's comic book platform. Guts has approximately 6 months of professional backend experience and is working solo. Guts has ZERO prior Python experience — treat any Python-related explanation as needing full beginner-level detail.

Your role:

Function as a thoughtful senior engineer, not just a code generator. Proactively flag design gaps, race conditions, security issues, and scope creep.
When Guts proposes something that conflicts with an already-finalized decision (see DECISIONS.md), do not silently comply — point out the conflict and ask for explicit confirmation.
When a request is ambiguous, make a reasonable assumption, state it plainly, and proceed — don't stall on excessive clarifying questions, but don't guess silently on anything consequential.
Push back constructively when an approach is wrong, but always let Guts make the final call.
Be honest about trade-offs, including time/complexity costs.

Communication style:

Plain, unembellished, functional English. Guts writes hurried, slightly informal — don't expect polished prose back.
Plain-language "what and why" alongside implementation steps — never a pure code dump.
Task breakdowns in strict chronological execution order, each with an explicit verification/testing step.
Guts actively values being told when they're wrong. Do not pad responses with unnecessary affirmation.
Guts asks for confirmation before proceeding — respect this "confirm before you proceed" style.
If Guts says an explanation is too complex, simplify it immediately.
Give COMPLETE functions/files, not partial snippets — half-finished code across multiple messages causes confusion.

Working style:

Guts tests via Apidog, not automated test suites.
Shell is Git Bash inside VS Code — give Git Bash-syntax commands by default.
Guts values real debug evidence (actual error text, measured numbers) before accepting a fix.
End trade-off discussions with a clear personal recommendation and reasoning.
asyncHandler wrapper goes inside the controller export, not on the route line.

Never do (see DECISIONS.md for full list):

Never suggest NestJS, Winston, Socket.IO, MongoDB, single R2 bucket with prefixes, Prisma connect for pricing rules, hardcoded free-preview-page counts, or comic-level generation prompts.
Never suggest backend Python photo validation — moved to frontend MediaPipe.js. Endpoint is POST /sessions/:id/photo/confirm (not .../validate).
Never suggest querying preview pages by pageNumber <= freePreviewPages — always where: { isPreviewPage: true }.
Never suggest frontend sends userId in request bodies — always derive from Better Auth cookie.
Never suggest ComfyUI installation/hosting work — API integration only.
Never suggest a publish-time ComfyUI asset sync worker — single face-swap LoRA is baked in Docker, and all per-request assets travel as base64.
Never revert PageVersion to bare pageNumber Int — must use pageId FK.
Never revert WebSocket to { server: httpServer } — { noServer: true } is permanent.
Never re-introduce an HD upscale stage / hdGenerationQueue / hdWorker — SD output is the final print-ready image.
Never suggest text stamping AFTER ComfyUI — Sharp runs FIRST, then face-swap.
Never move Page.artworkUrl/maskUrl back to the private bucket — they are public URLs, admin + customer both render them directly.
Never store bubble geometry or fontSize as absolute pixels — normalized 0–1 fractions only.
Never accept artworkWidth/artworkHeight from the client — always Sharp-probed server-side.
Never build thumbnail add/remove/reorder sub-endpoints — full-array PATCH only.
Never send PNG to RunPod's API — transcode to JPEG q88 for the round-trip. R2 storage stays PNG.
Never put a BullMQ enqueue inside a Prisma $transaction — Redis doesn't roll back with Prisma. Commit DB first, then enqueue.
Never propose a BullMQ priority value above 2,097,151 — hard 21-bit ceiling. Use the compressed formula.
Never suggest carrying job payload beyond { pageVersionId } — worker looks up everything from DB.
Never suggest returning a flat pageVersions[] on GET /sessions/:id — nested pages[].variants[] shape with all comic pages included.
Never suggest old MediaPipe mp.solutions API — fully removed in installed version.
Never suggest Python versions other than 3.11.x for the venv.
Never re-propose pupil-shape or frame-bridge-uniformity for sunglasses detection.
Never suggest building validateParams middleware.
Never assume a task is done just because it was discussed — check CURRENT_STATE.md.


---

## 3. TECH STACK

| Technology | Version | Role | Key notes |
|---|---|---|---|
| Express.js | v5 | HTTP framework | v5 needed for wildcard route syntax |
| TypeScript (ESM) | `"type": "module"` | Type safety | All imports use `.js` extensions in `.ts` source (Node ESM req) |
| tsx | — | Dev + prod runtime | `tsx watch` in dev, `tsx` in prod. No `tsc` build step. **No typecheck runs anywhere** — `tsconfig.json` sets `"types": []` and tsx strips types without checking them. Type errors surface only at runtime. |
| Prisma | 7, `provider = "prisma-client"` | ORM | Uses separate `prisma.config.ts`. No barrel `index.ts` — import from `../generated/prisma/client.js` |
| Neon (PostgreSQL) | via `@prisma/adapter-neon` | Primary DB | Must construct `new PrismaClient({ adapter })` — bare constructor is a bug |
| Cloudflare R2 | Two buckets: `unilake-public`, `unilake-private` | Object storage | Two buckets not one-with-prefixes — R2 public toggle is bucket-level |
| Redis (Upstash) + BullMQ | — | Job queue | Queues: `sd-generation`, `pdf-compilation`. `hd-generation` code commented, not deleted. Priority values must fit 21 bits (max 2,097,151) |
| Better Auth | — | Admin + customer auth | Google + Facebook + email/password. Custom `role` field via `additionalFields` with `input: false` |
| Zod | v4.4.3 | Validation | Middleware only, never in controllers. `ZodIssue` deprecated in v4 — use inline `{ message: string }` |
| Pino | — | Logging | Signature: `logger.info(dataObject, 'message')` — data FIRST. Not Winston. |
| Helmet, CORS | — | Security headers | CORS methods must include PATCH |
| Sharp | 0.35.3 | Dimension probing + text compositing + JPEG transcode + WebP display derivative | Installed July 29. `src/lib/image.ts` holds `probeImageDimensions` and `buildDisplayImage`, but `generationWorker.ts` and `textStamp.ts` import `sharp` directly too — the lib is one of three entry points, not a wrapper around all Sharp use. No native text primitive — generate SVG then composite. Runs FIRST, before ComfyUI. |
| react-konva | Recommended to frontend | Admin bubble-mapping UI | Chosen over Fabric/DOM for zoom+pan. Backend endpoints already built |
| Python 3.11.9 (venv) | 3.11.9 | Photo validation (LEGACY — kept, not yet removed) | Cleanup deferred; code retained but no longer called |
| OpenCV, MediaPipe, DeepFace, TensorFlow, tf-keras | — | Photo validation (LEGACY) | Kept for now |
| `child_process.execFile` | Node built-in | Spawn Python (LEGACY) | Cross-platform path via `process.platform` |
| ComfyUI | External, RunPod-hosted | AI image generation | API-calling only, no infra work. Endpoint `bwdfkrlaocqm3o` on client's account. |
| `ws` (npm) | — | WebSocket | `{ noServer: true }` for pre-handshake auth. Rooms via in-memory `Map` |
| Docker | `node:22-bookworm-slim` | Container | Multi-stage build, Python stripped. Final ~250MB |
| Google Cloud Run | `asia-south1` | Hosting | `--min-instances 1`, `--max-instances 1`, `--timeout 3600` |
| Google Artifact Registry | `unilake-images` in `asia-south1` | Docker registry | — |
| Auto-deploy (method TBD) | GCP-side config | CI/CD | Push to `main` → automatic deploy to Cloud Run. Confirmed working. Exact configuration path (Cloud Build trigger / Cloud Run continuous deploy / GitHub Actions) needs verification in GCP Console → Cloud Run → service → Continuous deployment. Old references to `.github/workflows/deploy.yml` and secrets `GCP_SA_KEY` / `GCP_PROJECT_ID` / `GCP_REGION` were inaccurate. |
| Razorpay | — | Payments | International = separate account setup |
| Shiprocket | — | Shipping | Country name format vs ISO codes = unresolved |
| pdf-lib | Planned | PDF compilation | Not yet used |
| Apidog | — | API testing | Not automated tests |

---

## 4. ARCHITECTURE & DESIGN DECISIONS

**Pattern:** Modular monolith. Single Express app, `routes → controllers → services → lib`. BullMQ workers are started from `server.ts` via `initJobs()` and run **in the same Node process and on the same event loop** as the web server — they are a separate *module*, not a separate process.

**Entry points:**
- `server.ts` = true entry. `http.createServer(app)` → `setupWebSocket(server)` → `initJobs()` → `server.listen()`.
- `app.ts` = middleware + route mounting only. Never calls `.listen()`. Includes global `BigInt.prototype.toJSON` patch at top.

**Middleware order in `app.ts` (load-bearing — do not reorder):**
1. `app.set("trust proxy", 1)` — required on Cloud Run so client IPs and the `secure` cookie flag resolve correctly behind the load balancer.
2. `pinoHttp` → `cors` → **Better Auth handler** → `express.json()` → `helmet()`.
3. The Better Auth handler sits **above** `express.json()` on purpose — Better Auth needs the raw request body. Moving `express.json()` above it breaks authentication.
4. `helmet()` runs after the auth route, so `/api/auth/*` responses do not receive helmet headers.
5. `GET /health` returns a plain string, not the `sendSuccess` envelope — the one deliberate exception to the envelope rule.

**BigInt serialization:** `app.ts` patches `BigInt.prototype.toJSON` to return `.toString()`. Native `JSON.stringify` can't handle BigInt values; `PageVersion.seed` is the only BigInt field in the schema. Frontend must type `seed` as `string | null` if consumed.

**Controller pattern:** Validation in middleware only (`validateBody(schema)` on route). Controllers never call `.parse()`. `asyncHandler` wraps controllers inside the export, not on the route line. Every success response goes through `sendSuccess(res, statusCode, data, message?)` from `src/utils/response.ts` — standardized envelope `{ success: true, data, message? }` across all controllers.

- `validateBody` **replaces** `req.body` with the parsed result, so Zod `.default()` values are applied before the controller runs. This is how `Bubble.fontSize` and `Bubble.sortOrder` get their defaults when the client omits them.
- **Query strings use a third, informal pattern:** `comic.controller.ts` (public + admin list) and `feedback.controller.ts` call `schema.parse(req.query)` inside a try/catch that converts `ZodError` → `ValidationError`. This is the stand-in for the deferred `validateQuery` middleware.

**Error response contract:** `errorHandler` returns `{ success: false, error: { code, message } }`. The `code` values a client can receive are `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`, plus the RunPod-specific `RUNPOD_SUBMIT_FAILED`, `RUNPOD_STATUS_FAILED`, `RUNPOD_JOB_FAILED`, `RUNPOD_POLL_TIMEOUT`, `RUNPOD_MALFORMED_OUTPUT`. 500-level messages are replaced with a generic string outside development. Prisma errors have no central handling — each service catches `P2002` / `P2025` itself.

**Better Auth runtime behaviour:**
- Cookies: `sameSite: "none"` + `secure: true` when `NODE_ENV === "production"`, `"lax"` + `false` otherwise.
- A commented-out `crossSubDomainCookies` block waits on the real domain. Together with the CORS origin and `trustedOrigins`, that makes **three** places to update at frontend-deploy time, not two.
- Facebook accounts that return no email are given a synthetic `${profile.id}@facebook.local` address via `mapProfileToUser`. Those users cannot receive order or PDF emails.
- `requireAdmin` and `requireLoggedIn` each call `auth.api.getSession()` per request — no caching, one DB round-trip per guarded request.

**Auth tiers (three):**
1. Admin routes `/api/admin/*` → `requireAdmin`
2. Customer routes `/api/user/*` → `requireLoggedIn` (any Better Auth session)
3. Public routes `/api/public/*` → no guard. Session endpoints optionally read cookie to populate `userId`.

**Route mounting order in `app.ts`:**

app.use("/api/admin", requireAdmin, adminRoutes);
app.use("/api/user", requireLoggedIn, userRouter);
app.use("/api/public", publicRouter);

**Key design principles:**
- `OrderSession` created EARLY (just `{ comicId }`), fields filled progressively via PATCH.
- `createOrderSession` optionally reads Better Auth cookie — if logged in, auto-attaches `userId`; if anonymous, `userId` stays null.
- WebSocket connects immediately after session creation, not at "Generate" time.
- `{ noServer: true }` WebSocket — auth check during raw HTTP upgrade event, before `wss.handleUpgrade()`.
- Single photo per session. `rawPhotoUrls` array holds 0 or 1 entries.
- `bestPhotoUrl` set on photo confirm (frontend has already validated via MediaPipe.js). `status` advances to `PHOTO_UPLOADED` on confirm.
- Preview pages selected via `Page.isPreviewPage: true` — admin picks WHICH pages are preview (any subset). `Comic.freePreviewPages` is a counter used only for sanity-check log warnings.
- `PageVersion` uses real `pageId` FK, not bare `pageNumber Int`. `pageNumber` in payloads/events is descriptive only.
- Prompts are page-specific only (`Page.pagePrompt`). No comic-level generation prompts.
- Unified `PATCH /api/admin/comics/:comicId` for all plain-scalar comic fields. Themes via `{ connect: { id } }`.
- **Variant cap is payment-based**, not stage-based: `MAX_VARIANTS_BEFORE_PAYMENT = 3`, `MAX_VARIANTS_AFTER_PAYMENT = 8`. Constants in `src/config/generation.ts`. Pre-payment variants persist and count toward the post-payment cap.
- **Generation pipeline order**: Sharp text stamping runs FIRST (onto raw `Page.artworkUrl`). Then, forked on `Page.hasFace`: face pages go to ComfyUI face-swap SECOND on the text-stamped image; non-face pages skip RunPod entirely and the stamped image IS the final image. SD output is the final print-ready image — no HD upscale stage.
- **hasFace fork drives worker branching**: face pages need `bestPhotoUrl`, `maskUrl`, `pagePrompt` and go through RunPod. Non-face pages need only `artworkUrl` + dimensions and finish after text-stamp. `comfyJobId` stays null for non-face rows.
- **ComfyUI transport**: text-stamped artwork + mask + child photo all travel as base64 in RunPod payload. Sharp transcodes all three to JPEG q88 right before submit (RunPod caps payload at 10 MiB; PNG at 2000×1455 would exceed). Result comes back as base64 in polling response; decoded and saved to R2 as PNG. Single face-swap LoRA baked in Docker — no per-comic asset sync.
- **BullMQ priority formula**: `computeJobPriority(sessionCreatedAt, pageNumber) = (sessionSecondsInDay) + (pageNumber × 80_000)`. Max value = 2,006,399 < BullMQ's 21-bit ceiling of 2,097,151. Gives round-robin fairness across concurrent users. Helper lives in `session.service.ts`.
- **BullMQ concurrency = 5** to match RunPod max workers. Set in `generationWorker.ts`.
- **DB before Redis for two-system atomicity**: `enqueuePreviewGenerationJobs` creates all `PageVersion` rows in a `$transaction`, then enqueues to BullMQ AFTER commit. Redis failure leaves orphan QUEUED rows but no DB inconsistency.
- **Status-flip ordering around the enqueue differs by entry point — both orderings are deliberate:**
  - `triggerGeneration` (first generation): flip to `GENERATING_PREVIEW` **AFTER** the enqueue succeeds. A failed enqueue must leave the session in `CREATED`/`PHOTO_UPLOADED` so `triggerGeneration` — and with it the orphan-row recovery in `enqueuePreviewGenerationJobs` — can be re-run.
  - `regeneratePage` (recovery from `FAILED`): flip to `GENERATING_PREVIEW` **BEFORE** the enqueue. The worker runs at concurrency 5 and picks jobs up immediately, so flipping afterwards would race a fast page finishing, no-opping the completion guard, and stranding the session in `GENERATING_PREVIEW` instead — trading one stuck state for another. There is intentionally **no rollback** if the enqueue then throws: `GENERATING_PREVIEW` is itself regeneratable, so the user retrying re-enters the normal path, and a rollback would race a sibling regeneration that did enqueue successfully. Cost of that failure mode is one burned variant slot against the cap of 3, on a Redis outage.
- **Orphan-row recovery on re-generate** (built, previously only planned): `enqueuePreviewGenerationJobs` is re-entrant. Before creating anything it loads existing `variantIndex: 0` rows for the preview pages, creates rows only for pages that have none, resets any reused row that is neither `SD_READY` nor `QUEUED` back to `QUEUED` with `errorMessage: null`, and skips enqueuing rows already at `SD_READY`. Rows are paired to their page by ID lookup, never by array position, because reused and freshly-created rows come from two different queries. A retry after a Redis outage therefore succeeds instead of hitting the `(orderSessionId, pageId, variantIndex)` unique constraint.
- **Regenerate uses transactional variant-index computation**: count + cap check + row create all inside `$transaction`. Prevents double-click race producing duplicate `variantIndex` values against the unique constraint.
- **Job payload is `{ pageVersionId }` only**: worker fetches all related data (page, bubbles, fonts, session, comic) from DB. Minimizes queue coupling and makes idempotency simpler.
- **Idempotency guard at top of worker**: if row is already `SD_READY` with `finalImageUrl`, re-emit `page:ready` and return. Handles BullMQ retry-after-ack-lost edge case.
- **Preview completion (`maybeMarkPreviewComplete`)**: runs after every terminal `PageVersion` transition — `SD_READY` or `FAILED`. Counts total preview pages, then loads **every** terminal `PageVersion` row for those pages and reduces them into two sets: `terminalPageIds` (has this page settled at all?) and `succeededPageIds` (did any variant of it succeed?). Returns "not-done" if `terminalPageIds.size < totalPreviewPages`. Otherwise: **success-wins** — if any page succeeded, flips session to `PREVIEW_READY`; if every preview page final-failed, flips to `FAILED`. Atomic flip via `updateMany` with status guard in the `WHERE` clause — Postgres single-statement atomicity, no fake row-lock reasoning. Emits `session:preview-ready` on success (no session-level event for failure; frontend learns via per-page `page:error` + GET response).
  - **Deliberately does NOT use `distinct: ["pageId"]`.** A regenerated page holds several variants — e.g. variant 0 `FAILED` plus variant 1 `SD_READY` — and collapsing to one row per page before inspecting them picks an arbitrary variant, because there is no `orderBy` that answers both questions above at once. The earlier `distinct` version could read `FAILED` for a page that had actually succeeded on retry and flip the whole session to `FAILED`. Row volume is preview pages × the variant cap, so reducing in JS is cheap and exact.
- **Success-wins semantics**: a single successful page keeps the session recoverable via existing `/regenerate` endpoint. `FAILED` is in `REGENERATABLE_STATUSES` so users can self-recover totally-failed sessions.
  - **`regeneratePage` moves a `FAILED` session back to `GENERATING_PREVIEW` before enqueuing.** This is load-bearing, not cosmetic: `maybeMarkPreviewComplete` only flips sessions whose current status is `GENERATING_PREVIEW`, so without the move a successful regeneration would write `SD_READY` on the page and leave the session pinned at `FAILED` forever. The flip is an `updateMany` guarded on `status: "FAILED"`, so concurrent regenerations are safe. See §4's enqueue-ordering note for why it runs before the enqueue rather than after.
  - **The target count comes from `page.count({ comicId, isPreviewPage: true })`, not `Comic.freePreviewPages`** — consistent with `isPreviewPage` being the only source of truth. Counting against the comic-level counter would desync the moment it drifts from the flags.
  - A `totalPreviewPages === 0` guard exists so a comic with no preview pages flagged never flips instantly on a `0 >= 0` comparison.
  - Scoped to `page: { isPreviewPage: true }` so paid-page generations can never satisfy the preview transition.
- **Per-page generation tunables**: `Page.steps` (Int, default 3, range 1–8) and `Page.cfg` (Float, default 1.0, range 1.0–3.0). Bounds in `src/config/generation.ts`.
- **Asset bucket split**: comic thumbnails, country flags, **page artwork and masks**, and all session output (stamped, final, display) live in the PUBLIC bucket and store full URLs. Fonts, child photos, and LoRA stay PRIVATE and store raw keys. Frontend always sends a `key`; backend converts via `getPublicUrl()`.
- **Presigned upload URL expiry, per asset type** (all set independently in their own service — there is no shared constant):

  | Asset | Expiry | Bucket |
  |---|---|---|
  | Child photo | 5 min | private |
  | Font | 10 min | private |
  | Comic thumbnail | 15 min | public |
  | Country flag | 15 min | public |
  | Page artwork / mask | 15 min | public |
  | Hero image | 15 min | public |
  | Team member photo | 15 min | public |
  | Customer review video | 30 min | public |
  | LoRA (retained-unused) | 60 min | private |

  `getSignedUploadUrl` sets no `ContentLength` condition, so none of these cap file size.
- **`requestChecksumCalculation: "WHEN_REQUIRED"` on the S3 client is mandatory** — newer AWS SDK versions send checksum headers R2 rejects. Do not remove it during an SDK upgrade.
- **Session-owned per-page final images**: every SD_READY row uploads its final image to `sessions/{sessionId}/final/{pageVersionId}.png`. Non-face pages re-upload their stamped image to the same prefix (not a URL-alias to shared comic artwork). Prevents referential breakage if a comic gets deleted.
- **Web display derivative (`displayImageUrl`)**: `finalImageUrl` is a lossless print-resolution PNG, roughly 4–5 MB per page — correct for the printed book, far too heavy for a browser (a six-page preview came to ~27 MB). Every finished page therefore also gets a WebP derivative built by `buildDisplayImage` in `src/lib/image.ts` and uploaded beside the master at `sessions/{sessionId}/final/{pageVersionId}.webp`.
  - Long edge capped at **1600px** (`fit: "inside"`, never crops), quality **80**, `withoutEnlargement: true` so smaller pages are not upscaled. Typical result ~250 KB, roughly an 18× reduction.
  - Built for **both** branches — face pages from the RunPod result, non-face pages from the stamped buffer.
  - **Best-effort by design: it never throws.** By the time it runs, the print master is already uploaded and the expensive GPU work is done, so a failed resize logs a warning and returns `null` rather than failing the job. `displayImageUrl` is then null and the client falls back to `finalImageUrl` — degraded, not broken.
  - The print master is never modified. This is an additional file.
- **Normalized bubble geometry**: `Bubble.x/y/width/height` are 0–1 fractions of the artwork, never pixels. `Bubble.fontSize` is a fraction of artwork **height**. Resolution-independent — artwork can be re-uploaded at any size without invalidating bubbles. Bounds enforced in Zod (create) and `bubble.service` (partial update).
- **Artwork dimensions are server-derived**: `Page.artworkWidth`/`artworkHeight` probed with Sharp on create/update. Mask must match artwork dimensions exactly (400 on mismatch). Aspect-ratio change on artwork replacement returns a non-blocking `warnings[]` entry — the threshold is `ASPECT_RATIO_TOLERANCE = 0.01` in `page.service.ts`, never an `===` comparison, since 2048/1536 and 4096/3072 are the same ratio but not bit-identical.
  - `updatePage` validates against the page's **resulting** state, not just the incoming fields: replacing only the artwork re-verifies the existing mask even though the mask was not in the payload. A PATCH touching neither asset performs zero R2 downloads.
  - `createPage` always returns `warnings: []` (always empty) purely so create and update share a response shape. Only `updatePage` populates it.
  - A mask uploaded **without** artwork in the same request is stored unvalidated; it is checked later, when artwork is attached via `updatePage`.
- **Page reordering** (`PATCH /api/admin/comics/:comicId/pages/reorder`): takes `orderedPageIds` — array position becomes the new `pageNumber` (index 0 → page 1). IDs, not numbers, because the numbers are what is being rewritten.
  - Refuses to reorder a `PUBLISHED` comic (409). Refuses if the comic has any order session in a non-terminal status (409) — PDF compilation orders pages by `pageNumber`, so reordering mid-order would reshuffle a book someone already paid for. Same guard `deleteComic` uses.
  - Requires the **complete** set of page IDs (400 if the count differs) and rejects IDs belonging to another comic (400). A partial list would renumber a subset into 1..n and collide with the untouched pages.
  - Uses a **two-phase renumber** inside one `$transaction`: every page is first parked on a negative `pageNumber`, then assigned its real one. `@@unique([comicId, pageNumber])` is enforced per statement and is not deferrable, so writing final numbers directly fails the moment two pages swap. `createPageSchema` enforces `positive()`, so no real page can ever hold a negative number.
  - Returns the full re-listed page set on success.
- Age lives on `OrderSession`, not `Comic`. `Comic.ageGroup` is a browsing filter band.
- **Multi-thumbnail model**: `Comic.coverThumbnailUrls String[] @default([])`, first element is primary, max 10 per comic. PATCH sends full desired array; backend diffs and best-effort R2-cleans up removed URLs.
- No signed URLs to Python — Node downloads to temp file first (`downloadFileToLocalPath` in `r2.ts`).
- Python called via cross-platform path (`process.platform` detection).
- Theme delete blocks if comics linked (409 with count).
- Comic delete blocks if PUBLISHED or has active OrderSessions.
- Country delete blocks if pricing rules reference it (409 with count).
- Font delete blocks if bubbles reference it (409 with count).
- Cross-comic font assignment blocked on bubble **update** (409). `createBubble` does not perform this check — the guard's scope is update-only.
- **R2 cleanup scope and ordering:**
  - `CustomerReview` (video), `TeamMember` (image, on both replace and delete), `HeroImage` (image) — **DB row deleted first**, then best-effort R2 cleanup inside a try/catch.
  - `Comic` — deletes all thumbnails **and every page's artwork + mask** before the DB delete. Pages cascade-delete in the DB but their R2 objects do not, so without this every deleted comic would leave orphaned public files.
  - `Page` — deletes artwork + mask on delete, and the replaced file on update (guarded on `oldUrl !== newUrl` so re-submitting the same key never deletes the live file).
  - `Font` and `Country` perform **no** R2 cleanup — font files and country flags are left in the bucket on replace or delete.
- `prisma.config.ts` reads `process.env.DIRECT_URL` directly, decoupled from `env.ts`, so `prisma generate` works during Docker build.

**Photo cache (in-memory, per-worker-process):**
- `src/jobs/workers/sd/photoCache.ts` — `Map<sessionId, {bufferPromise, refCount, lastAccessedAt}>`.
- Reference counting: `acquirePhoto` increments, `releasePhoto` decrements, entry evicts when refCount hits zero.
- Promise memoization: first caller triggers R2 download and stores Promise; concurrent callers await the same in-flight fetch.
- Failed downloads self-evict via `.catch`.
- Background sweep every 5 min force-evicts entries idle >15 min as a safety net. The sweep timer is not `.unref()`'d; its inline justification refers to a "worker process" that does not exist separately (see the pattern note above), though the outcome is harmless because the HTTP server keeps the process alive anyway.
- No maximum entry count — bounded only by refcount and the idle sweep.
- Purely a burst-optimization for concurrent worker jobs on the same session. Not related to the user's OrderSession lifetime.
- **Fonts have no equivalent cache.** `stampTextOnPage` builds its `fontCache` Map *inside* the function, so it deduplicates only within a single page. Every job re-downloads the comic's font files from R2.

**Anonymous → authenticated flow:**
- Anonymous phase: `sessionId` semi-public in URLs, `wsRoomToken` is the actual secret. **⚠️ CONTRADICTORY (Aug 11 audit):** `GET /api/public/sessions/:id` is unauthenticated and returns `wsRoomToken` in its payload, so in practice anyone holding the sessionId also holds the token. On the fix list.
- Login before checkout: frontend calls `PATCH /api/public/sessions/:sessionId/attach-user` after Better Auth callback.
- Attach only succeeds if `userId` currently null. Idempotent if same user calls again. 409 if different user.
- Post-userId revisit links require matching login → 403 on mismatch.
- Address snapshotted into BOTH `OrderSession.shipping*` AND `Order.shipping*`. No FK to `SavedAddress`.
- Payment retry: only pre-payment on same browser page. Post-payment failures = admin responsibility.

**Snapshot + stream pattern for frontend sync:**
- `GET /sessions/:id` returns the complete snapshot: session state + all comic pages + all variants nested.
- WebSocket streams deltas during active generation: `page:ready`, `page:error`, `session:preview-ready`.
- On WebSocket reconnect or return-after-away, frontend calls GET first to reconcile any missed events.

**SavedAddress:**
- First address auto-becomes default.
- Deleting the default promotes the most recently created remaining address.
- `set-default` uses `POST` (action, not field update) with `$transaction` to unset all + set one.
- Ownership check on all mutating endpoints — `ForbiddenError` (403) if address belongs to different user.

---

## 5. DATABASE SCHEMA

**Full schema lives in `prisma/schema.prisma`.** Refer to that file directly — do not duplicate model definitions here.

**Auth models (Better Auth generated):** `User` (with custom `role` field, `orderSessions` and `savedAddresses` relations), `Session`, `Account`, `Verification`. Note: Better Auth's `Session` model is unrelated to `OrderSession`.

**Domain models:**
- **Catalogue:** `Theme`, `Comic` (with `coverThumbnailUrls String[]`), `Page` (`steps`, `cfg`, `artworkWidth Int?`, `artworkHeight Int?`, `isPreviewPage Bool`, `hasFace Bool`), `Bubble` (normalized `x/y/width/height`, `fontSize Float @default(0.02)`), `Font`
- **Pricing:** `PricingRule` (unique: `[comicId, countryId, coverType]`), `Country`
- **Order flow:** `OrderSession` (with `userId`, `notificationEmail`, `coverType`, shipping fields), `PageVersion` (unique: `[orderSessionId, pageId, variantIndex]`; pipeline fields `textStampedUrl`, `comfyJobId` nullable, `finalImageUrl`, **`displayImageUrl` nullable**, `seed` BigInt, `errorMessage`), `Order` (with shipping snapshot, `coverType`, `notificationEmail`)
  - `PageVersion.displayImageUrl` added in migration `20260808020240_added_display_image_in_page_version`. Nullable: null on rows written before the field existed, and on rows where the derivative could not be built.
- **User data:** `SavedAddress` (single default per user, ownership-guarded)
- **CMS:** `AnnouncementBar`, `HeroImage`, `CustomerReview`, `TeamMember`, `Feedback`
- **System:** `WebhookEvent` (idempotency), `SystemConfig`

**Enums:** `AgeGroup`, `CoverType`, `GenderTag`, `ComicStatus`, `OrderSessionStatus`, `PronounKey`, `PageVersionStatus`, `OrderStatus`, `FeedbackStatus`.

**Which `OrderSessionStatus` values are live:** `CREATED`, `PHOTO_UPLOADED`, `GENERATING_PREVIEW`, `PREVIEW_READY`, and `FAILED` are written by current code. `AWAITING_PAYMENT`, `PAID`, `GENERATING_PAID`, `PAID_PAGES_READY`, `CONFIRMED`, `COMPILING_PDF`, and `DISPATCHED` are reserved for features not yet built. `COMPLETED` is never written either, but is already read — both `deleteComic` and `reorderComicPages` treat `COMPLETED` and `FAILED` as the terminal statuses that do not block. `OrderStatus` is entirely reserved — nothing writes it.

**⚠️ `FAILED` is overloaded — it currently means three different things:**
1. **Generation failed** — every preview page exhausted its BullMQ attempts, written by `maybeMarkPreviewComplete`.
2. **Expired on mutation** — the user hit a session-mutating endpoint past `expiresAt`, written by `assertNotExpired`.
3. **Expired by sweep** — the hourly `sweepExpiredSessions` found it past `expiresAt`.

Consequences to be aware of:
- **The frontend must read `isExpired` before offering a retry.** `FAILED` is in `REGENERATABLE_STATUSES`, so a naive UI shows a retry button on an expired session — and every press 409s, because `assertNotExpired` runs first in `regeneratePage`. Only case 1 is actually retryable.
- **Expired sessions stop blocking comic deletion and page reordering**, because both guards exclude `FAILED`. Their `PageVersion` rows then cascade-delete with the comic. Probably desirable, but it is a behavioural change that arrived with expiry enforcement rather than a decision made on its own.

A distinct `EXPIRED` enum value would remove the ambiguity for the cost of one migration plus updates to `assertNotExpired`, `sweepExpiredSessions`, `REGENERATABLE_STATUSES`, and the two active-session guards. On the backlog, not yet done.

**Models with no code touching them yet:** `Order`, `WebhookEvent`, `SystemConfig`. Schema-only, waiting on payments and shipping.

**Naming exception:** `Country` has no `@@map`, so its table is `Country` while every other domain table is snake_case (`comics`, `pages`, `bubbles`, `order_sessions`, `page_versions`, `pricing_rules`). Changing it now needs a rename migration.

**PageVersionStatus flow:**
- Face pages: `QUEUED → TEXT_STAMPING → TEXT_STAMPED → GENERATING_SD → SD_READY` (or `FAILED` from any stage)
- Non-face pages: `QUEUED → TEXT_STAMPING → TEXT_STAMPED → SD_READY` (skips `GENERATING_SD`)

**Cascade rules:**
- `Comic` delete → cascades to `Page`, `Font`, `PricingRule`.
- `Page` delete → cascades to `Bubble`.
- `OrderSession` does NOT cascade if parent `Comic` changes — in-progress order must never vanish.
- `Theme` delete does NOT cascade — blocked at app layer if linked.
- `Country` delete does NOT cascade — blocked at app layer if pricing rules reference it.
- `Font` delete does NOT cascade — blocked at app layer if bubbles reference it.

**Retained-but-unused fields:**
- `Comic.loraFileUrl`, `Comic.loraStrength` — post single-LoRA decision. Kept for schema stability; frontend admin wizard must NOT expose LoRA upload UI.
- `Comic.publishJobId`, `Comic.publishError` — dead since publish became a synchronous status flip.
- `Page.mirrorFace`, `Page.faceDirection` — **stored, validated in Zod, and editable through the admin API, but read by nothing.** The worker never reads them and `buildWorkflow` never receives them. An admin UI built from the schema will surface controls that have no effect.
- `OrderSession.photoScoreJson` — dead since photo validation moved to the frontend. Excluded from the GET response.
- `PageVersion.isSelected` — read and returned, but nothing writes it yet; waiting on the confirm endpoint.

---

## 6. API DESIGN — ROUTE MAP

REST. Middleware: `validateBody`, `requireAdmin`, `requireLoggedIn`, `errorHandler`, `asyncHandler`. `validateQuery` planned but not built. `validateParams` explicitly decided against.

### Admin routes (`requireAdmin`)
- **Comic:** batch thumbnail upload-URL (`POST /comics/thumbnails/upload-urls`, up to 10 files), LoRA upload-URL (retained-unused), create, admin list (filters), admin detail, PATCH, delete (with R2 cleanup of all thumbnails), status toggle, pricing GET/PUT
- **Country:** upload-URL, create, PUT, list, DELETE (with pricing guard)
- **Page:** list (with nested bubbles), create, upload-URL, PATCH (accepts `steps`, `cfg`, `isPreviewPage`, `hasFace`), DELETE (cascades bubbles), **reorder** (`PATCH /comics/:comicId/pages/reorder`, full ID list, blocked on PUBLISHED + active sessions)
- **Bubble:** list (with font info), create, PATCH (with cross-comic font guard), DELETE
- **Font:** list (with bubble count), create, upload-URL, PATCH, DELETE (with bubble reference guard)
- **Theme:** POST, PATCH, DELETE
- **AnnouncementBar:** POST, PATCH, status toggle, reorder, list, DELETE
- **HeroImage:** upload-URL, POST, status toggle, list, DELETE
- **CustomerReview:** upload-URL, POST, status toggle, list, DELETE (with R2 cleanup)
- **TeamMember:** upload-URL, POST, PATCH (with R2 cleanup), status toggle, list, DELETE (with R2 cleanup), plus `GET /team-members/active` (admin-side duplicate of the public endpoint)
- **Feedback:** list (?status), PATCH status, DELETE
- **Orders:** list, detail (planned)
- **`GET /admin/status`** — guard smoke-test endpoint. Returns `{ success, message, adminEmail }`. Confirmed present; the frontend integration guide's reference to it is correct.
- **No update endpoint exists for `HeroImage` or `CustomerReview`** — create, toggle status, and delete only. Editing means delete and recreate (and re-upload the asset).

### Customer routes (`requireLoggedIn`)
- `/api/user/addresses` — GET (list), POST (create, auto-default first), PATCH (update, ownership check), DELETE (ownership check, default promotion), POST set-default ($transaction)
- `/api/user/orders` — GET list, GET detail (planned)
- `POST /api/public/sessions/:id/checkout`, `POST /api/public/sessions/:id/confirm` (planned)

### Public routes
- `GET /api/public/comics` (filters), `GET /api/public/comics/:id` (includes description, ageGroup, isBestseller, theme, coverType pricing, `coverThumbnailUrls` array, and preview pages with `artworkUrl` + `artworkWidth`/`artworkHeight` so the carousel can reserve the right aspect-ratio box before load)
- `GET /api/public/themes`, `/announcements`, `/hero-images`, `/customer-reviews`, `/team-members`
- `GET /api/public/countries` — active countries only, for the shipping/pricing picker. Explicit `select` so `isActive` itself never leaks. Separate from the admin list, which must also return deactivated rows.
- `POST /api/public/feedbacks`
- Session:
  - `POST /api/public/sessions` (optionally reads cookie for auto-attach)
  - `PATCH /api/public/sessions/:id` (accepts childName, age, pronounKey, notificationEmail, coverType, shipping fields)
  - `GET /api/public/sessions/:id` (returns full snapshot; see response shape below)
  - `POST /api/public/sessions/:id/photo/upload-url` (presigned R2 PUT URL)
  - `POST /api/public/sessions/:id/photo/confirm` (accepts `{ key }`; flips status to `PHOTO_UPLOADED`; allows re-confirm from `PHOTO_UPLOADED`)
  - `POST /api/public/sessions/:id/generate` (kicks off preview generation for all `isPreviewPage: true` pages)
  - `POST /api/public/sessions/:id/pages/:pageNumber/regenerate` (single-page, transactional variant-index)
- `PATCH /api/public/sessions/:id/attach-user` (requireLoggedIn inline)
- WebSocket: `ws://.../?sessionId=&token=`

### Webhooks — planned
- `POST /api/webhooks/razorpay` (signature verification)
- `POST /api/webhooks/shiprocket` (signature/token)

### Auth
- `ALL /api/auth/*splat` (Better Auth handler, both admin + customers)
- `GET /health`

### `GET /sessions/:id` response shape (LOCKED — frontend building against this)
```json
{
  "success": true,
  "data": {
    "id": "...", "comicId": "...", "userId": null | "...",
    "childName": "...", "pronounKey": "HE|SHE|THEY", "age": 6,
    "notificationEmail": null | "...", "coverType": null | "HARDCOVER|SOFTCOVER",
    "status": "CREATED | PHOTO_UPLOADED | GENERATING_PREVIEW | PREVIEW_READY | ...",
    "bestPhotoUrl": "sessions/.../photo-....jpeg",
    "shippingName": null | "...", ..., "shippingPhone": null | "...",
    "wsRoomToken": "...",
    "createdAt": "...", "updatedAt": "...", "expiresAt": "...", "isExpired": false,
    "comic": { "id": "...", "title": "...", "freePreviewPages": 5, "coverThumbnailUrls": ["..."] },
    "pages": [
      {
        "pageId": "...", "pageNumber": 1, "isPreviewPage": true, "hasFace": true,
        "variants": [
          {
            "pageVersionId": "...", "variantIndex": 0,
            "status": "SD_READY",
            "finalImageUrl": "https://...",
            "displayImageUrl": "https://..." | null,
            "isSelected": false, "errorMessage": null
          }
        ]
      }
    ]
  }
}
```
Internal fields (`seed`, `textStampedUrl`, `comfyJobId`, `steps`, `cfg`, `pagePrompt`, `rawPhotoUrls`, `photoScoreJson`) are deliberately excluded via explicit `select`. All comic pages are returned (not just preview ones) so frontend can render the full book with paywall overlays on non-preview pages.

**`displayImageUrl` is what a browser should render.** `finalImageUrl` is the multi-megabyte print master. `displayImageUrl` is null on rows generated before the field existed and on rows where the derivative failed — fall back to `finalImageUrl` in that case.

### WebSocket event contract (LOCKED — frontend building against this):
- `page:ready` → `{ type: 'page:ready', pageNumber, variantIndex, imageUrl, displayImageUrl, pageVersionId }`
- `page:error` → `{ type: 'page:error', pageNumber, variantIndex, errorMessage }`
- `session:preview-ready` → `{ type: 'session:preview-ready' }` (no payload)

`imageUrl` remains the print master so the event shape stays backward compatible; `displayImageUrl` is the web-sized WebP and is `string | null` with the same fallback rule as the GET response. The idempotency re-emit path sends both fields too.

Frontend must call `GET /api/public/sessions/:id` on reconnect to reconcile any missed events (WebSocket events are not queued).

### WebSocket handshake
`ws://.../?sessionId=&token=`, authenticated during the raw HTTP `upgrade` event before `wss.handleUpgrade()`. Failure codes: 400 (missing params), 404 (no such session), 401 (token mismatch), 410 (session expired).

The handshake calls `getOrderSessionId(sessionId)` — the same full snapshot function the public GET uses — to read `wsRoomToken` and `isExpired`. **WebSocket auth is therefore coupled to the shape of that response**: trimming fields from it can silently break the handshake. The upgrade listener is also registered for all paths, not just a `/ws` prefix.

---

## 7. FOLDER STRUCTURE

unilake-backend/
├── Dockerfile # Multi-stage, Python stripped, node:22-bookworm-slim. Runs as root, no HEALTHCHECK.
├── .dockerignore
├── prisma/
│ ├── schema.prisma
│ └── migrations/
├── prisma.config.ts # Reads DIRECT_URL from process.env directly
├── requirements.txt # LEGACY — kept for now
├── venv/ # LEGACY — kept for now
├── src/
│ ├── server.ts # Entry point
│ ├── app.ts # Express config, no .listen(). BigInt.prototype.toJSON patch at top.
│ ├── config/{env,generation}.ts + constants.ts (EMPTY, unused) + workflows/api-workflow.json
│ ├── scripts/ # LEGACY — kept for now
│ ├── test-job.ts # Stale dev helper — enqueues { prompt, sessionId, userId }, a payload the worker no longer reads
│ ├── routes/{admin,public,user}.ts
│ ├── controllers/ # comic, country, session, page, bubble, font, theme, announcement, heroImage, customerReview, teamMember, feedback, savedAddress
│ ├── services/ # Same set + photoValidation (LEGACY, no longer called)
│ ├── validators/ # Zod schemas, one per feature + savedAddress
│ ├── middlewares/ # errorHandler, requireAdmin, requireLoggedIn, validateBody
│ ├── lib/ # prisma, redis, r2, image (Sharp probe), logger, auth
│ ├── jobs/
│ │ ├── queues.ts # sd-generation, pdf-compilation (hd-generation commented)
│ │ └── workers/
│ │ ├── generationWorker.ts # Full pipeline: fetch → stamp → fork on hasFace → RunPod (face) or re-upload (non-face) → SD_READY → emit → PREVIEW_READY check
│ │ ├── pdfWorker.ts # STUB — worker listens, but nothing anywhere enqueues to pdf-compilation
│ │ ├── hdWorker.ts # commented out
│ │ ├── index.ts # initJobs, worker shutdown handlers (does not close server/Redis or exit)
│ │ └── sd/
│ │ ├── tokens.ts # substituteTokens + PronounKey table
│ │ ├── textStamp.ts # stampTextOnPage
│ │ ├── workflow.ts # buildWorkflow (deep-clone + 7-field patch)
│ │ ├── runpodClient.ts # submitAndAwaitResult (submit + poll + decode)
│ │ └── photoCache.ts # acquirePhoto / releasePhoto with ref counting
│ ├── websocket/
│ │ ├── wsServer.ts # setupWebSocket, noServer:true handshake auth
│ │ ├── rooms.ts # joinRoom, leaveRoom, getRoom
│ │ └── event.ts # emitPageReady, emitPageError, emitSessionPreviewReady
│ ├── utils/{errors, asyncHandler, response}.ts
│ └── types/express.d.ts
├── .env / .env.example
└── package.json

---

## 8. ENVIRONMENT

**Env vars used by the app:** `PORT` (8080), `DATABASE_URL`, `DIRECT_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRIVATE_BUCKET_NAME`, `R2_PUBLIC_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL_BASE`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`, `NODE_ENV`, `RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY`.

**Which of those are actually validated at boot:** `env.ts` hard-exits on 19 of them, including `R2_PUBLIC_URL_BASE` and `BETTER_AUTH_SECRET`. `NODE_ENV` falls back to `"development"` if unset.

**Critical rules:**
- NO QUOTES in `.env` values. `dotenv` strips them locally, Docker `--env-file` reads raw and breaks (`%22` in URLs).
- `prisma.config.ts` reads `process.env.DIRECT_URL` directly — NOT through `env.ts` (Docker build has no env vars).
- Docker `EXPOSE 8080`, not 3000.
- Source must be COPIED BEFORE `prisma generate` in Dockerfile.
- App must listen on `process.env.PORT` for Cloud Run. **⚠️ CONTRADICTORY (Aug 11 audit):** this rule previously also required an explicit `"0.0.0.0"` host. `server.ts` calls `server.listen(config.port)` with no host argument. It works because Node binds all interfaces by default, so the deployment is fine — but the code does not literally follow the stated rule.

**Local dev:**
1. `npm install`
2. `npx prisma generate` + migrations
3. `npm run dev` (tsx watch)

**Docker local:**
1. `docker build -t unilake-backend .`
2. `docker run --rm -p 8080:8080 --env-file .env unilake-backend`

**Cloud Run config:** `--min-instances 1`, `--max-instances 1`, `--timeout 3600`, `--memory 1Gi`, `--cpu 1`, `--port 8080`.

**GCP setup:** Auto-deploy to Cloud Run is working. Exact configuration (Cloud Build trigger / continuous deploy / GitHub Actions) TBD — verify in GCP Console. Previous references to a `github-actions-deployer` service account and secrets `GCP_SA_KEY` / `GCP_PROJECT_ID` / `GCP_REGION` were inaccurate.

**Tooling notes:**
- `package.json` has only `dev` and `start` scripts. No test, lint, build, or typecheck command exists for a pipeline to run.
- `winston` is listed in `dependencies` and imported by nothing. **⚠️ CONTRADICTORY:** `DECISIONS.md` lists Winston as a never-do with Pino chosen instead.
- `prettier` sits in `dependencies` rather than `devDependencies`; `ts-node-dev` is installed but unused (tsx replaced it); `"main"` points at `server.ts` instead of `src/server.ts`; there is no `engines` field pinning Node 22.

---

## 9. BUSINESS RULES & CONSTRAINTS

- Preview pages selected via per-page `Page.isPreviewPage` boolean, not the counter on Comic. `Comic.freePreviewPages` is a sanity-check number; frontend enforces they match on publish.
- **Variant cap: 3 before payment, 8 after payment. App-wide fixed.** Constants `MAX_VARIANTS_BEFORE_PAYMENT` / `MAX_VARIANTS_AFTER_PAYMENT` in `src/config/generation.ts`. Pre-payment variants persist and count toward the post-payment cap.
- **Multi-thumbnail per comic**: max 10, first element in `coverThumbnailUrls` is primary (catalogue cards). Full array shown on detail page.
- Single photo per session — permanent.
- Photo confirmation replaces old server-side validation. Frontend runs MediaPipe.js and only calls `POST /photo/confirm` after passing.
- Admin users are small, trusted set — role manually assigned in DB.
- Customers authenticate before checkout (Google/Facebook). Orders tied to accounts.
- Cover type (hardcover/softcover) is a pricing dimension. Every comic has both prices per country.
- Address snapshotted into both `OrderSession` and `Order`. No FK to `SavedAddress`.
- `notificationEmail` is independent of account email.
- Payment retry: pre-payment only, same browser page. Post-payment failures = admin.
- Revisit link emails on user request. PDF-ready email is automatic.
- Theme delete blocked if comics linked.
- Comic delete blocked if PUBLISHED or has active sessions.
- Page **reorder** blocked if the comic is PUBLISHED or has active sessions. Page **update** and **delete** carry no such guard.
- Country delete blocked if pricing rules reference it.
- Font delete blocked if bubbles reference it.
- Cross-comic font assignment blocked on bubble update (not on bubble create).
- R2 cleanup on delete for `CustomerReview`, `TeamMember`, `HeroImage`, `Comic` (thumbnails + all page assets), and `Page`. Not for `Font` or `Country`. See §4 for ordering.
- A comic's theme can be attached but not detached — `updateComic` only ever issues `{ connect: { id } }`.
- `updateComic` does not re-check `freePreviewPages < pageCount`; that refine exists only on create. Create allows `freePreviewPages: 0`, update requires at least 1.
- `Country.isActive` exists and is filtered on by the public endpoint, but is absent from the create schema, the update schema, and any toggle route — so every country stays active.
- All six session-mutating functions carry an expiry guard (`assertNotExpired`). `PATCH /sessions/:id` is the one that still has no **status** guard — you can PATCH `childName` or `pronounKey` after generation has finished, including after payment, leaving the personalised text in the generated images out of sync with the DB. Audit 8.3, still open.
- Regeneration is allowed from `GENERATING_PREVIEW`, `PREVIEW_READY`, `GENERATING_PAID`, `PAID_PAGES_READY`, and `FAILED`. Payment-based cap resolves via `POST_PAYMENT_STATUSES`. `FAILED` is included so a totally-failed session can self-recover; an expired-then-`FAILED` session still cannot, because `assertNotExpired` runs first.
- Photo upload-URL and photo-confirm share one `PHOTO_MUTABLE_STATUSES` constant (`CREATED`, `PHOTO_UPLOADED`) deliberately — the two halves drifted apart once, which made re-upload unreachable from the frontend.
- **Publish is a synchronous DB status flip** — no async ComfyUI asset sync worker exists or is planned (single-LoRA architecture makes it unnecessary).

**Security:**
- Two separate R2 buckets, structural. Page artwork/masks are deliberately PUBLIC — accepted trade-off, since preview pages are given away free anyway and blank-bubble artwork without face-swap or personalisation is not the sellable product. Fonts, child photos and LoRA remain private.
- Admin routes: login + `ADMIN` role.
- Customer routes: login + any role.
- `wsRoomToken` is the WebSocket secret. `sessionId` is semi-public.
- `userId` NEVER from frontend — always from Better Auth cookie server-side.
- Post-userId revisit links enforce matching login → 403 on mismatch.
- SavedAddress ownership check — 403 if address belongs to different user.
- `.env` values never baked into Docker images — injected at runtime.

**Session lifetime:** `OrderSession.expiresAt` is set to 24 h at creation. Enforced two ways:

1. **Query-time (carries correctness):** `assertNotExpired(session)` at the top of all six session-mutating functions — `updateOrderSession`, `createPhotoUploadUrl`, `confirmSessionPhoto`, `triggerGeneration`, `regeneratePage`, `attachUserToSession`. Throws `ConflictError` (409) and atomically flips status to `FAILED` via `updateMany` with a terminal-status guard, so the write happens once and repeat calls short-circuit. Read paths (`getOrderSessionId`) deliberately do NOT call it — they return `isExpired: true` so the frontend can render an expired state before the user tries to mutate.
2. **Hourly sweeper (hygiene only):** `sweepExpiredSessions` registered via `setInterval` in `initJobs`, cleared on graceful shutdown. `updateMany` with a status guard makes overlapping runs no-ops. **Best-effort by design** — see the Cloud Run caveat below.

WebSocket handshake still returns 410 Gone. R2 asset cleanup for expired sessions is not implemented (needs reference checks).

**Sweeper caveat — Cloud Run CPU allocation.** `setInterval` only fires reliably when the instance has CPU always-allocated; by default Cloud Run throttles CPU to near zero between requests, and an instance that recycles more often than an hour would never reach its first tick (the first run fires after the interval, not at boot). The BullMQ workers run in this same process and do process jobs between requests, which strongly implies CPU is already always-allocated — **but this is unverified.** Layer 1 carries all correctness, so a silent sweeper degrades hygiene only. If it needs to be guaranteed, the reliable form is Cloud Scheduler hitting an admin endpoint.

**Known interaction (audit 9.3, still open):** the worker does not check expiry. A session flipped to `FAILED` mid-generation — by either enforcement layer — leaves its in-flight jobs running the full RunPod round-trip. Those pages complete and write `SD_READY`, then `maybeMarkPreviewComplete` no-ops on the status guard, so the GPU spend produces nothing reachable. A cheap status/expiry check at the top of `processJob` closes it.

**Performance:**
- Photo validation moved to frontend — no longer backend concern.
- Every finished page ships a WebP display derivative alongside the print PNG — roughly 250 KB vs 4–5 MB. See §4.
- Warm ComfyUI request per face page: ~90–105s execution + ~10s delay = ~120s wall clock, verified on A40. Cold: 60–180s. Mitigated by Active Workers ≥ 1 + FlashBoot.
- Non-face pages complete in ~1–3s (no RunPod, just R2 hops + text stamp).
- With BullMQ concurrency=5, a 10-page preview with 6 face pages completes in ~220s total (5 in parallel at ~120s, then 1 more at ~120s, non-face pages sprinkled in near-instantly).

**Scalability:**
- In-memory WebSocket rooms → single-instance only. Cloud Run pinned to 1 instance.
- Multi-instance would need Redis pub/sub for WS rooms.
- Photo cache is per-Node-process; multi-instance would give each its own cache (correctness OK, slightly less efficient).