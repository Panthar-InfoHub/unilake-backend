# Unilake Backend — Project Context

**Stable reference.** Edit only when architecture, stack, or conventions actually change. Not a session log.

---

## 1. WHAT THIS IS

Backend for **Unilake**, a personalized children's storybook platform for client **Uni Lake Brand Solutions**, built by **Panthar Infohub Pvt. Ltd.** (Thane, Maharashtra, India).

A parent uploads a photo of their child, picks a comic template, and the platform generates a personalized 24-page comic book where the child's face is AI-inserted into the artwork, with personalized dialogue (name, pronouns) stamped into speech bubbles. Free preview page count is per-comic (`Comic.freePreviewPages`); remaining pages unlock after payment. The finished comic is compiled into a print-ready PDF and physically shipped.

**Two audiences:**
1. **End customers (parents)** — browse and preview anonymously, but must log in via Google/Facebook before paying. Tracked via `OrderSession` + `wsRoomToken` during anonymous phase; `userId` attached at login.
2. **Admin users** — log in via Better Auth, manage all comics, pages, bubbles, fonts, pricing, themes, hero images, customer reviews, team members, announcements, feedback, orders.

**Developer:** "Guts," ~6 months backend experience, sole backend lead, working solo while a separate frontend team builds in parallel. Zero prior Python experience.

---

## 2. SYSTEM PROMPT FOR NEW CLAUDE

```
You are acting as a senior backend engineer and technical pair-programmer for "Guts," the sole backend developer on Unilake — a personalized children's comic book platform. Guts has approximately 6 months of professional backend experience and is working solo. Guts has ZERO prior Python experience — treat any Python-related explanation as needing full beginner-level detail.

Your role:
- Function as a thoughtful senior engineer, not just a code generator. Proactively flag design gaps, race conditions, security issues, and scope creep.
- When Guts proposes something that conflicts with an already-finalized decision (see DECISIONS.md), do not silently comply — point out the conflict and ask for explicit confirmation.
- When a request is ambiguous, make a reasonable assumption, state it plainly, and proceed — don't stall on excessive clarifying questions, but don't guess silently on anything consequential.
- Push back constructively when an approach is wrong, but always let Guts make the final call.
- Be honest about trade-offs, including time/complexity costs.

Communication style:
- Plain, unembellished, functional English. Guts writes hurried, slightly informal — don't expect polished prose back.
- Plain-language "what and why" alongside implementation steps — never a pure code dump.
- Task breakdowns in strict chronological execution order, each with an explicit verification/testing step.
- Guts actively values being told when they're wrong. Do not pad responses with unnecessary affirmation.
- Guts asks for confirmation before proceeding — respect this "confirm before you proceed" style.
- If Guts says an explanation is too complex, simplify it immediately.
- Give COMPLETE functions/files, not partial snippets — half-finished code across multiple messages causes confusion.

Working style:
- Guts tests via Apidog, not automated test suites.
- Shell is Git Bash inside VS Code — give Git Bash-syntax commands by default.
- Guts values real debug evidence (actual error text, measured numbers) before accepting a fix.
- End trade-off discussions with a clear personal recommendation and reasoning.
- `asyncHandler` wrapper goes inside the controller export, not on the route line.

Never do (see DECISIONS.md for full list):
- Never suggest NestJS, Winston, Socket.IO, MongoDB, single R2 bucket with prefixes, Prisma `connect` for pricing rules, hardcoded free-preview-page counts, or comic-level generation prompts.
- Never suggest backend Python photo validation — moved to frontend MediaPipe.js.
- Never suggest frontend sends `userId` in request bodies — always derive from Better Auth cookie.
- Never suggest ComfyUI installation/hosting work — API integration only.
- Never revert `PageVersion` to bare `pageNumber Int` — must use `pageId` FK.
- Never revert WebSocket to `{ server: httpServer }` — `{ noServer: true }` is permanent.
- Never suggest old MediaPipe `mp.solutions` API — fully removed in installed version.
- Never suggest Python versions other than 3.11.x for the venv.
- Never re-propose pupil-shape or frame-bridge-uniformity for sunglasses detection.
- Never suggest building `validateParams` middleware.
- Never assume a task is done just because it was discussed — check CURRENT_STATE.md.
```

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
| Redis (Upstash) + BullMQ | — | Job queue | Queues: `sd-generation`, `hd-generation`, `pdf-compilation` |
| Better Auth | — | Admin + customer auth | Google + Facebook + email/password. Custom `role` field via `additionalFields` with `input: false` |
| Zod | v4.4.3 | Validation | Middleware only, never in controllers. `ZodIssue` deprecated in v4 — use inline `{ message: string }` |
| Pino | — | Logging | Signature: `logger.info(dataObject, 'message')` — data FIRST. Not Winston. |
| Helmet, CORS | — | Security headers | CORS methods must include PATCH |
| Sharp | — | Text compositing on generated pages | No native text primitive — generate SVG then composite. Runs LAST after ComfyUI. |
| Konva.js / Fabric.js | Planned | Admin bubble-mapping UI | Backend endpoints already built |
| Python 3.11.9 (venv) | 3.11.9 | Photo validation (LEGACY — kept, not yet removed) | Cleanup deferred; code retained for potential reuse |
| OpenCV, MediaPipe, DeepFace, TensorFlow, tf-keras | — | Photo validation (LEGACY) | Kept for now |
| `child_process.execFile` | Node built-in | Spawn Python (LEGACY) | Cross-platform path via `process.platform` |
| ComfyUI | External, RunPod-hosted | AI image generation | API-calling only, no infra work |
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
- `app.ts` = middleware + route mounting only. Never calls `.listen()`.

**Controller pattern:** Validation in middleware only (`validateBody(schema)` on route). Controllers never call `.parse()`. `asyncHandler` wraps controllers inside the export, not on the route line. Every success response goes through `sendSuccess(res, statusCode, data, message?)` from `src/utils/response.ts` — standardized envelope `{ success: true, data, message? }` across all controllers.

**Auth tiers (three):**
1. Admin routes `/api/admin/*` → `requireAdmin`
2. Customer routes `/api/user/*` → `requireLoggedIn` (any Better Auth session)
3. Public routes `/api/public/*` → no guard. Session endpoints optionally read cookie to populate `userId`.

**Route mounting order in `app.ts`:**
```
app.use("/api/admin", requireAdmin, adminRoutes);
app.use("/api/user", requireLoggedIn, userRouter);
app.use("/api/public", publicRouter);
```

**Key design principles:**
- `OrderSession` created EARLY (just `{ comicId }`), fields filled progressively via PATCH.
- `createOrderSession` optionally reads Better Auth cookie — if logged in, auto-attaches `userId`; if anonymous, `userId` stays null.
- WebSocket connects immediately after session creation, not at "Generate" time.
- `{ noServer: true }` WebSocket — auth check during raw HTTP upgrade event, before `wss.handleUpgrade()`.
- Single photo per session. `rawPhotoUrls` array holds 0 or 1 entries.
- `bestPhotoUrl` set only on validation pass. `status` advances to `PHOTO_UPLOADED` only on pass. Fail = retry via existing endpoints.
- Free preview count is per-comic (`Comic.freePreviewPages`), never hardcoded.
- `PageVersion` uses real `pageId` FK, not bare `pageNumber Int`. `pageNumber` in payloads/events is descriptive only.
- Prompts are page-specific only (`Page.pagePrompt`). No comic-level generation prompts.
- Unified `PATCH /api/admin/comics/:comicId` for all plain-scalar comic fields. Themes via `{ connect: { id } }`.
- SD variant cap: 3/page. HD variant cap: 8/page. Fixed constants in `src/config/generation.ts`.
- Age lives on `OrderSession`, not `Comic`. `Comic.ageGroup` is a browsing filter band.
- No signed URLs to Python — Node downloads to temp file first (`downloadFileToLocalPath` in `r2.ts`).
- Python called via cross-platform path (`process.platform` detection).
- Theme delete blocks if comics linked (409 with count).
- Comic delete blocks if PUBLISHED or has active OrderSessions.
- Country delete blocks if pricing rules reference it (409 with count).
- Font delete blocks if bubbles reference it (409 with count).
- Cross-comic font assignment blocked on bubble update (409).
- R2 cleanup on delete for `CustomerReview` (video) and `TeamMember` (image). DB row first, R2 cleanup logged on failure. Same cleanup-on-replace pattern also applies to `Comic.coverThumbnailUrl` when updated via PATCH (old file deleted best-effort, not just on delete).
- `prisma.config.ts` reads `process.env.DIRECT_URL` directly, decoupled from `env.ts`, so `prisma generate` works during Docker build.

**Anonymous → authenticated flow:**
- Anonymous phase: `sessionId` semi-public in URLs, `wsRoomToken` is the actual secret.
- Login before checkout: frontend calls `PATCH /api/sessions/:sessionId/attach-user` after Better Auth callback.
- Attach only succeeds if `userId` currently null. Idempotent if same user calls again. 409 if different user.
- Post-userId revisit links require matching login → 403 on mismatch.
- Address snapshotted into BOTH `OrderSession.shipping*` AND `Order.shipping*`. No FK to `SavedAddress`.
- Payment retry: only pre-payment on same browser page. Post-payment failures = admin responsibility.

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
- **Catalogue:** `Theme`, `Comic`, `Page`, `Bubble`, `Font`
- **Pricing:** `PricingRule` (unique: `[comicId, countryId, coverType]`), `Country`
- **Order flow:** `OrderSession` (with `userId`, `notificationEmail`, `coverType`, shipping fields), `PageVersion` (unique: `[orderSessionId, pageId, variantIndex]`), `Order` (with shipping snapshot, `coverType`, `notificationEmail`)
- **User data:** `SavedAddress` (single default per user, ownership-guarded)
- **CMS:** `AnnouncementBar`, `HeroImage`, `CustomerReview`, `TeamMember`, `Feedback`
- **System:** `WebhookEvent` (idempotency), `SystemConfig`

**Enums:** `AgeGroup`, `CoverType`, `GenderTag`, `ComicStatus`, `OrderSessionStatus`, `PronounKey`, `PageVersionStatus`, `OrderStatus`, `FeedbackStatus`.

**Cascade rules:**
- `Comic` delete → cascades to `Page`, `Font`, `PricingRule`.
- `Page` delete → cascades to `Bubble`.
- `OrderSession` does NOT cascade if parent `Comic` changes — in-progress order must never vanish.
- `Theme` delete does NOT cascade — blocked at app layer if linked.
- `Country` delete does NOT cascade — blocked at app layer if pricing rules reference it.
- `Font` delete does NOT cascade — blocked at app layer if bubbles reference it.

---

## 6. API DESIGN — ROUTE MAP

REST. Middleware: `validateBody`, `requireAdmin`, `requireLoggedIn`, `errorHandler`, `asyncHandler`. `validateQuery` planned but not built. `validateParams` explicitly decided against.

### Admin routes (`requireAdmin`)
- **Comic:** thumbnail/LoRA upload-URL, create, admin list (filters), admin detail, PATCH, delete, status toggle, pricing GET/PUT
- **Country:** upload-URL, create, PUT, list, DELETE (with pricing guard)
- **Page:** list (with nested bubbles), create, upload-URL, PATCH, DELETE (cascades bubbles)
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
- `GET /api/public/comics` (filters), `GET /api/public/comics/:id` (includes description, ageGroup, isBestseller, theme, coverType pricing)
- `GET /api/public/themes`, `/announcements`, `/hero-images`, `/customer-reviews`, `/team-members`
- `POST /api/public/feedbacks`
- Session: `POST /api/public/sessions` (optionally reads cookie for auto-attach), `PATCH /api/public/sessions/:id` (accepts notificationEmail, coverType, shipping), `GET /api/public/sessions/:id`, photo upload-url + validate, generate, regenerate
- `PATCH /api/public/sessions/:id/attach-user` (requireLoggedIn inline)
- WebSocket: `ws://.../?sessionId=&token=`

### Webhooks — planned
- `POST /api/webhooks/razorpay` (signature verification)
- `POST /api/webhooks/shiprocket` (signature/token)

### Auth
- `ALL /api/auth/*splat` (Better Auth handler, both admin + customers)
- `GET /health`

**WebSocket event contract (LOCKED — frontend building against this):**
- `page:ready` → `{ type: 'page:ready', pageNumber, variantIndex, imageUrl, pageVersionId }`
- `page:error` → `{ type: 'page:error', pageNumber, variantIndex, errorMessage }`

---

## 7. FOLDER STRUCTURE

```
unilake-backend/
├── Dockerfile                  # Multi-stage, Python stripped, node:22-bookworm-slim
├── .dockerignore
├── .github/workflows/deploy.yml   # GH Actions → Cloud Run
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── prisma.config.ts            # Reads DIRECT_URL from process.env directly
├── requirements.txt            # LEGACY — kept for now
├── venv/                       # LEGACY — kept for now
├── src/
│   ├── server.ts               # Entry point
│   ├── app.ts                  # Express config, no .listen()
│   ├── config/{env,generation}.ts
│   ├── scripts/                # LEGACY — kept for now
│   ├── routes/{admin,public,user}.ts
│   ├── controllers/            # comic, country, session, page, bubble, font, theme, announcement, heroImage, customerReview, teamMember, feedback, savedAddress
│   ├── services/               # Same set + photoValidation (LEGACY)
│   ├── validators/             # Zod schemas, one per feature + savedAddress
│   ├── middlewares/            # errorHandler, requireAdmin, requireLoggedIn, validateBody
│   ├── lib/                    # prisma, redis, r2, logger, auth
│   ├── jobs/queues.ts + workers/{sdWorker, hdWorker, pdfWorker, index}.ts   # workers are STUBS
│   ├── websocket/{wsServer, rooms, events}.ts
│   ├── utils/{errors, asyncHandler, response}.ts
│   └── types/express.d.ts
├── .env / .env.example
└── package.json
```

---

## 8. ENVIRONMENT

**Env vars:** `PORT` (8080), `DATABASE_URL`, `DIRECT_URL`, `R2_*` (7 vars), `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_*`, `FACEBOOK_CLIENT_*`, `NODE_ENV`.

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

- Free preview page count varies per comic (`Comic.freePreviewPages`) — never hardcode.
- SD variant cap: 3. HD variant cap: 8. App-wide fixed.
- Single photo per session — permanent.
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
- R2 cleanup on delete for `CustomerReview` and `TeamMember`.

**Security:**
- Two separate R2 buckets, structural.
- Admin routes: login + `ADMIN` role.
- Customer routes: login + any role.
- `wsRoomToken` is the WebSocket secret. `sessionId` is semi-public.
- `userId` NEVER from frontend — always from Better Auth cookie server-side.
- Post-userId revisit links enforce matching login → 403 on mismatch.
- SavedAddress ownership check — 403 if address belongs to different user.
- `.env` values never baked into Docker images — injected at runtime.

**Performance:**
- Photo validation target was <2s. Moved to frontend — no longer backend concern.

**Scalability:**
- In-memory WebSocket rooms → single-instance only. Cloud Run pinned to 1 instance.
- Multi-instance would need Redis pub/sub for WS rooms.
