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
| tsx | — | Dev + prod runtime | `tsx watch` in dev, `tsx` in prod. No `tsc` build step. |
| Prisma | 7, `provider = "prisma-client"` | ORM | Uses separate `prisma.config.ts`. No barrel `index.ts` — import from `../generated/prisma/client.js` |
| Neon (PostgreSQL) | via `@prisma/adapter-neon` | Primary DB | Must construct `new PrismaClient({ adapter })` — bare constructor is a bug |
| Cloudflare R2 | Two buckets: `unilake-public`, `unilake-private` | Object storage | Two buckets not one-with-prefixes — R2 public toggle is bucket-level |
| Redis (Upstash) + BullMQ | — | Job queue | Queues: `sd-generation`, `pdf-compilation`. `hd-generation` code commented, not deleted. Priority values must fit 21 bits (max 2,097,151) |
| Better Auth | — | Admin + customer auth | Google + Facebook + email/password. Custom `role` field via `additionalFields` with `input: false` |
| Zod | v4.4.3 | Validation | Middleware only, never in controllers. `ZodIssue` deprecated in v4 — use inline `{ message: string }` |
| Pino | — | Logging | Signature: `logger.info(dataObject, 'message')` — data FIRST. Not Winston. |
| Helmet, CORS | — | Security headers | CORS methods must include PATCH |
| Sharp | 0.35.3 | Image dimension probing + text compositing + JPEG transcode | Installed July 29. Wrapped in `src/lib/image.ts`. No native text primitive — generate SVG then composite. Runs FIRST, before ComfyUI. Also transcodes to JPEG q88 for RunPod payload. |
| react-konva | Recommended to frontend | Admin bubble-mapping UI | Chosen over Fabric/DOM for zoom+pan. Backend endpoints already built |
| Python 3.11.9 (venv) | 3.11.9 | Photo validation (LEGACY — kept, not yet removed) | Cleanup deferred; code retained but no longer called |
| OpenCV, MediaPipe, DeepFace, TensorFlow, tf-keras | — | Photo validation (LEGACY) | Kept for now |
| `child_process.execFile` | Node built-in | Spawn Python (LEGACY) | Cross-platform path via `process.platform` |
| ComfyUI | External, RunPod-hosted | AI image generation | API-calling only, no infra work. Endpoint `bwdfkrlaocqm3o` on client's account. |
| `ws` (npm) | — | WebSocket | `{ noServer: true }` for pre-handshake auth. Rooms via in-memory `Map` |
| Docker | `node:22-bookworm-slim` | Container | Multi-stage build, Python stripped. Final ~250MB |
| Google Cloud Run | `asia-south1` | Hosting | `--min-instances 1`, `--max-instances 1`, `--timeout 3600` |
| Google Artifact Registry | `unilake-images` in `asia-south1` | Docker registry | — |
| GitHub Actions | `.github/workflows/deploy.yml` | CI/CD | Push to `main` → build → push AR → deploy Cloud Run |
| Razorpay | — | Payments | International = separate account setup |
| Shiprocket | — | Shipping | Country name format vs ISO codes = unresolved |
| pdf-lib | Planned | PDF compilation | Not yet used |
| Apidog | — | API testing | Not automated tests |

---

## 4. ARCHITECTURE & DESIGN DECISIONS

**Pattern:** Modular monolith. Single Express app, `routes → controllers → services → lib`. BullMQ workers as separate execution context (started from `server.ts`).

**Entry points:**
- `server.ts` = true entry. `http.createServer(app)` → `setupWebSocket(server)` → `initJobs()` → `server.listen()`.
- `app.ts` = middleware + route mounting only. Never calls `.listen()`. Includes global `BigInt.prototype.toJSON` patch at top.

**BigInt serialization:** `app.ts` patches `BigInt.prototype.toJSON` to return `.toString()`. Native `JSON.stringify` can't handle BigInt values; `PageVersion.seed` is the only BigInt field in the schema. Frontend must type `seed` as `string | null` if consumed.

**Controller pattern:** Validation in middleware only (`validateBody(schema)` on route). Controllers never call `.parse()`. `asyncHandler` wraps controllers inside the export, not on the route line. Every success response goes through `sendSuccess(res, statusCode, data, message?)` from `src/utils/response.ts` — standardized envelope `{ success: true, data, message? }` across all controllers.

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
- **DB before Redis for two-system atomicity**: `enqueuePreviewGenerationJobs` creates all `PageVersion` rows in a `$transaction`, then enqueues to BullMQ AFTER commit. Redis failure leaves orphan QUEUED rows (recoverable) but no DB inconsistency. Session status flip to `GENERATING_PREVIEW` happens AFTER enqueue succeeds.
- **Regenerate uses transactional variant-index computation**: count + cap check + row create all inside `$transaction`. Prevents double-click race producing duplicate `variantIndex` values against the unique constraint.
- **Job payload is `{ pageVersionId }` only**: worker fetches all related data (page, bubbles, fonts, session, comic) from DB. Minimizes queue coupling and makes idempotency simpler.
- **Idempotency guard at top of worker**: if row is already `SD_READY` with `finalImageUrl`, re-emit `page:ready` and return. Handles BullMQ retry-after-ack-lost edge case.
- **Race-safe `PREVIEW_READY` transition**: `maybeMarkPreviewReady` uses `$transaction` with a status guard. Reads session status inside the lock, aborts if not `GENERATING_PREVIEW` (another worker already flipped), counts distinct SD_READY pageIds via `distinct: ["pageId"]`, flips if count reaches `freePreviewPages`. Only fires once. Emits `session:preview-ready`.
- **Per-page generation tunables**: `Page.steps` (Int, default 3, range 1–8) and `Page.cfg` (Float, default 1.0, range 1.0–3.0). Bounds in `src/config/generation.ts`.
- **Asset bucket split**: comic thumbnails, country flags, **page artwork and masks** live in the PUBLIC bucket and store full URLs. Fonts, child photos, and LoRA stay PRIVATE and store raw keys. Frontend always sends a `key`; backend converts via `getPublicUrl()`.
- **Session-owned per-page final images**: every SD_READY row uploads its final image to `sessions/{sessionId}/final/{pageVersionId}.png`. Non-face pages re-upload their stamped image to the same prefix (not a URL-alias to shared comic artwork). Prevents referential breakage if a comic gets deleted.
- **Normalized bubble geometry**: `Bubble.x/y/width/height` are 0–1 fractions of the artwork, never pixels. `Bubble.fontSize` is a fraction of artwork **height**. Resolution-independent — artwork can be re-uploaded at any size without invalidating bubbles. Bounds enforced in Zod (create) and `bubble.service` (partial update).
- **Artwork dimensions are server-derived**: `Page.artworkWidth`/`artworkHeight` probed with Sharp on create/update. Mask must match artwork dimensions exactly (400 on mismatch). Aspect-ratio change on artwork replacement returns a non-blocking `warnings[]` entry.
- Age lives on `OrderSession`, not `Comic`. `Comic.ageGroup` is a browsing filter band.
- **Multi-thumbnail model**: `Comic.coverThumbnailUrls String[] @default([])`, first element is primary, max 10 per comic. PATCH sends full desired array; backend diffs and best-effort R2-cleans up removed URLs.
- No signed URLs to Python — Node downloads to temp file first (`downloadFileToLocalPath` in `r2.ts`).
- Python called via cross-platform path (`process.platform` detection).
- Theme delete blocks if comics linked (409 with count).
- Comic delete blocks if PUBLISHED or has active OrderSessions.
- Country delete blocks if pricing rules reference it (409 with count).
- Font delete blocks if bubbles reference it (409 with count).
- Cross-comic font assignment blocked on bubble update (409).
- R2 cleanup on delete for `CustomerReview` (video), `TeamMember` (image), and `Comic` (all thumbnails). DB row first, R2 cleanup logged on failure. Same cleanup-on-replace pattern applies to `Comic.coverThumbnailUrls` diff on PATCH (removed URLs deleted best-effort).
- `prisma.config.ts` reads `process.env.DIRECT_URL` directly, decoupled from `env.ts`, so `prisma generate` works during Docker build.

**Photo cache (in-memory, per-worker-process):**
- `src/jobs/workers/sd/photoCache.ts` — `Map<sessionId, {bufferPromise, refCount, lastAccessedAt}>`.
- Reference counting: `acquirePhoto` increments, `releasePhoto` decrements, entry evicts when refCount hits zero.
- Promise memoization: first caller triggers R2 download and stores Promise; concurrent callers await the same in-flight fetch.
- Failed downloads self-evict via `.catch`.
- Background sweep every 5 min force-evicts entries idle >15 min as a safety net.
- Purely a burst-optimization for concurrent worker jobs on the same session. Not related to the user's OrderSession lifetime.

**Anonymous → authenticated flow:**
- Anonymous phase: `sessionId` semi-public in URLs, `wsRoomToken` is the actual secret.
- Login before checkout: frontend calls `PATCH /api/sessions/:sessionId/attach-user` after Better Auth callback.
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
- **Order flow:** `OrderSession` (with `userId`, `notificationEmail`, `coverType`, shipping fields), `PageVersion` (unique: `[orderSessionId, pageId, variantIndex]`; pipeline fields `textStampedUrl`, `comfyJobId` nullable, `finalImageUrl`, `seed` BigInt, `errorMessage`), `Order` (with shipping snapshot, `coverType`, `notificationEmail`)
- **User data:** `SavedAddress` (single default per user, ownership-guarded)
- **CMS:** `AnnouncementBar`, `HeroImage`, `CustomerReview`, `TeamMember`, `Feedback`
- **System:** `WebhookEvent` (idempotency), `SystemConfig`

**Enums:** `AgeGroup`, `CoverType`, `GenderTag`, `ComicStatus`, `OrderSessionStatus`, `PronounKey`, `PageVersionStatus`, `OrderStatus`, `FeedbackStatus`.

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

**Retained-but-unused fields (post single-LoRA decision):** `Comic.loraFileUrl`, `Comic.loraStrength`. Kept for schema stability; frontend admin wizard should NOT expose LoRA upload UI.

---

## 6. API DESIGN — ROUTE MAP

REST. Middleware: `validateBody`, `requireAdmin`, `requireLoggedIn`, `errorHandler`, `asyncHandler`. `validateQuery` planned but not built. `validateParams` explicitly decided against.

### Admin routes (`requireAdmin`)
- **Comic:** batch thumbnail upload-URL (`POST /comics/thumbnails/upload-urls`, up to 10 files), LoRA upload-URL (retained-unused), create, admin list (filters), admin detail, PATCH, delete (with R2 cleanup of all thumbnails), status toggle, pricing GET/PUT
- **Country:** upload-URL, create, PUT, list, DELETE (with pricing guard)
- **Page:** list (with nested bubbles), create, upload-URL, PATCH (accepts `steps`, `cfg`, `isPreviewPage`, `hasFace`), DELETE (cascades bubbles)
- **Bubble:** list (with font info), create, PATCH (with cross-comic font guard), DELETE
- **Font:** list (with bubble count), create, upload-URL, PATCH, DELETE (with bubble reference guard)
- **Theme:** POST, PATCH, DELETE
- **AnnouncementBar:** POST, PATCH, status toggle, reorder, list, DELETE
- **HeroImage:** upload-URL, POST, status toggle, list, DELETE
- **CustomerReview:** upload-URL, POST, status toggle, list, DELETE (with R2 cleanup)
- **TeamMember:** upload-URL, POST, PATCH (with R2 cleanup), status toggle, list, DELETE (with R2 cleanup)
- **Feedback:** list (?status), PATCH status, DELETE
- **Orders:** list, detail (planned)

### Customer routes (`requireLoggedIn`)
- `/api/user/addresses` — GET (list), POST (create, auto-default first), PATCH (update, ownership check), DELETE (ownership check, default promotion), POST set-default ($transaction)
- `/api/user/orders` — GET list, GET detail (planned)
- `POST /api/sessions/:id/checkout`, `POST /api/sessions/:id/confirm` (planned)

### Public routes
- `GET /api/public/comics` (filters), `GET /api/public/comics/:id` (includes description, ageGroup, isBestseller, theme, coverType pricing, `coverThumbnailUrls` array)
- `GET /api/public/themes`, `/announcements`, `/hero-images`, `/customer-reviews`, `/team-members`
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
            "status": "SD_READY", "finalImageUrl": "https://...",
            "isSelected": false, "errorMessage": null
          }
        ]
      }
    ]
  }
}
```
Internal fields (`seed`, `textStampedUrl`, `comfyJobId`, `steps`, `cfg`, `pagePrompt`, `rawPhotoUrls`, `photoScoreJson`) are deliberately excluded via explicit `select`. All comic pages are returned (not just preview ones) so frontend can render the full book with paywall overlays on non-preview pages.

### WebSocket event contract (LOCKED — frontend building against this):
- `page:ready` → `{ type: 'page:ready', pageNumber, variantIndex, imageUrl, pageVersionId }`
- `page:error` → `{ type: 'page:error', pageNumber, variantIndex, errorMessage }`
- `session:preview-ready` → `{ type: 'session:preview-ready' }` (no payload)

Frontend must call `GET /sessions/:id` on reconnect to reconcile any missed events (WebSocket events are not queued).

---

## 7. FOLDER STRUCTURE

unilake-backend/
├── Dockerfile # Multi-stage, Python stripped, node:22-bookworm-slim
├── .dockerignore
├── .github/workflows/deploy.yml # GH Actions → Cloud Run
├── prisma/
│ ├── schema.prisma
│ └── migrations/
├── prisma.config.ts # Reads DIRECT_URL from process.env directly
├── requirements.txt # LEGACY — kept for now
├── venv/ # LEGACY — kept for now
├── src/
│ ├── server.ts # Entry point
│ ├── app.ts # Express config, no .listen(). BigInt.prototype.toJSON patch at top.
│ ├── config/{env,generation}.ts + workflows/api-workflow.json
│ ├── scripts/ # LEGACY — kept for now
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
│ │ ├── pdfWorker.ts # STUB
│ │ ├── hdWorker.ts # commented out
│ │ ├── index.ts # initJobs, graceful shutdown
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

**Env vars:** `PORT` (8080), `DATABASE_URL`, `DIRECT_URL`, `R2_*` (7 vars), `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_*`, `FACEBOOK_CLIENT_*`, `NODE_ENV`, `RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY`.

**Critical rules:**
- NO QUOTES in `.env` values. `dotenv` strips them locally, Docker `--env-file` reads raw and breaks (`%22` in URLs).
- `prisma.config.ts` reads `process.env.DIRECT_URL` directly — NOT through `env.ts` (Docker build has no env vars).
- Docker `EXPOSE 8080`, not 3000.
- Source must be COPIED BEFORE `prisma generate` in Dockerfile.
- App must listen on `process.env.PORT` and `0.0.0.0` for Cloud Run.

**Local dev:**
1. `npm install`
2. `npx prisma generate` + migrations
3. `npm run dev` (tsx watch)

**Docker local:**
1. `docker build -t unilake-backend .`
2. `docker run --rm -p 8080:8080 --env-file .env unilake-backend`

**Cloud Run config:** `--min-instances 1`, `--max-instances 1`, `--timeout 3600`, `--memory 1Gi`, `--cpu 1`, `--port 8080`.

**GCP setup:** Artifact Registry `unilake-images` in `asia-south1`. Service account `github-actions-deployer` with `artifactregistry.writer`, `run.admin`, `iam.serviceAccountUser`. Secrets: `GCP_SA_KEY`, `GCP_PROJECT_ID`, `GCP_REGION`.

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
- Country delete blocked if pricing rules reference it.
- Font delete blocked if bubbles reference it.
- Cross-comic font assignment blocked on bubble update.
- R2 cleanup on delete for `CustomerReview`, `TeamMember`, and `Comic` (all thumbnails).
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

**Performance:**
- Photo validation moved to frontend — no longer backend concern.
- Warm ComfyUI request per face page: ~90–105s execution + ~10s delay = ~120s wall clock, verified on A40. Cold: 60–180s. Mitigated by Active Workers ≥ 1 + FlashBoot.
- Non-face pages complete in ~1–3s (no RunPod, just R2 hops + text stamp).
- With BullMQ concurrency=5, a 10-page preview with 6 face pages completes in ~220s total (5 in parallel at ~120s, then 1 more at ~120s, non-face pages sprinkled in near-instantly).

**Scalability:**
- In-memory WebSocket rooms → single-instance only. Cloud Run pinned to 1 instance.
- Multi-instance would need Redis pub/sub for WS rooms.
- Photo cache is per-Node-process; multi-instance would give each its own cache (correctness OK, slightly less efficient).