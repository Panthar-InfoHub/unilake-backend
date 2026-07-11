# Unilake Storybook Backend — Complete Migration Document

---

## ⚠️ LATEST MAJOR CHANGES — July 10, 2026

- **Comic model expanded:** Added `description` (Text), `ageGroup` (enum: AGE_0_2/AGE_3_5/AGE_6_8/AGE_9_12), `isBestseller` (Boolean), `themeId`/`theme` (relation to new Theme model). The SOW's "Age Filter" catalogue feature is now implemented via the `AgeGroup` enum — no longer an open question.
- **Five new domain models added:** `Theme`, `HeroImage`, `CustomerReview`, `TeamMember`, `Feedback` (with `FeedbackStatus` enum: OPEN/VIEWED/RESOLVED/DISMISSED), plus `AnnouncementBar`. Full CRUD for all.
- **Comic CRUD completed:** Admin list with filters (gender, ageGroup, themeId, search), public list with same filters, delete endpoint with active-session and published-status guards. Update endpoint now handles all new fields including theme via Prisma `connect`.
- **Docker setup completed and tested locally:** Dockerfile, .dockerignore, cross-platform Python path fix, prisma.config.ts decoupled from env.ts, `npm start` script added. Backend runs successfully in Docker, connects to all external services (Neon, Upstash, R2).
- **Phase E timing data collected in Docker:** Three photos tested — 17.5s, 14.3s, 14.2s. Confirms the warm Python Flask server is needed (14-17s vs 2s target). Decision upgraded from "open" to "confirmed needed, not yet built."
- **`prisma.config.ts` decoupled from `env.ts`:** Now reads `DIRECT_URL` directly from `process.env` instead of importing the validated config, so `prisma generate` works during Docker build without env vars present.
- **`photoValidation.service.ts` updated:** Python executable path now uses `process.platform` detection to work on both Windows (`venv/Scripts/python.exe`) and Linux/Docker (`venv/bin/python`).
- **`ZodIssue` is deprecated in Zod v4.** Must use inline type `{ message: string }` instead. Affects `comic.controller.ts` and `feedback.controller.ts`.
- **`validateParams` middleware explicitly decided against** — too much retrofitting of existing endpoints for marginal benefit; service-layer `findUnique` → NotFoundError handles bad IDs adequately.
- **Project timeline re-estimated:** ~12-13 working days remaining at 12 hours/day. 8 blocks fully done, 5 mostly done, 13 not started.

---

## 1. PROJECT OVERVIEW

**What this is:** The backend for **Unilake**, a personalized children's storybook platform built for client **Uni Lake Brand Solutions**, developed by **Panthar Infohub Pvt. Ltd.** (Thane, Maharashtra, India). A parent uploads a photo of their child, picks a comic template, and the platform generates a personalized 24-page comic book where the child's face is AI-inserted into the artwork, with personalized dialogue (name, pronouns) stamped into speech bubbles. The free preview page count is per-comic (stored in `Comic.freePreviewPages`); the remaining pages unlock after payment. The finished comic is compiled into a print-ready PDF and physically shipped to the customer.

**Problem it solves:** Lets a non-technical parent get a custom, professionally-illustrated, personalized storybook featuring their own child, without needing any design skill, delivered as a physical printed book.

**End users:** Two distinct audiences:
1. **Anonymous end customers (parents)** — never log in, never authenticate. Tracked only via an `OrderSession` row and a semi-secret `wsRoomToken`.
2. **Admin users** (content authors at the client/agency) — log in via Google/Facebook through Better Auth, create and manage comics, pages, bubbles, fonts, pricing, themes, hero images, customer reviews, team members, announcements, and view feedback.

**Core goal:** Build a working, production-ready Node.js/TypeScript backend that handles the entire flow — comic catalogue → anonymous order session → photo upload/validation → AI-generated preview pages → payment → AI-generated full/HD pages → PDF compilation → shipping — with a complete CMS admin panel for managing all website content.

**Current overall stage:** In progress, actively being built day-by-day. The developer ("Guts," ~6 months of backend experience) is the sole backend technical lead, making all architectural decisions solo. As of this handoff:
- Days 1–3: fully complete.
- Day 4 Block 1 (generate trigger + regenerate endpoint): complete.
- Day 4 Block 2 (Page/Bubble/Font admin endpoints + unified comic update + LoRA upload): complete.
- Day 4 Block 3 (real Python photo validation): Phases A–D complete. Phase E partially done (Docker timing data collected: 17.5s, 14.3s, 14.2s — warm server confirmed needed but not yet built).
- Day 4 Block 4 (seeding real comic data): not started.
- CMS CRUD features (Theme, Announcement, Hero Images, Customer Reviews, Team Members, Feedback): **ALL COMPLETE**.
- Comic CRUD expansion (description, ageGroup, isBestseller, themeId, delete, admin list with filters, public list with filters): **COMPLETE**.
- Docker setup: **COMPLETE and tested locally**.
- Days 5–16 core pipeline work: not started (SD worker, Sharp text-stamping, payments, HD/PDF pipeline, shipping, final testing).

**Deadlines/timelines:** Originally scoped as a 15–16 day sprint. Sprint pace has consistently run longer than original estimates. Current realistic estimate: **~12-13 more working days** at 12 hours/day to complete the full product (not MVP).

---

## 2. SYSTEM PROMPT FOR NEW CLAUDE

```
You are acting as a senior backend engineer and technical pair-programmer for "Guts," the sole backend developer on Unilake — a personalized children's comic book platform. Guts has approximately 6 months of professional backend experience and is working solo on this backend while a separate frontend team builds in parallel. Guts has ZERO prior Python experience (has never even run "hello world" in Python before this project), despite the project requiring a Python subprocess component — treat any Python-related explanation as needing full beginner-level detail: venv setup, pip, syntax, everything, nothing assumed.

Your role:
- Function as a thoughtful senior engineer, not just a code generator. Proactively flag design gaps, race conditions, security issues, and scope creep — the same way you would review a junior colleague's PR.
- When Guts proposes something that conflicts with an already-finalized decision (see the attached project document's "not open for re-debate" and "mistakes made and corrected" sections), do not silently comply — point out the conflict and ask for explicit confirmation before proceeding.
- When a request is ambiguous or underspecified, make a reasonable assumption, state it plainly, and proceed — don't stall on excessive clarifying questions, but don't guess silently on anything consequential either.
- Push back constructively when you believe an approach is wrong, but always let Guts make the final call — you are advising, not overriding.
- Be honest about trade-offs, including time/complexity costs. If something will genuinely take hours of debugging-prone work, say so plainly rather than downplaying it.

Communication style:
- Match Guts's own communication style: plain, unembellished, functional English — Guts frequently writes in a hurried, slightly informal register, and does not expect polished prose in return, just clarity.
- Guts wants a plain-language "what and why" alongside implementation steps — never a pure code dump. Explain concepts before or alongside code.
- Guts prefers task breakdowns in strict chronological execution order, each with an explicit verification/testing step.
- Guts actively values being told when they're wrong, and dislikes being over-praised or having mistakes glossed over. Do not pad responses with unnecessary affirmation.
- Guts explicitly asks for confirmation before proceeding on decisions — respect this "confirm before you proceed" working style.
- If Guts says an explanation is too complex, simplify it immediately without being asked twice.
- When giving code, give COMPLETE functions/files, not partial snippets to "fill in later" — Guts has explicitly flagged that half-finished code across multiple messages causes confusion, and wants each step to be a complete, pasteable unit.

What you must NEVER do:
- Never suggest NestJS, Winston (logging), Socket.IO, MongoDB, a single R2 bucket with prefixes, Prisma's `connect` for pricing rules, hardcoded free-preview-page counts, comic-level generation prompts, or a `userId` field on `OrderSession` — all explicitly rejected, finalized decisions (full reasoning in the attached document, Section 4 and Section 13).
- Never suggest ComfyUI installation, hosting, or infrastructure work — the developer only integrates with ComfyUI's existing hosted API, this was an explicit early correction.
- Never revert `PageVersion` to use a bare `pageNumber Int` instead of the `pageId` FK — this was a deliberate, developer-identified schema fix, permanent.
- Never revert the WebSocket server to `{ server: httpServer }` — the `{ noServer: true }` pattern is permanent and intentional.
- Never suggest the old MediaPipe `mp.solutions` API for face detection — it is fully removed in the installed MediaPipe version; only the Tasks API works.
- Never suggest Python versions other than 3.11.x for this project's venv — Python 3.14 is confirmed incompatible with TensorFlow/DeepFace.
- Never re-propose the pupil-shape contour or frame-bridge-uniformity approaches to sunglasses detection — both were tried, tested with real photos, and rejected. The current brightness+uniformity heuristic with documented limitations is the final decision unless new evidence changes the calculus.
- Never suggest building a `validateParams` middleware — explicitly decided against due to retrofit cost across all existing endpoints; service-layer NotFoundError handles bad IDs adequately.
- Never assume a task is fully finished just because it was discussed — check the "in progress" and "open questions" sections before assuming something is done.

Working style preferences observed:
- Guts tests via Apidog, not automated test suites, at this stage.
- Guts's shell environment is Git Bash inside VS Code (switched from PowerShell mid-project) — give Git Bash-syntax commands (forward slashes, `source venv/Scripts/activate`) by default, unless told the environment changed again.
- Guts values seeing real debug evidence (actual error text, actual measured numbers, actual output) before accepting a fix or conclusion — avoid guessing fixes without first proposing how to gather evidence.
- Guts wants honest, evidence-based recommendations on trade-offs (e.g., "should we keep debugging this heuristic or accept the limitation") rather than open-ended lists with no clear steer — always end trade-off discussions with a clear personal recommendation and the reasoning behind it.
- Guts prefers the `asyncHandler` wrapper to be applied inside the controller export (not on the route line) — this is the established pattern for all new endpoints.
```

---

## 3. COMPLETE TECH STACK

| Technology | Version (if known) | Why chosen | Responsibility | Alternatives considered & rejected |
|---|---|---|---|---|
| **Express.js** | v5 | Faster to scaffold for a junior/solo dev than a DI-container framework; v5 specifically required for its wildcard route syntax used in the codebase. | Core HTTP server framework. | **NestJS** — rejected for unnecessary DI-container overhead given solo dev context. |
| **TypeScript (ESM)** | `"type": "module"` in package.json | Project-wide convention. | Type safety; all imports use `.js` extensions even in `.ts` source files (Node ESM requirement, not optional). | — |
| **tsx** | — | Developer's chosen dev-server/hot-reload tool. Also used as the production runtime (via `npm start` → `tsx src/server.ts`). | Local dev server with hot reload (`tsx watch`); production runtime (`tsx` without watch). | **nodemon** — not chosen. Compiling TypeScript to JS via `tsc` — not set up (tsconfig has no `outDir`), deferred as unnecessary at current scale. |
| **Prisma** | 7, `provider = "prisma-client"` | ORM. | All database access. Note: Prisma 7 uses a separate `prisma.config.ts` file for datasource URL config, not inline in `schema.prisma`. Generated client has **no barrel `index.ts`** — always import `PrismaClient`/`Prisma` namespace from `../generated/prisma/client.js` directly. | `"prisma-client-js"` generator provider — not used; the newer `"prisma-client"` provider was chosen instead. |
| **Neon (PostgreSQL)** | via `@prisma/adapter-neon` | Serverless-friendly Postgres. | Primary relational database. `PrismaClient` **must** be constructed with `new PrismaClient({ adapter })` — a real bug occurred once from a bare `new PrismaClient()` call in `auth.ts` (see Section 13). | — |
| **Cloudflare R2** | Two separate buckets: `unilake-public`, `unilake-private` | No egress fees (matters for repeated PDF/page downloads); no need for image-transformation features since ComfyUI+Sharp already handle that; stores non-image files (fonts, PDFs) too. Two buckets (not one with path prefixes) because R2's public-access toggle is bucket-level, not folder-level — this makes public/private structural, not convention-based. | Object storage for all uploaded/generated files. | **Cloudinary/ImageKit** — rejected, transformation features unused. **Single bucket with prefixes** — rejected, structural safety of two buckets preferred. |
| **Redis (Upstash) + BullMQ** | — | Jobs run long (ComfyUI calls), need controlled concurrency (can't flood the GPU server), need to survive process restarts, triggered by webhooks with no browser necessarily connected. | Async job queue for AI generation work (`sd-generation`, `hd-generation`, `pdf-compilation` queues). | **DB-polling-table** — explicitly considered and rejected in favor of BullMQ. |
| **Better Auth** | — | Supports Google + Facebook social login plus email/password; custom `role` field added via `additionalFields` with `input: false` so users can never self-assign admin. | Admin-only authentication. | **Raw JWT** — not chosen. |
| **Zod** | v4.4.3 | — | Request validation, used exclusively in middleware (never in controllers — see Section 4). **Note:** `ZodIssue` type is deprecated in Zod v4 — use inline `{ message: string }` type instead. | — |
| **Pino** | — | ⚠️ Note: earlier project docs incorrectly referenced "Winston" — this was corrected; Pino is and always was the actual implemented logger. | Logging, via `src/lib/logger.ts`, with `pino-pretty` transport in dev only. **Critical:** call signature is `logger.info(dataObject, 'message string')` — data object FIRST, opposite of Winston-style calls. Getting this backwards causes real `ts(2769)` TypeScript overload errors. | **Winston** — never actually used; stale docs incorrectly referenced it. |
| **Helmet, CORS** | — | Low-cost header security; relevant since the app serves user-uploaded images and payment-adjacent data. | Standard security headers / cross-origin config. | — |
| **Sharp** | — | Needed to composite personalized dialogue text onto generated comic pages. Sharp has no native "draw nice text" primitive — actual text rendering is done by generating an SVG with the text, then compositing that SVG onto the base image via Sharp. | Image compositing for text-stamping. Always runs LAST, after all ComfyUI generation — running before generation risks ComfyUI distorting/covering stamped text. | — |
| **Konva.js or Fabric.js** | Planned, not yet built | Needed for the admin-side bubble-mapping UI (drag rectangles onto artwork, get pixel coordinates back). | Day 8–9 frontend tool. Backend endpoints receiving these coordinates are already built (Block 2). | — |
| **Python 3.11.9** (via a dedicated `venv`) | 3.11.9 specifically | **Python 3.14 (the default/latest from python.org) is confirmed incompatible with TensorFlow** — `pip install deepface` on 3.14 triggers extensive dependency backtracking and fails with `ResolutionImpossible` since no TensorFlow build supports 3.14 yet. | Runs the photo validation script. Created via `py -3.11 -m venv venv`; coexists on the same machine as the default Python 3.14 install without conflict. In Docker, the system Python 3 is used via `python3 -m venv venv`. | Using the machine's default Python (3.14) — tried first, failed, corrected. |
| **OpenCV (`opencv-python`)** | — | Node has no mature equivalent for image loading/processing at this level. | Image loading, cropping, grayscale conversion, brightness/variance analysis for the sunglasses heuristic. | — |
| **MediaPipe** | 0.10.35 | Industry-standard face detection. | Face detection and facial keypoint extraction (eyes, nose, mouth, ears). **Critical: this version has fully removed the old `mp.solutions` "Solutions" API.** Must use the newer **Tasks API** (`mediapipe.tasks.python.vision.FaceDetector`) with an explicitly downloaded `.tflite` model file (`blaze_face_short_range.tflite`, stored at `src/scripts/models/`). | The old `mp.solutions.face_detection` API — attempted first (matches most online tutorials/docs), failed with `AttributeError` then `ModuleNotFoundError` when explicit-imported — fully removed in this version, not a bug on the developer's part. |
| **DeepFace** | 0.0.100 | Industry-standard facial expression analysis. | Emotion/expression check (rejects photos where `dominant_emotion` is `fear`, `disgust`, or `angry`). Requires `enforce_detection=False` since face presence is already confirmed via MediaPipe beforehand. | **LLM-based photo validation** — rejected (too slow for the <2s budget, ongoing per-call cost, non-deterministic, answers the wrong question). **Google Cloud Vision API** — rejected for the same reasons. |
| **TensorFlow** | 2.21.0 | Underlying deep learning engine required by DeepFace. | Powers DeepFace's emotion model. | — |
| **tf-keras** | — | **DeepFace's internal `RetinaFace` submodule requires this specifically when using TensorFlow 2.21+** — without it, `from deepface import DeepFace` fails with `ValueError: You have tensorflow 2.21.0 and this requires tf-keras package`. | Compatibility shim between TensorFlow's built-in Keras 3 and libraries (like RetinaFace) still expecting the older, separate Keras package. | — |
| **`child_process.execFile` (Node built-in)** | — | Standard, dependency-free way for Node to run an external program and capture its output. | Node spawns the Python validation script per request, reads its printed JSON from stdout. Called against a **cross-platform path** using `process.platform` detection: `venv/Scripts/python.exe` on Windows, `venv/bin/python` on Linux/Docker. | Sending Python a signed R2 URL instead — considered, rejected (see Section 4/13). A persistent warm Python server — confirmed needed based on timing data, not yet built (see Section 12). |
| **ComfyUI** | External, RunPod-hosted | AI image generation (style-conversion then face-swap workflows). | **Scope is strictly API-calling only** — the developer does NOT set up, host, or manage the ComfyUI server itself; this was an explicit early correction. The base Stable Diffusion model lives on the ComfyUI server (referenced only by a hardcoded constant name). The LoRA file path is read from `Comic.loraFileUrl` and included in the ComfyUI workflow JSON. | — |
| **`ws`** (npm package) | — | Nothing in the stack needs Socket.IO's extra machinery (rooms-as-a-feature, fallback transports) — rooms are built manually via an in-memory `Map`. | WebSocket server for live page-generation updates. **Constructed with `{ noServer: true }`**, not `{ server: httpServer }` — deliberate choice to support pre-handshake authentication (full reasoning in Section 4). | **Socket.IO** — rejected as unnecessary overhead. `{ server: httpServer }` WebSocket pattern — considered, rejected (see Section 4). |
| **Docker** | node:22-bookworm base image | Containerization for deployment. Dockerfile installs both Node and Python + system libraries (`libgl1`, `libglib2.0-0` for OpenCV). | Packaging the app for deployment. Tested locally, connects to all external services. | Alpine-based image — rejected because OpenCV/MediaPipe need system-level C libraries that are painful to compile on Alpine. |
| **Razorpay** | — | Payments, both domestic (India) and international. | International requires separate account-level configuration outside the codebase — flagged as an external dependency/blocker risk. | — |
| **Shiprocket** | — | Shipping/delivery, domestic + international. | International requires customs declaration fields not present in the domestic flow. Country-name string format vs. our ISO codes is an unverified open question. | — |
| **pdf-lib** | Planned, not yet used | — | Will compile 24 HD page images into a single print-ready PDF. | — |
| **Apidog** | — | Developer's chosen API-testing tool. | All manual endpoint testing during this project (not an automated test suite at this stage). | — |

---

## 4. ARCHITECTURE & DESIGN DECISIONS

**Overall architecture pattern:** Modular monolith. A single Express app, organized as `routes → controllers → services → lib`, with BullMQ workers running as a separate execution context (started from `server.ts`, not `app.ts`). This is explicitly **not microservices** — one deployable backend.

**How components connect:**
- `server.ts` is the true entry point: creates the raw HTTP server (`http.createServer(app)`), calls `setupWebSocket(server)`, calls `initJobs()` to start BullMQ workers, then `server.listen()`.
- `app.ts` only configures Express middleware and mounts routes — it never calls `.listen()`.
- Routes delegate to controllers, which validate nothing themselves (validation lives in middleware) and pass `req.body`/params straight to service functions.
- Services contain all actual business logic and talk to Prisma, R2, BullMQ queues, and (for photo validation) the Python subprocess.
- BullMQ workers run independently, picking up jobs enqueued by services, and communicate results back to connected clients via the WebSocket layer (`emitPageReady`/`emitPageError`).

**Controller pattern (finalized):** Validation happens in middleware only (`validateBody(schema)` on the route). Controllers **never** call `.parse(req.body)` themselves — double-validation (middleware + controller both parsing) was identified as a real bug pattern and corrected. The `asyncHandler` wrapper is applied **inside the controller export** (not on the route line) — this is the established convention for all endpoints.

**Anonymous session model:** End customers never authenticate. The server never tracks "who" a customer is — only "does the caller possess the right token." `sessionId` is treated as semi-public (used in URLs/REST calls); `wsRoomToken` is the actual secret, checked only for the WebSocket connection. Recommended (not yet built by frontend) recovery pattern: store `sessionId` + `wsRoomToken` in `localStorage`, on page load call `GET /api/sessions/:sessionId`, and use the `isExpired` flag (or a 404) to decide whether to restore or restart. This is same-device-only recovery, bounded by `expiresAt` TTL.

**Major design decisions and reasoning (not already covered by the tech stack table):**

- **`OrderSession` created EARLY**, as soon as a parent starts engaging with the form, with just `{ comicId }` in the body. `childName`/`age`/`pronounKey` are nullable and filled in progressively via `PATCH /api/sessions/:sessionId`, in any order, across multiple calls. This allows photo upload/validation to happen in parallel with form-filling, in any order. **Rejected alternative:** a separate temporary/anonymous upload-tracking mechanism, moved into a session later — rejected because it requires strictly more mechanism (an R2 copy/move operation) than just creating the cheap `OrderSession` row early.

- **WebSocket connects immediately after session creation**, not at "Generate" time.

- **`{ noServer: true }` WebSocket pattern**, not `{ server: httpServer }`. Reasoning: with `{ server }`, the handshake completes automatically before any application code runs, meaning an invalid/expired token can only be rejected *after* a real WebSocket connection already exists (wasteful, and the `ws` library's own docs discourage `verifyClient` for this). `{ noServer: true }` lets the auth check run during the raw HTTP `upgrade` event, *before* `wss.handleUpgrade()` is called — invalid connections are refused via a raw HTTP response (`socket.write` + `socket.destroy()`), no WebSocket object is ever created for them.

- **Single photo per session, not two.** `rawPhotoUrls` stays an array field but only ever has 0 or 1 entries. The `status === 'CREATED'` guard on photo endpoints is a permanent rule (not a temporary judgment call) — it's also what naturally enables retry after a failed validation, with zero extra retry-specific code.

- **`bestPhotoUrl` set ONLY on validation pass; `status` only advances to `PHOTO_UPLOADED` on pass.** On fail, only `rawPhotoUrls` and `photoScoreJson` are written — `status` stays `CREATED`, letting the parent retry via the existing upload-URL/validate endpoints. **This is now fully implemented** (see Section 9).

- **Free preview page count is per-comic (`Comic.freePreviewPages`), never hardcoded.** The generate-trigger endpoint reads this value per-comic and fetches real `Page` rows up to that count, rather than looping a counter — ensuring jobs are only enqueued for pages that actually exist.

- **`PageVersion` uses a real `pageId` FK, not a bare `pageNumber Int`.** This was a developer-identified design gap — a bare integer had no database-level enforcement that it corresponded to a real `Page` row. `pageNumber` still appears in job payloads and WebSocket events, but purely as a descriptive/display field — it is never used for database lookups. The human-facing regenerate URL (`/pages/:pageNumber/regenerate`) accepts `pageNumber`, but the service immediately resolves the real `Page` row via the `comicId_pageNumber` compound unique key and returns 404 if it doesn't exist for that comic.

- **Prompts are page-specific only (`Page.pagePrompt`).** `Comic.generationPrompt`/`generationNegativePrompt` were considered and explicitly rejected — client decision, since different pages need different emotional directions and ComfyUI receives per-page data regardless.

- **Unified `PATCH /api/admin/comics/:comicId`** for all plain-scalar comic field updates (title, genderTag, pageCount, freePreviewPages, loraStrength, description, ageGroup, isBestseller, themeId, loraKey). Separate, dedicated endpoints exist only where an upload flow or special guard logic is involved (`status`, `coverThumbnailUrl`, `loraFileUrl` via `loraKey`). The `themeId` update uses Prisma's `{ connect: { id: data.themeId } }` pattern for relation linking.

- **SD variant cap: 3 per page. HD variant cap: 8 per page.** Fixed, app-wide constants in `src/config/generation.ts` (`MAX_SD_VARIANTS_PER_PAGE`, `MAX_HD_VARIANTS_PER_PAGE`) — not per-comic configurable.

- **Age lives on `OrderSession`, not `Comic`.** Dual purpose: an `{age}` dialogue token (Day 6 work) and a ComfyUI style-conversion prompt parameter (Day 5 work). The SOW's "Age Filter" catalogue feature is now implemented as `ageGroup` (an `AgeGroup` enum) on the `Comic` model — these are distinct: `OrderSession.age` is a specific child's age, `Comic.ageGroup` is a browsing filter band.

- **No signed URL is ever generated for Python to fetch a photo — permanent decision, not a shortcut.** Node already has direct credentialed R2 access; handing Python a signed URL would mean giving Python its own R2/S3 client and credentials (new dependency, new attack surface, duplicated responsibility), plus Python would need its own network error/retry/timeout handling, duplicating logic that already exists cleanly on the Node side. Final pattern: Node downloads the photo to a local temp file first (`downloadFileToLocalPath` in `r2.ts`); Python only ever receives and operates on local file paths.

- **Node calls Python via a cross-platform path** using `process.platform === "win32"` detection. On Windows: `venv/Scripts/python.exe`. On Linux/Docker: `venv/bin/python`. Never a bare `python` command that depends on the calling terminal's PATH/activation state.

- **The current Python integration architecture is spawn-per-request (`execFile`), not a persistent warm server.** Docker timing data (17.5s, 14.3s, 14.2s across 3 photos) has confirmed this is inadequate for the <2s target. The warm Python Flask server is confirmed needed but not yet built (see Section 12).

- **Theme deletion blocks if comics are linked.** Returns a 409 error with the count of linked comics. Admin must unlink comics first.

- **Comic deletion has two guards:** blocks if status is `PUBLISHED` (must unpublish first), and blocks if there are any active (non-terminal) `OrderSession`s. Terminal statuses (`COMPLETED`, `FAILED`) are fine.

- **`validateParams` middleware was explicitly decided against.** Too much retrofit cost across all existing endpoints for marginal benefit. Service-layer `findUnique` → `NotFoundError` handles bad IDs adequately.

- **R2 cleanup on delete:** `CustomerReview` and `TeamMember` delete endpoints extract the R2 key from the stored public URL and call `deleteFile` to remove the orphaned asset. DB row is deleted first; R2 cleanup failure is logged as a warning but doesn't crash the request. `TeamMember` update with a new `imageKey` also cleans up the old image from R2.

- **`prisma.config.ts` decoupled from `env.ts`:** Reads `process.env.DIRECT_URL` directly instead of importing the validated config object. This allows `prisma generate` to run during Docker build without any environment variables present.

---

## 5. DATABASE & SCHEMA

**Database system:** PostgreSQL, hosted on **Neon** (serverless-friendly), accessed via Prisma 7 with the `@prisma/adapter-neon` driver adapter.

**Schema file:** `prisma/schema.prisma` — single file, contains both Better Auth's auto-generated models and all domain models together.

**Auth models (generated by Better Auth's CLI, not hand-written):**
- `User` — includes a custom `role` field (`String @default("USER")`) added via Better Auth's `additionalFields` mechanism, with `input: false` so it can never be self-assigned via the API.
- `Session` — Better Auth's own login-session model. **Critical naming note:** this is completely unrelated to `OrderSession` (see below); `wsServer.ts` never imports from `lib/auth.ts` or references this model.
- `Account`
- `Verification`

**Domain models (current, finalized shape):**

> ⚠️ Changed in latest session: Comic model expanded with description, ageGroup, isBestseller, themeId/theme. AgeGroup enum and Theme model added. Five new CMS models added: HeroImage, CustomerReview, TeamMember, Feedback (with FeedbackStatus enum), AnnouncementBar.

```prisma
enum AgeGroup {
  AGE_0_2
  AGE_3_5
  AGE_6_8
  AGE_9_12
}

model Theme {
  id   String @id @default(uuid())
  name String @unique

  comics Comic[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("themes")
}

enum GenderTag {
  BOY
  GIRL
  UNISEX
}

enum ComicStatus {
  DRAFT
  PUBLISHING
  PUBLISHED
  UNPUBLISHED
}

model Comic {
  id                String      @id @default(uuid())
  title             String
  genderTag         GenderTag
  pageCount         Int
  freePreviewPages  Int
  description       String?     @db.Text
  ageGroup          AgeGroup?
  isBestseller      Boolean     @default(false)
  themeId           String?
  theme             Theme?      @relation(fields: [themeId], references: [id])
  coverThumbnailUrl String?
  loraFileUrl       String?
  loraStrength      Float       @default(1.0)
  status            ComicStatus @default(DRAFT)
  publishJobId      String?
  publishError      String?

  pages         Page[]
  fonts         Font[]
  pricingRules  PricingRule[]
  orderSessions OrderSession[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("comics")
}
```
No `basePrice`/`baseCurrency` fields (removed partway through Day 2). No `generationPrompt`/`generationNegativePrompt` fields (prompts are page-specific only).

```prisma
model Page {
  id      String @id @default(uuid())
  comicId String
  comic   Comic  @relation(fields: [comicId], references: [id], onDelete: Cascade)

  pageNumber Int
  artworkUrl String?
  maskUrl    String?

  hasFace       Boolean @default(false)
  mirrorFace    Boolean @default(false)
  faceDirection String?
  isPreviewPage Boolean @default(false)
  pagePrompt    String? @db.Text

  bubbles     Bubble[]
  pageVersion PageVersion[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([comicId, pageNumber])
  @@map("pages")
}
```
`hasFace` plus whether the page has any `Bubble` rows together determine which of three generation paths a page needs (see Section 11, Day 5 plan).
⚠️ VERIFY: the Prisma field name for the opposite relation to `PageVersion` is `pageVersion` (singular) in the actual schema file, though most planning documentation refers to it as `pageVersions` (plural) — confirm which is actually correct in the live `schema.prisma` before writing any code that queries this relation via `include`.

```prisma
model Bubble {
  id     String @id @default(uuid())
  pageId String
  page   Page   @relation(fields: [pageId], references: [id], onDelete: Cascade)

  x      Float
  y      Float
  width  Float
  height Float

  dialogue String  @db.Text
  fontId   String?
  font     Font?   @relation(fields: [fontId], references: [id])
  fontSize Int     @default(24)

  sortOrder Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("bubbles")
}
```
`dialogue` contains `{name}`/`{pronoun_subject}`/`{pronoun_object}`/`{pronoun_possessive}` tokens, and will need an `{age}` token added (Day 6 work).

```prisma
model Font {
  id      String @id @default(uuid())
  comicId String
  comic   Comic  @relation(fields: [comicId], references: [id], onDelete: Cascade)

  name    String
  fileUrl String
  bubbles Bubble[]

  createdAt DateTime @default(now())

  @@map("fonts")
}

model PricingRule {
  id        String  @id @default(uuid())
  comicId   String
  comic     Comic   @relation(fields: [comicId], references: [id], onDelete: Cascade)
  countryId String
  country   Country @relation(fields: [countryId], references: [id])
  price     Decimal @db.Decimal(10, 2)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([comicId, countryId])
  @@map("pricing_rules")
}

model Country {
  id           String  @id @default(uuid())
  code         String  @unique
  name         String
  currencyCode String
  flagUrl      String
  isActive     Boolean @default(true)

  pricingRules PricingRule[]
}
```

```prisma
model AnnouncementBar {
  id        String   @id @default(uuid())
  message   String
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("announcement_bars")
}

model HeroImage {
  id        String   @id @default(uuid())
  imageUrl  String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("hero_images")
}

model CustomerReview {
  id           String   @id @default(uuid())
  customerName String
  description  String   @db.Text
  videoUrl     String
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("customer_reviews")
}

model TeamMember {
  id           String   @id @default(uuid())
  name         String
  role         String
  description  String?  @db.Text
  imageUrl     String?
  linkedinUrl  String?
  instagramUrl String?
  twitterUrl   String?
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@map("team_members")
}

enum FeedbackStatus {
  OPEN
  VIEWED
  RESOLVED
  DISMISSED
}

model Feedback {
  id        String         @id @default(uuid())
  name      String
  email     String
  phone     String
  message   String         @db.Text
  status    FeedbackStatus @default(OPEN)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  @@map("feedbacks")
}
```

```prisma
enum OrderSessionStatus {
  CREATED
  PHOTO_UPLOADED
  GENERATING_PREVIEW
  PREVIEW_READY
  AWAITING_PAYMENT
  PAID
  GENERATING_PAID
  PAID_PAGES_READY
  CONFIRMED
  GENERATING_HD
  COMPILING_PDF
  DISPATCHED
  COMPLETED
  FAILED
}

enum PronounKey {
  HE
  SHE
  THEY
}

model OrderSession {
  id      String @id @default(uuid())
  comicId String
  comic   Comic  @relation(fields: [comicId], references: [id])

  childName  String?
  pronounKey PronounKey?
  age        Int?
  status     OrderSessionStatus @default(CREATED)

  rawPhotoUrls   String[]
  bestPhotoUrl   String?
  photoScoreJson Json?

  shippingName    String?
  shippingLine1   String?
  shippingLine2   String?
  shippingCity    String?
  shippingState   String?
  shippingZip     String?
  shippingCountry String?
  shippingPhone   String?

  wsRoomToken String @unique @default(uuid())

  pageVersions PageVersion[]
  order        Order?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  expiresAt DateTime

  @@map("order_sessions")
}

enum PageVersionStatus {
  QUEUED
  GENERATING_SD
  SD_READY
  GENERATING_HD
  HD_READY
  FAILED
}

model PageVersion {
  id             String       @id @default(uuid())
  orderSessionId String
  orderSession   OrderSession @relation(fields: [orderSessionId], references: [id], onDelete: Cascade)

  pageId String
  page   Page   @relation(fields: [pageId], references: [id])

  variantIndex Int     @default(0)
  seed         BigInt?

  comfyPromptId1 String?
  comfyPromptId2 String?
  comfyPromptId3 String?

  sdImageUrl      String?
  textRenderedUrl String?
  hdImageUrl      String?

  isSelected   Boolean           @default(false)
  status       PageVersionStatus @default(QUEUED)
  errorMessage String?
  retryCount   Int               @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([orderSessionId, pageId, variantIndex])
  @@index([orderSessionId, pageId])
  @@map("page_versions")
}

enum OrderStatus {
  CREATED
  PAID
  GENERATING
  CONFIRMED
  PDF_READY
  DISPATCHED
  DELIVERED
  FAILED
  REFUNDED
}

model Order {
  id             String       @id @default(uuid())
  orderSessionId String       @unique
  orderSession   OrderSession @relation(fields: [orderSessionId], references: [id])

  amount      Decimal @db.Decimal(10, 2)
  currency    String
  countryCode String

  razorpayOrderId   String?     @unique
  razorpayPaymentId String?     @unique
  status            OrderStatus @default(CREATED)

  pdfUrl            String?
  pdfDownloadUrl    String?
  pdfDownloadExpiry DateTime?

  shiprocketOrderId String?
  awbNumber         String?
  courierName       String?
  trackingStatus    String?
  trackingUpdatedAt DateTime?
  isInternational   Boolean   @default(false)

  printVendorOrderId String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  webhookEvents WebhookEvent[]

  @@map("orders")
}

model WebhookEvent {
  id      String  @id @default(uuid())
  orderId String?
  order   Order?  @relation(fields: [orderId], references: [id])

  source      String
  eventId     String   @unique
  eventType   String
  payloadJson Json
  processedAt DateTime @default(now())

  @@map("webhook_events")
}

model SystemConfig {
  key       String   @id
  value     String   @db.Text
  updatedAt DateTime @updatedAt

  @@map("system_config")
}
```

**Relationships summary:** `Comic` 1→many `Page`, `Font`, `PricingRule`, `OrderSession`. `Theme` 1→many `Comic`. `Page` 1→many `Bubble`, `PageVersion`. `Font` 1→many `Bubble`. `Country` 1→many `PricingRule`. `OrderSession` 1→many `PageVersion`, 1→1 `Order`. `Order` 1→many `WebhookEvent`. `Comic`↔`Country` many-to-many through `PricingRule`.

**Cascade rules:** Deleting a `Comic` cascades to its `Page`, `Font`, `PricingRule`. Deleting a `Page` cascades to its `Bubble`. An `OrderSession` does NOT cascade-delete if its parent `Comic` changes — a customer's in-progress order should never vanish because an admin edited a comic. Deleting a `Theme` does NOT cascade to `Comic` — blocked at the application layer if comics are linked.

**Migrations run so far:**
- `make_order_session_personal_fields_optional` (Day 3)
- `add_page_version_variant_unique_constraint` (Block 1)
- `pageversion_use_pageid_fk` (Block 1)
- `add_comic_prompts_and_pageid_fk` (Block 2)
- `add_theme_agegroup_bestseller` (latest session — added AgeGroup enum, Theme model, and description/ageGroup/isBestseller/themeId on Comic)
- `add_hero_images` (latest session)
- `add_customer_reviews` (latest session)
- `add_team_members` (latest session)
- `add_feedbacks` (latest session)

⚠️ VERIFY: the `AnnouncementBar` model migration name was not explicitly recorded — confirm the actual migration name in `prisma/migrations/`.

---

## 6. API DESIGN

**API style:** REST, no explicit alternative discussed or considered.

**Authentication/authorization:** Admin routes (`/api/admin/*`) guarded by a `requireAdmin` Express middleware calling Better Auth's `auth.api.getSession()` plus an explicit `session.user.role === 'ADMIN'` check — a valid login alone is insufficient, since any Google/Facebook user can log in but only `ADMIN`-flagged users may proceed (role is set manually in the DB, never self-assignable). Public routes (`/api/comics`, `/api/sessions/*`, `/api/themes`, `/api/hero-images`, `/api/customer-reviews`, `/api/team-members`, `/api/announcements`, `/api/feedbacks`) have no auth guard at all — end customers never log in.

**Middleware discussed:**
- `validateBody(schema)` — generic Zod-validation middleware, applied at the router level for `req.body`. Controllers never call `.parse()` themselves.
- `validateQuery` — **planned but not yet built.** Several handlers (`getPublicComicsHandler`, `getAdminComicsHandler`, `getAllFeedbacksHandler`) validate `req.query` manually as a stopgap.
- `validateParams` — **explicitly decided against.** Too much retrofit cost across all existing endpoints for marginal benefit.
- `requireAdmin` — see above.
- `errorHandler` — centralized 4-argument Express error middleware, mounted last in `app.ts`.
- `asyncHandler` — wraps async controllers (applied inside controller exports, not on route lines).

### Endpoints — Country

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/countries/upload-url` | Presigned upload URL for a country flag image (public bucket) | Admin |
| POST | `/api/admin/countries` | Create a country | Admin |
| PUT | `/api/admin/countries/:countryId` | Update an existing country | Admin |
| GET | `/api/admin/countries` | List all countries | Admin |

### Endpoints — Comic

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/comics/thumbnail/upload-url` | Presigned upload URL for thumbnail | Admin |
| POST | `/api/admin/comics/lora/upload-url` | Presigned upload URL for LoRA file | Admin |
| POST | `/api/admin/comics` | Create comic (with pricing, themeId, ageGroup, description, isBestseller) | Admin |
| GET | `/api/admin/comics` | Admin list with filters (?gender, ?ageGroup, ?themeId, ?search) | Admin |
| PATCH | `/api/admin/comics/:comicId` | Update any comic fields including new ones | Admin |
| DELETE | `/api/admin/comics/:comicId` | Delete comic (blocks if published or has active sessions) | Admin |
| PATCH | `/api/admin/comics/:comicId/status` | Publish/unpublish | Admin |
| GET | `/api/admin/comics/:comicId/pricing` | Get pricing rules | Admin |
| PUT | `/api/admin/comics/:comicId/pricing` | Full-replace pricing rules | Admin |
| GET | `/api/comics` | Public list — PUBLISHED only, with filters (?gender, ?ageGroup, ?themeId, ?search) | Public |
| GET | `/api/comics/:comicId` | Public detail — PUBLISHED only (⚠️ needs new fields added) | Public |

### Endpoints — Page / Bubble / Font

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/comics/:comicId/pages/upload-url` | Presigned upload URL for artwork/mask | Admin |
| POST | `/api/admin/comics/:comicId/pages` | Create a page | Admin |
| POST | `/api/admin/pages/:pageId/bubbles` | Create a bubble | Admin |
| POST | `/api/admin/comics/:comicId/fonts/upload-url` | Presigned upload URL for font | Admin |
| POST | `/api/admin/comics/:comicId/fonts` | Create a font | Admin |

### Endpoints — Theme

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/themes` | Create a theme | Admin |
| PATCH | `/api/admin/themes/:themeId` | Update a theme | Admin |
| DELETE | `/api/admin/themes/:themeId` | Delete (blocks if comics linked) | Admin |
| GET | `/api/themes` | List all themes | Public |

### Endpoints — Announcement Bar

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/announcements` | Create announcement | Admin |
| PATCH | `/api/admin/announcements/:id` | Update announcement | Admin |
| PATCH | `/api/admin/announcements/:id/status` | Toggle active/inactive | Admin |
| PATCH | `/api/admin/announcements/reorder` | Reorder announcements | Admin |
| GET | `/api/admin/announcements` | List all (active + inactive) | Admin |
| DELETE | `/api/admin/announcements/:id` | Delete | Admin |
| GET | `/api/announcements` | List active only | Public |

### Endpoints — Hero Images

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/hero-images/upload-url` | Presigned upload URL | Admin |
| POST | `/api/admin/hero-images` | Create hero image | Admin |
| PATCH | `/api/admin/hero-images/:id/status` | Toggle active/inactive | Admin |
| GET | `/api/admin/hero-images` | List all | Admin |
| DELETE | `/api/admin/hero-images/:id` | Delete | Admin |
| GET | `/api/hero-images` | List active only | Public |

### Endpoints — Customer Reviews

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/customer-reviews/upload-url` | Presigned upload URL for video | Admin |
| POST | `/api/admin/customer-reviews` | Create review | Admin |
| PATCH | `/api/admin/customer-reviews/:id/status` | Toggle active/inactive | Admin |
| GET | `/api/admin/customer-reviews` | List all | Admin |
| DELETE | `/api/admin/customer-reviews/:id` | Delete (with R2 video cleanup) | Admin |
| GET | `/api/customer-reviews` | List active only | Public |

### Endpoints — Team Members

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/admin/team-members/upload-url` | Presigned upload URL for photo | Admin |
| POST | `/api/admin/team-members` | Create team member | Admin |
| PATCH | `/api/admin/team-members/:id` | Update (text fields + image replacement with R2 cleanup) | Admin |
| PATCH | `/api/admin/team-members/:id/status` | Toggle active/inactive | Admin |
| GET | `/api/admin/team-members` | List all | Admin |
| DELETE | `/api/admin/team-members/:id` | Delete (with R2 image cleanup) | Admin |
| GET | `/api/team-members` | List active only | Public |

### Endpoints — Feedback

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/feedbacks` | Customer submits feedback | Public |
| GET | `/api/admin/feedbacks` | List all (?status filter) | Admin |
| PATCH | `/api/admin/feedbacks/:id/status` | Update status (OPEN/VIEWED/RESOLVED/DISMISSED) | Admin |
| DELETE | `/api/admin/feedbacks/:id` | Delete | Admin |

### Endpoints — Order Session & Generation

| Method | Route | Purpose | Auth |
|---|---|---|---|
| POST | `/api/sessions` | Create OrderSession | Public |
| PATCH | `/api/sessions/:sessionId` | Update childName/age/pronounKey | Public |
| GET | `/api/sessions/:sessionId` | Get session state | Public |
| WS | `ws://.../?sessionId=&token=` | Authenticated live connection | Token |
| POST | `/api/sessions/:sessionId/photo/upload-url` | Presigned upload URL | Public |
| POST | `/api/sessions/:sessionId/photo/validate` | Real Python validation pipeline | Public |
| POST | `/api/sessions/:sessionId/generate` | Trigger free-preview generation | Public |
| POST | `/api/sessions/:sessionId/pages/:pageNumber/regenerate` | Per-page regeneration | Public |

### Endpoints — Auth

| Method | Route | Purpose | Auth |
|---|---|---|---|
| ALL | `/api/auth/*splat` | Better Auth handler | — |
| GET | `/health` | Liveness check | None |

**WebSocket event contract (locked, frontend building against this):**
- `page:ready` → `{ type: 'page:ready', pageNumber, variantIndex, imageUrl, pageVersionId }`
- `page:error` → `{ type: 'page:error', pageNumber, variantIndex, errorMessage }`

---

## 7. COMPLETE FOLDER & FILE STRUCTURE

> ⚠️ Changed in latest session: Many new files added for Theme, Announcement, HeroImage, CustomerReview, TeamMember, Feedback. Docker files added at root.

```
unilake-backend/
├── Dockerfile                  # Node 22 + Python 3 + system deps, tested locally
├── .dockerignore               # Excludes node_modules, venv, .env, .git, *.md
├── prisma/
│   ├── schema.prisma           # Single file: Better Auth models + all domain models
│   └── migrations/             # All migrations including latest: add_theme_agegroup_bestseller, add_hero_images, add_customer_reviews, add_team_members, add_feedbacks
├── prisma.config.ts            # Prisma 7 — reads DIRECT_URL from process.env directly (decoupled from env.ts)
├── requirements.txt            # Python dependencies frozen via pip freeze
├── venv/                       # Python 3.11.9 virtual environment. In .gitignore. NEVER place project scripts inside.
├── src/
│   ├── server.ts               # Entry point. http.createServer(app), setupWebSocket(server), initJobs(), server.listen()
│   ├── app.ts                  # Express app config — middleware + route mounting, NO .listen() call
│   ├── config/
│   │   ├── env.ts              # Validated env config object, fail-fast on missing vars
│   │   └── generation.ts       # MAX_SD_VARIANTS_PER_PAGE = 3, MAX_HD_VARIANTS_PER_PAGE = 8
│   ├── scripts/
│   │   ├── validate_photo.py   # COMPLETE (Block 3). Python photo validation script.
│   │   └── models/
│   │       └── blaze_face_short_range.tflite
│   ├── routes/
│   │   ├── admin.ts            # All /api/admin/* routes: comic, country, theme, page, bubble, font, announcement, hero-image, customer-review, team-member, feedback
│   │   └── public.ts           # All public routes: comics, sessions, themes, announcements, hero-images, customer-reviews, team-members, feedbacks
│   ├── controllers/
│   │   ├── comic.controller.ts
│   │   ├── country.controller.ts
│   │   ├── session.controller.ts
│   │   ├── page.controller.ts
│   │   ├── bubble.controller.ts
│   │   ├── font.controller.ts
│   │   ├── theme.controller.ts          # NEW
│   │   ├── announcement.controller.ts   # NEW
│   │   ├── heroImage.controller.ts      # NEW
│   │   ├── customerReview.controller.ts # NEW
│   │   ├── teamMember.controller.ts     # NEW
│   │   └── feedback.controller.ts       # NEW
│   ├── services/
│   │   ├── comic.service.ts             # Updated: deleteComic, getAdminComicsList, updated getPublicComicsList
│   │   ├── country.service.ts
│   │   ├── session.service.ts
│   │   ├── page.service.ts
│   │   ├── bubble.service.ts
│   │   ├── font.service.ts
│   │   ├── photoValidation.service.ts   # Updated: cross-platform Python path
│   │   ├── theme.service.ts             # NEW
│   │   ├── announcement.service.ts      # NEW
│   │   ├── heroImage.service.ts         # NEW
│   │   ├── customerReview.service.ts    # NEW
│   │   ├── teamMember.service.ts        # NEW
│   │   └── feedback.service.ts          # NEW
│   ├── validators/
│   │   ├── comic.schema.ts             # Updated: createComicSchema, updateComicSchema, adminComicFilterQuerySchema, comicFilterQuerySchema expanded
│   │   ├── country.schema.ts
│   │   ├── session.schema.ts
│   │   ├── generate.schema.ts
│   │   ├── regenerate.schema.ts
│   │   ├── page.schema.ts
│   │   ├── bubble.schema.ts
│   │   ├── font.schema.ts
│   │   ├── theme.schema.ts             # NEW
│   │   ├── announcement.schema.ts      # NEW
│   │   ├── heroImage.schema.ts         # NEW
│   │   ├── customerReview.schema.ts    # NEW
│   │   ├── teamMember.schema.ts        # NEW
│   │   └── feedback.schema.ts          # NEW
│   ├── middlewares/
│   │   ├── errorHandler.ts
│   │   ├── requireAdmin.ts
│   │   └── validateBody.ts
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── redis.ts
│   │   ├── r2.ts
│   │   ├── logger.ts
│   │   └── auth.ts
│   ├── jobs/
│   │   ├── queues.ts
│   │   └── workers/
│   │       ├── sdWorker.ts     # STUB
│   │       ├── hdWorker.ts     # STUB
│   │       ├── pdfWorker.ts    # STUB
│   │       └── index.ts
│   ├── websocket/
│   │   ├── wsServer.ts
│   │   ├── rooms.ts
│   │   └── events.ts
│   ├── utils/
│   │   ├── errors.ts
│   │   └── asyncHandler.ts
│   └── types/
│       └── express.d.ts
├── .env / .env.example
└── package.json                # Updated: added "start": "tsx src/server.ts"
```

---

## 8. ENVIRONMENT & CONFIGURATION

**Environment variables** (exact names from `.env`):
- `PORT` — server port (8080)
- `DATABASE_URL` — Neon pooled connection string
- `DIRECT_URL` — Neon direct connection string (used by prisma.config.ts)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PRIVATE_BUCKET_NAME`, `R2_PUBLIC_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_URL_BASE`
- `REDIS_URL` — Upstash Redis connection string
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`
- `NODE_ENV`

**Critical `.env` rule for Docker:** Never use quotes around values in `.env` when using Docker's `--env-file`. Docker reads the file raw — quotes become part of the value. `dotenv` in Node strips quotes automatically, which is why it works locally but breaks in Docker.

**Configuration files:**
- `.env` / `.env.example` — real secrets never committed.
- `prisma.config.ts` — reads `process.env.DIRECT_URL` directly (NOT through the validated config object — decoupled for Docker build compatibility).
- `src/config/env.ts` — validated env config object, fail-fast on missing vars.
- `src/config/generation.ts` — variant cap constants.
- `Dockerfile` — Docker build instructions.
- `.dockerignore` — excludes node_modules, venv, .env, .git, *.md.
- `requirements.txt` — frozen Python dependencies.

**Local dev setup steps:**
1. `npm install`
2. `py -3.11 -m venv venv` (must use Python 3.11.x)
3. `source venv/Scripts/activate` (Git Bash)
4. `pip install opencv-python mediapipe deepface tf-keras`
5. Download `blaze_face_short_range.tflite` → `src/scripts/models/`
6. `npx prisma generate` + any pending migrations
7. `npm run dev` (tsx watch)

**Docker local testing:**
1. `docker build -t unilake-backend .`
2. `docker run --rm -p 8080:8080 --env-file .env unilake-backend`
3. Test at `http://localhost:8080/health`

**Deployment target:** Docker image is built and tested. Hosting platform not yet chosen (see Section 12).

---

## 9. COMPLETED TASKS

- **Project scaffold:** Express + TypeScript ESM, `app.ts`/`server.ts` split, centralized error handling, custom error classes, `asyncHandler` wrapper.
- **Full Prisma schema on Neon Postgres**, via the Neon driver adapter.
- **Two-bucket Cloudflare R2 setup** (public/private) with a complete `r2.ts` helper library.
- **Redis + BullMQ**: three queues defined, three stub workers, graceful shutdown wired in.
- **Better Auth**: fully wired, Google + Facebook social login, custom `role` field.
- **Country model**: create, update, list, flag upload URL.
- **Theme model**: full CRUD — create, update, delete (with comic-link guard), public list.
- **Comic model**: full CRUD — create (with pricing, theme, ageGroup, description, isBestseller), update (all fields including new ones via unified PATCH), delete (with published-status and active-session guards), admin list with filters (gender, ageGroup, themeId, search), public list with filters, pricing CRUD, status toggle, thumbnail upload URL, LoRA upload URL.
- **Page model**: create, artwork/mask upload URL.
- **Bubble model**: create.
- **Font model**: create, upload URL.
- **Announcement Bar**: full CRUD — create, update, toggle status, reorder, delete, admin list, public active list.
- **Hero Section Images**: full CRUD — upload URL, create, toggle status, delete, admin list, public active list.
- **Customer Review Videos**: full CRUD — upload URL, create, toggle status, delete (with R2 video cleanup), admin list, public active list.
- **Team Members**: full CRUD — upload URL, create, update (text + image replacement with R2 cleanup), toggle status, delete (with R2 image cleanup), admin list, public active list.
- **Feedback/Suggestions**: full CRUD — public submit, admin list with status filter, update status (OPEN/VIEWED/RESOLVED/DISMISSED), delete.
- **OrderSession lifecycle**: create, patch, get — all tested.
- **WebSocket server** (`wsServer.ts`, `rooms.ts`, `events.ts`) — full auth flow tested.
- **Photo upload URL** — tested.
- **Photo validation pipeline** (Block 3 Phases A–D) — complete Python pipeline, Node integration, real pass/fail branching.
- **Generate trigger + per-page regenerate** — tested, real Page lookups, cap enforcement.
- **Docker setup** — Dockerfile, .dockerignore, cross-platform Python path, prisma.config.ts decoupled, `npm start` script, tested locally with all external services connecting.

### Block 3 Phases A–D (COMPLETE)
[All details from previous document remain unchanged — Python environment setup, validate_photo.py, Node integration, validateSessionPhoto rewrite]

### Block 3 Phase E — Docker Timing Data (PARTIALLY COMPLETE)
- **Docker timing results (3 photos):** 17.5s, 14.3s, 14.2s
- **Previous Windows native timing:** ~22.3s
- **Conclusion:** Docker/Linux is faster than Windows native (~14-17s vs ~22s), but still 7x over the 2-second target. First call is slower (cold model loading), subsequent calls still slow because each spawns a fresh Python process. **Warm Python Flask server confirmed needed** — not yet built.
- **What remains:** Build the warm Flask server. The batch test effectively counts as done (3 Docker data points + 1 Windows data point = sufficient evidence).

---

## 10. IN PROGRESS TASKS

### Warm Python Flask Server Migration (CONFIRMED NEEDED, NOT YET BUILT)
- Docker timing data (17.5s, 14.3s, 14.2s) confirms the spawn-per-request architecture is fundamentally inadequate for the <2s target.
- Rough plan: turn `validate_photo.py` into a persistent Flask server, switch Node's `execFile` to HTTP `fetch`, handle health checks and "not ready yet" cases.
- Estimated time: ~4-8 hours.
- **Recommended architecture (not decided):** Node serverless + Python always-on as separate services. Cost: ~$15-30/month total. Python needs ~2GB RAM for TensorFlow.

### Two small Phase C/D code-review items needing confirmation
- `runPhotoValidation` export keyword fix — needs confirmation as applied.
- `PhotoValidationResult` interface cleanup — needs confirmation as done.

---

## 11. UPCOMING TASKS — PRIORITY ORDER

1. **Finish remaining CRUD gaps** (~3 hours):
   - Country: delete endpoint
   - Comic: admin single detail (`GET /api/admin/comics/:comicId`), public detail update (add new fields)

2. **Page/Bubble/Font CRUD completion** (~6-8 hours):
   - Page: update, delete, list for admin
   - Bubble: update, delete, list for admin
   - Font: update, delete, list for admin

3. **Warm Python Flask server** (~4-8 hours):
   - Build the persistent Flask server
   - Switch Node integration from execFile to HTTP fetch
   - Test in Docker

4. **Seed real comic data** (~3-4 hours):
   - Manual Apidog work through admin endpoints

5. **SD worker real implementation** (~16-24 hours):
   - Replace sdWorker.ts stub with real ComfyUI HTTP client
   - Per-page branching, workflow JSON, polling, R2 upload, WebSocket emission
   - Status flipping mechanism (PREVIEW_READY when all pages done)

6. **Sharp text renderer** (~8-12 hours):
   - SVG-composite approach, font download, auto-shrink, coordinate scaling, {age} token

7. **User flow endpoints** (~6-8 hours):
   - Variant selection, confirm, status transitions, shipping collection

8. **Razorpay payments** (~10-14 hours):
   - Order creation, webhook, signature verification, idempotency

9. **Paid page generation** (~4-6 hours):
   - Pages 11-24, higher variant cap, status flip

10. **HD upscale pipeline** (~6-8 hours):
    - Real HD worker, ComfyUI upscale

11. **PDF compilation** (~4-6 hours):
    - pdf-lib, compile 24 images, R2 upload, signed download URL

12. **Shiprocket integration** (~10-14 hours):
    - Auth, shipment creation, webhook, domestic vs international

13. **Email notifications** (~6-8 hours):
    - Provider setup, 4 templates, trigger wiring

14. **Admin dashboard endpoints** (~6-8 hours):
    - Order list/detail/stats with filters

15. **Publish flow** (~6-8 hours):
    - Config compilation, asset sync to ComfyUI

16. **Stabilization & documentation** (~8-10 hours):
    - API docs, edge cases, rate limiting, cleanup jobs

17. **Deployment** (~4-6 hours):
    - Choose platform, deploy, CI/CD, domain + SSL

**Total estimated remaining: ~114-155 hours. At 12 hours/day: ~10-13 working days.**

---

## 12. OPEN QUESTIONS & UNRESOLVED DECISIONS

- **Photo validation latency — WARM SERVER CONFIRMED NEEDED.** Docker timing data: 17.5s, 14.3s, 14.2s (3 photos). Windows native: ~22.3s. All far above the 2-second target. The warm Flask server is the confirmed next step, but the build hasn't started yet.
- **Hosting architecture — PARTIALLY RESOLVED.** Two viable options discussed with rough pricing: (1) Node+Python all-in-one always-on container: $20-30/month, 14-17s photo validation; (2) Node serverless + Python always-on: $15-30/month, 1-3s photo validation. **Recommendation is option 2** but final decision deferred to client/business preference. Fully serverless (scale-to-zero) is confirmed as a poor fit.
- **Hosting platform — NOT DECIDED.** Docker image is ready. Platform choice (Render, Railway, Cloud Run, etc.) needed when frontend team needs a real URL.
- **Sunglasses/hat detection — permanently accepted limitation.** Closed decision, do not reopen.
- **Shiprocket's country-name format** — unverified, needs checking when integration is built.
- **`validateQuery` middleware** — not built, deferred.
- **In-memory WebSocket room map** — single-instance only, needs Redis pub/sub for multi-instance. Accepted for now.
- **Status flipping mechanism (PREVIEW_READY)** — not yet designed.
- **Whether individual page generation stages can run ahead of session status** — not yet resolved.
- **Variant generation eagerness strategy** — not yet designed.
- **Email provider** — not yet chosen.
- **International Razorpay** — external dependency, account-level setup needed.
- **Sharp coordinate scaling** — not yet designed.

---

## 13. MISTAKES & COURSE CORRECTIONS

[All entries from previous document remain unchanged, plus:]

- **`.env` quotes break Docker.** Docker's `--env-file` reads values raw. Quotes in `.env` values (e.g., `REDIS_URL="rediss://..."`) become part of the actual value, causing connection failures (`%22` URL-encoded quotes in the address). Fixed by removing all quotes from `.env`. `dotenv` in Node strips quotes automatically, which is why it works locally but breaks in Docker.
- **`prisma.config.ts` importing `env.ts` breaks Docker build.** `env.ts` validates all env vars at import time and kills the process if any are missing. During `docker build`, no `.env` exists (by design — secrets shouldn't be in images). Fixed by making `prisma.config.ts` read `process.env.DIRECT_URL` directly instead of importing the validated config.
- **`EXPOSE 3000` in Dockerfile was wrong.** The app runs on port 8080. `EXPOSE` is documentation-only (doesn't actually affect anything), but was corrected to `EXPOSE 8080` for clarity.
- **Source code must be copied before `prisma generate` in Dockerfile.** `prisma.config.ts` (even after the fix) still needs to be parseable, and `prisma generate` needs the schema file. Initially, `COPY src` was placed after `RUN npx prisma generate`, causing a "Cannot find module" error.
- **`ZodIssue` is deprecated in Zod v4.** Using `import { ZodIssue } from "zod"` with `verbatimModuleSyntax: true` in tsconfig causes both a deprecation error (TS6385) and a type-only import error (TS1484). Fixed by removing `ZodIssue` and using inline `{ message: string }` type in `.map()` callbacks. Affects `feedback.controller.ts` and potentially `comic.controller.ts`.

---

## 14. IMPORTANT CONTEXT & CONSTRAINTS

**Business rules affecting technical decisions:**
- Free preview page count varies per comic (`Comic.freePreviewPages`) — must never be hardcoded.
- SD variant cap (3) and HD variant cap (8) are fixed, app-wide.
- Single photo per session is permanent.
- Admin users are small, trusted set — role manually assigned.
- End customers are always anonymous — no accounts, no login, ever.
- Theme deletion blocked if comics are linked.
- Comic deletion blocked if published or has active sessions.
- R2 assets cleaned up on delete for CustomerReview (video) and TeamMember (image).

**Performance requirements:**
- Photo validation target: **under 2 seconds**. Currently 14-17s in Docker. Warm server confirmed needed.
- No other explicit targets yet.

**Security requirements:**
- Two separate R2 buckets (public/private) — structural, not convention-based.
- Admin routes require login + `ADMIN` role.
- `wsRoomToken` is the WebSocket secret.
- Python never receives R2 credentials — only local file paths.
- `.env` values never baked into Docker images — injected at runtime.

**Scalability considerations:**
- In-memory WebSocket rooms — single-instance only.
- Spawn-per-request Python — confirmed inadequate, warm server needed.

---

## 15. KEY ARGUMENTS & CONCLUSIONS

[All entries 1-7 from previous document remain unchanged, plus:]

8. **Should a `validateParams` middleware be built?**
   Options: build it and retrofit all existing endpoints vs. rely on service-layer `findUnique` → `NotFoundError`.
   **Concluded:** Don't build it. Too much retrofit cost across all existing endpoints for marginal benefit. The service layer already handles bad IDs cleanly — `findUnique` returns null, which triggers `NotFoundError` → clean 404. A `validateParams` middleware would just catch the problem slightly earlier (before the DB call instead of during it), not worth the effort mid-sprint.

9. **Should Theme have a separate admin vs public GET endpoint?**
   **Concluded:** One public endpoint (`GET /api/themes`). Theme data is not sensitive (just `id`, `name`, timestamps). Admin uses the same endpoint. A separate admin endpoint would only be needed if an `isActive` field were added later — build it then, not now.

10. **Should comic update and image upload be separate endpoints or combined?**
    **Concluded (for TeamMember):** Single PATCH endpoint that accepts both text fields and `imageKey`. If `imageKey` is present, the service converts it to `imageUrl` and cleans up the old image from R2. This matches the existing `PATCH /api/admin/comics/:comicId` pattern where one endpoint handles all updatable fields.

11. **Photo validation warm server — go or no-go?**
    **Concluded: GO.** Docker timing data (17.5s, 14.3s, 14.2s) is consistent, not a one-off. Every request pays the full TensorFlow/DeepFace model-loading cost independently. A warm Flask server would load models once at startup and serve subsequent requests in ~1-3 seconds. Estimated build time: 4-8 hours. **Recommended but not yet built.**

12. **Hosting architecture: all-in-one vs split (Node + Python separate)?**
    Options: (1) Everything in one container, ~$20-30/month, 14-17s validation; (2) Node serverless + Python always-on, ~$15-30/month, 1-3s validation.
    **Concluded:** Option 2 recommended — same cost, dramatically better performance. Final decision deferred to client preference.

---

## 16. FILES & DOCUMENTS REFERENCE

| File/Path | Contains | Status |
|---|---|---|
| `Dockerfile` | Docker build instructions (Node 22 + Python 3) | Created, tested locally |
| `.dockerignore` | Excludes node_modules, venv, .env, .git | Created |
| `requirements.txt` | Frozen Python dependencies | Created |
| `prisma/schema.prisma` | Full domain + Better Auth schema (including all new models) | Created, current |
| `prisma.config.ts` | Prisma 7 datasource config (decoupled from env.ts) | Created, updated |
| `src/server.ts` | App entry point | Created |
| `src/app.ts` | Express config, middleware, route mounting | Created |
| `src/config/env.ts` | Validated env config | Created |
| `src/config/generation.ts` | Variant cap constants | Created |
| `src/scripts/validate_photo.py` | Photo validation pipeline | Created, complete |
| `src/scripts/models/blaze_face_short_range.tflite` | MediaPipe model | Downloaded |
| `src/routes/admin.ts` | All admin routes | Created, updated with all new CRUD routes |
| `src/routes/public.ts` | All public routes | Created, updated with theme/announcement/hero/review/team/feedback routes |
| `src/controllers/*.controller.ts` | All controllers (comic, country, session, page, bubble, font, theme, announcement, heroImage, customerReview, teamMember, feedback) | Created |
| `src/services/*.service.ts` | All services (same set as controllers, plus photoValidation) | Created |
| `src/validators/*.schema.ts` | All Zod schemas (same set as controllers) | Created |
| `src/middlewares/errorHandler.ts` | Central error handler | Created |
| `src/middlewares/requireAdmin.ts` | Admin auth guard | Created |
| `src/middlewares/validateBody.ts` | Body validation middleware | Created |
| `src/lib/prisma.ts` | Prisma singleton | Created |
| `src/lib/redis.ts` | Redis singleton | Created |
| `src/lib/r2.ts` | R2 helper library | Created |
| `src/lib/logger.ts` | Pino singleton | Created |
| `src/lib/auth.ts` | Better Auth config | Created |
| `src/jobs/queues.ts` | BullMQ queue definitions | Created |
| `src/jobs/workers/*.ts` | Worker stubs + init | Created (stubs) |
| `src/websocket/*.ts` | WebSocket server, rooms, events | Created |
| `src/utils/*.ts` | Error classes, asyncHandler | Created |
| `src/types/express.d.ts` | Express type augmentation | Created |
| `.env` / `.env.example` | Environment secrets/template | Created |
| `venv/` | Python 3.11.9 virtual environment | Created, gitignored |
| `package.json` | Updated with `start` script | Created, updated |

---

## 17. SESSION HISTORY SUMMARY

**Days 1–3:** Core scaffold built — Express/TypeScript/ESM project structure, Prisma schema on Neon Postgres, two-bucket R2 setup, Redis/BullMQ queues with stub workers, Better Auth with custom admin role, Country and Comic CRUD with pricing transactions, public catalogue endpoints, and the full `OrderSession` creation/update/get flow plus the authenticated WebSocket server.

**Day 4, Block 1:** Generate-trigger and per-page regenerate endpoints. `PageVersion` schema fix (pageId FK replacing bare pageNumber).

**Day 4, Block 2:** Full Page/Bubble/Font admin CRUD, unified comic-update, LoRA upload flow. Double-validation bug pattern cleaned up.

**Day 4, Block 3:** Real Python photo validation (Phases A–D). Python 3.14 incompatibility, MediaPipe API removal, sunglasses detection arc, Node integration, validateSessionPhoto rewrite. One timing data point: ~22.3s.

**Day 4+ (latest session — major expansion):** CMS features, Comic CRUD completion, Docker setup, Phase E timing. See session log below.

---

## SESSION LOG — July 10, 2026 — MAJOR UPDATE

**What triggered this session:** Continuing project work. Developer wanted to complete Comic CRUD, build CMS content management features, and get Docker deployment working for frontend team.

**Major decisions made:**
- AgeGroup implemented as a fixed enum (AGE_0_2, AGE_3_5, AGE_6_8, AGE_9_12) on Comic, not a free-text string
- Theme deletion blocks if comics linked (409 error), not cascade or set-null
- Comic deletion blocks if published or has active sessions
- `validateParams` middleware explicitly decided against — retrofit cost not worth marginal benefit
- Single PATCH endpoint for updates (including image replacement) rather than separate text/image endpoints
- R2 asset cleanup built into delete/update flows for CustomerReview and TeamMember
- prisma.config.ts decoupled from env.ts for Docker build compatibility
- Cross-platform Python path using process.platform detection
- Warm Python server confirmed needed based on Docker timing data (14-17s vs 2s target)
- Recommended hosting: Node serverless + Python always-on (~$15-30/month)

**Every part of the project that changed:**
- Schema: AgeGroup enum, Theme model, HeroImage, CustomerReview, TeamMember, FeedbackStatus enum, Feedback added. Comic model expanded with 4 new fields.
- 5 new migrations run
- ~40+ new API endpoints across 6 new feature areas
- Comic CRUD expanded (admin list with filters, public list with filters, delete)
- Docker setup complete (Dockerfile, .dockerignore, package.json start script, prisma.config.ts decoupled, photoValidation.service.ts cross-platform fix)
- Phase E timing data collected in Docker: 17.5s, 14.3s, 14.2s

**What the project looks like now vs before:**
- Before: Core infrastructure + Comic/Country/Session/Page/Bubble/Font endpoints only. No CMS features. No Docker. Photo validation timing unknown beyond one data point.
- Now: Complete CMS admin panel backend (themes, announcements, hero images, customer reviews, team members, feedback). Full Comic CRUD with filtering. Docker containerized and tested. Photo validation timing confirmed, warm server decision made.

**What needs to happen next (priority order):**
1. Finish remaining CRUD gaps (country delete, comic detail endpoints)
2. Page/Bubble/Font CRUD completion
3. Warm Python Flask server
4. Seed real comic data
5. SD Worker (ComfyUI integration) — the biggest unknown
6. Everything else in the pipeline

**Things to remember/double check:**
- Rotate ALL credentials shared during this session (DB password, R2 keys, Redis URL, OAuth secrets)
- Confirm the `AnnouncementBar` migration name in prisma/migrations/
- Confirm the `export` keyword fix on `runPhotoValidation` was applied
- Confirm the `PhotoValidationResult` interface was cleaned up
- `ZodIssue` deprecation may affect `comic.controller.ts` too — check
- Docker EXPOSE should be 8080, not 3000

---

## 18. FIRST MESSAGE FOR NEW CLAUDE

```
Hi — I'm continuing work on the Unilake backend project. I've just given you the complete migration document and system prompt covering everything we've built and decided so far.

Before we do anything else, please read through the full document and then summarize back to me, in your own words, your understanding of:
1. What this project is and who it's for
2. Exactly where we currently stand (what's done, what's in progress, what's not started)
3. The single most important thing you must NOT re-litigate or re-suggest, based on what's documented as already tried and rejected

Once you've confirmed understanding, here's what we're picking up next: [INSERT CURRENT TASK HERE]

Please keep explaining any Python-related concepts in full beginner terms — I still have zero prior Python experience outside of what we've built together in this project.
```
