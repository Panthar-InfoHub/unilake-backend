# Unilake Backend — Code vs. Docs Audit

**Created:** August 11, 2026
**Scope:** Every source file in `src/`, plus `prisma/schema.prisma`, `Dockerfile`, `tsconfig.json`, `package.json` — checked against `PROJECT_CONTEXT.md`, `DECISIONS.md`, `CURRENT_STATE.md`, and `SESSION_LOG.md`.
**Not scanned:** `venv/`, `src/generated/prisma/` (vendored dependencies and Prisma codegen output).

---

## How to read this

Every item has a **priority** and a **tag**.

**Priority:**

| | Meaning |
|---|---|
| **P1** | Can break production, lose data, cost money, or expose something. Decide on these first. |
| **P2** | A real gap or inconsistency that will cause a bug or confusion later. Handle before launch. |
| **P3** | Tidy-up, dead code, or doc accuracy. No rush. |

**Tag:**

| | Meaning |
|---|---|
| **[Gap in code]** | The docs promise something the code doesn't do. |
| **[Contradiction]** | The code and the docs say different things. |
| **[Not in docs]** | The code does this, but no document mentions it. |

Within each file, items are listed **highest priority first**.

---

## Summary

| Priority | Count |
|---|---|
| P1 | 13 |
| P2 | 40 |
| P3 | 72 |
| **Total** | **125** |

### By section

| Section | P1 | P2 | P3 | Total |
|---|---|---|---|---|
| 1. Repo-level | 1 | 1 | 2 | 4 |
| 2. Entry points and config | 1 | 4 | 8 | 13 |
| 3. `src/lib/` | 1 | 4 | 6 | 11 |
| 4. `src/middlewares/` | 1 | 1 | 2 | 4 |
| 5. `src/utils/` | 0 | 0 | 1 | 1 |
| 6. `src/routes/` | 0 | 2 | 3 | 5 |
| 7. Controllers + worker init | 0 | 1 | 6 | 7 |
| 8. `src/services/` | 4 | 11 | 12 | 27 |
| 9. `src/jobs/` | 3 | 5 | 11 | 19 |
| 10. `src/websocket/` | 0 | 4 | 1 | 5 |
| 11. `prisma/schema.prisma` | 1 | 2 | 6 | 9 |
| 12. Build and tooling | 0 | 2 | 9 | 11 |
| 13. Doc corrections | 1 | 3 | 5 | 9 |
| **Total** | **13** | **40** | **72** | **125** |

---

## Status update — August 15, 2026 session

**10 of 13 P1 items closed.** The remaining 3 are intentionally deferred with tracking in `CURRENT_STATE.md` → "KNOWN OPEN ITEMS — MUST FIX BEFORE PUBLIC LAUNCH." (10 closed + 3 deferred = 13.)

**Resolved this session (code fixes):**
- 9.1 — Session stuck in GENERATING_PREVIEW forever
- 9.2 — Fake row-lock in maybeMarkPreviewReady
- 9.8 — RunPod poll retry / double-charge
- 8.9 — deletePage ordering
- 8.15 — deleteComic ordering
- 2.9 — R2_PUBLIC_URL_BASE not validated
- 2.10 — BETTER_AUTH_SECRET not validated (bonus P2)
- 2.11 — Unused zod import (bonus P3)
- 8.2 — confirmSessionPhoto key ownership
- 11.1 — Session expiry never enforced
- 8.5 — attachUserToSession expiry (bonus P2 — closed as a side effect of 11.1's `assertNotExpired`)

Also closed by earlier work and confirmed during this session: 8.4, 10.5, 11.3 (`displayImageUrl` documented in both LOCKED contracts and in §5), 13.2 (the four stale loose ends are gone from `CURRENT_STATE.md`), 8.6 (orphan-row recovery), 13.6, 13.7.

**Resolved on inspection (turned out already-fixed or already-working):**
- 13.1 — LOCKED contract docs (already updated when displayImageUrl was added)
- 1.1 — CI/CD pipeline (auto-deploy exists, only docs were inaccurate)

**Deferred to before-launch security pass:**
- 8.1 — wsRoomToken + PII in public GET response
- 3.4 — No file size cap on presigned uploads
- 4.1 — No rate limiting on public endpoints

Each resolved P1 has had its `⚠️ CONTRADICTORY (Aug 11 audit)` marker cleared in `PROJECT_CONTEXT.md` and `DECISIONS.md`. The audit body below is preserved as a historical snapshot — individual items are NOT marked resolved inline. Cross-reference `CURRENT_STATE.md` for what's still open.

**This file is frozen as of August 11, 2026.** It is a point-in-time snapshot and stays reproducible as one. Defects found *after* that date — including two introduced by the P1 fixes themselves — are recorded in `CURRENT_STATE.md`, not renumbered into this file. §14 below is the original suggested work order and is superseded by the FIX LIST in `CURRENT_STATE.md`.

# 1. Repo-level

### 1.1 — P1 — CI/CD pipeline does not exist **[Gap in code]**
`PROJECT_CONTEXT.md` §3 and §7 both reference `.github/workflows/deploy.yml` as the GitHub Actions pipeline that builds and deploys to Cloud Run. There is no `.github` directory in the repository at all. Every deploy is currently manual, and the documented GCP service account and secrets (`GCP_SA_KEY`, `GCP_PROJECT_ID`, `GCP_REGION`) have nothing consuming them.

### 1.2 — P2 — URL-to-key conversion is copy-pasted in about seven places **[Not in docs]**
Turning a stored public URL back into an R2 key is done by three named helpers plus roughly four inline copies:
- `r2.getKeyFromPublicUrl()` — reserved for the SD worker by `DECISIONS.md:61`
- `page.service.keyFromPublicUrl()` — local copy
- `comic.service.normalizeThumbnailInput()` — handles both keys and URLs
- Inline `url.replace(\`${publicBase}/\`, "")` in `comic.service.ts`, `page.service.ts`, `heroImage.service.ts`, `teamMember.service.ts`, `customerReview.service.ts`

`DECISIONS.md:61` and `:193` deliberately locked the first two apart, which is sound reasoning — but no third helper was provided for the ordinary "I have a URL, I want a key" case, so every service hand-rolled its own. Worth revisiting the decision.

### 1.3 — P3 — Eight other docs in `documents/` are unreferenced **[Not in docs]**
`COUNTRIES_API.md`, `PREVIEW_GENERATION_API.md`, `ANNOUNCEMENTS_API.md`, `HERO_IMAGES_API.md`, `FRONTEND_COMIC_INTEGRATION.md`, `production.md`, `laterenchanments.md`, `todo.md`. None of the four core docs say this set exists or which files are current.

### 1.4 — P3 — `todo.md` lists two tasks that are already done **[Contradiction]**
Both "complete the update endpoint for editing the comic details" and "make the delete endpoints for country and comic" are built and working.

---

# 2. Entry points and config

## `src/app.ts`

### 2.1 — P2 — Better Auth is mounted before `express.json()`, and this is load-bearing **[Not in docs]**
`app.all("/api/auth/*splat", ...)` sits above `app.use(express.json())` on purpose — Better Auth needs the raw request body. Nothing records this. If anyone reorders these two lines during a cleanup, authentication breaks in a way that is very hard to trace.

### 2.2 — P2 — `helmet()` runs after the auth route, so auth endpoints get no security headers **[Not in docs]**
The middleware order is CORS → auth handler → `express.json()` → helmet. Every `/api/auth/*` response skips helmet entirely.

### 2.3 — P3 — `app.set("trust proxy", 1)` is set **[Not in docs]**
Needed on Cloud Run so client IPs and the `secure` cookie flag work correctly behind the load balancer. Not mentioned anywhere.

### 2.4 — P3 — `GET /health` doesn't use the response envelope **[Contradiction]**
It returns the plain string `"App is working perfectly fine!"`. `PROJECT_CONTEXT.md:124` says every success response goes through `sendSuccess()`. This is a reasonable exception, but it is an undocumented one.

### 2.5 — P3 — A commented-out `allowedOrigins` array sits above the CORS config **[Not in docs]**
Contains `https://www.unilake.com` and `https://unilake.com` placeholders. Related to the open CORS question in `CURRENT_STATE.md:126`.

---

## `src/server.ts`

### 2.6 — P2 — The HTTP server has no graceful shutdown **[Gap in code]**
`initJobs()` registers SIGTERM/SIGINT handlers that close the BullMQ workers, but `server.close()` is never called. On a Cloud Run redeploy, in-flight HTTP requests and open WebSocket connections are cut off mid-flight. See also **7.2**.

### 2.7 — P3 — `listen()` does not pass `"0.0.0.0"` **[Contradiction]**
`PROJECT_CONTEXT.md` §8 states as a critical rule: "App must listen on `process.env.PORT` **and 0.0.0.0** for Cloud Run." The code calls `server.listen(config.port)` with no host. It works in practice because Node binds to all interfaces by default, but the documented rule is not literally implemented.

### 2.8 — P3 — Workers are not a "separate execution context" **[Contradiction]**
`PROJECT_CONTEXT.md:116` describes "BullMQ workers as separate execution context (started from `server.ts`)." They run in the same Node process, on the same event loop, as the web server. Worth correcting because it affects how you reason about CPU contention and memory on a 1-CPU Cloud Run instance.

---

## `src/config/env.ts`

### 2.9 — P1 — `R2_PUBLIC_URL_BASE` is never validated at boot **[Gap in code]**
It is missing from the `requriedVariables` list, but `getPublicUrl()` depends on it and is called by nearly every service. If it is unset, the app starts normally and silently writes `undefined/comics/...` into the database as permanent URLs. There is no error, no warning, and the damage is only visible once images fail to load. `PROJECT_CONTEXT.md` §8 says "R2_* (7 vars)", which hides that only six are enforced.

### 2.10 — P2 — `BETTER_AUTH_SECRET` is never validated at boot **[Contradiction]**
`PROJECT_CONTEXT.md` §8 lists it as a required env var and `.env.example` includes it, but it is absent from the required-variables check in `env.ts`.

### 2.11 — P3 — Unused import **[Not in docs]**
`import { string } from "zod"` — never referenced.

---

## `src/config/constants.ts`

### 2.12 — P3 — The file is completely empty **[Not in docs]**
Zero bytes. Not listed in the `PROJECT_CONTEXT.md` §7 folder structure, which shows only `config/{env,generation}.ts`. Safe to delete.

---

## `src/config/generation.ts`

### 2.13 — P3 — `DEFAULT_STEPS` and `DEFAULT_CFG` are exported but never imported **[Not in docs]**
The Prisma schema defaults (`steps Int @default(3)`, `cfg Float @default(1.0)`) do the real work. The two constants are dead exports that duplicate those values in a second place — if one is changed without the other, they drift.

---

# 3. `src/lib/`

## `src/lib/auth.ts`

### 3.1 — P2 — Facebook users without an email get a fake one **[Not in docs]**
`mapProfileToUser` falls back to `${profile.id}@facebook.local` when Facebook returns no email. Those accounts can never receive an order confirmation, a revisit link, or a PDF-ready email. This is a real user-facing consequence and no document mentions it.

### 3.2 — P2 — Cookie behaviour changes silently between environments **[Not in docs]**
`sameSite` is `"none"` and `secure` is `true` when `NODE_ENV === "production"`, `"lax"` and `false` otherwise. This is correct for a cross-origin frontend, but it is the classic cause of "login works locally, breaks on deploy," and it is not recorded alongside the CORS-in-two-places warning in `DECISIONS.md:210`.

### 3.3 — P3 — A commented-out `crossSubDomainCookies` block is waiting for the real domain **[Not in docs]**
Should be enabled at the same time as the CORS origin and `trustedOrigins` updates. That makes it **three** places to change, not the two `DECISIONS.md:210` warns about.

---

## `src/lib/r2.ts`

### 3.4 — P1 — Presigned upload URLs have no file-size cap **[Gap in code]**
`getSignedUploadUrl()` sets no `ContentLength` condition, so any presigned URL accepts a file of any size. This matters most for `POST /sessions/:id/photo/upload-url`, which is a **public, unauthenticated** endpoint — anyone can create a session and then upload unbounded data into your private bucket. Combined with **4.1** (no rate limiting) this is a genuine cost-abuse path. Noted in `laterenchanments.md` but absent from all four core docs.

### 3.5 — P2 — Upload URL expiry times are scattered and undocumented **[Not in docs]**
Nine different values across six services, with no single place listing them:

| Asset | Expiry |
|---|---|
| Child photo | 5 min |
| Font | 10 min |
| Comic thumbnail | 15 min |
| Country flag | 15 min |
| Page artwork / mask | 15 min |
| Hero image | 15 min |
| Team member photo | 15 min |
| Customer review video | 30 min |
| LoRA | 60 min |

The frontend needs these to know how long an upload URL stays usable.

### 3.6 — P3 — `requestChecksumCalculation: "WHEN_REQUIRED"` is critical and unexplained **[Not in docs]**
Newer AWS SDK versions send checksum headers that R2 rejects. Without this flag, uploads break. There is an inline comment but nothing in the docs, so a future SDK upgrade could remove it.

### 3.7 — P3 — `downloadFileToLocalPath()` has an inconsistent signature **[Not in docs]**
It takes a raw bucket **name** string, while every other function in the file takes `"public" | "private"`. Only the legacy Python validation service calls it.

---

## `src/lib/image.ts`

### 3.8 — P2 — The entire display-image feature is undocumented **[Not in docs]**
`buildDisplayImage()` is new, uncommitted, and appears in no document. Undocumented details:
- Output is WebP, long edge capped at **1600px**, quality **80**
- `withoutEnlargement: true` so small pages are never upscaled
- `fit: "inside"` so pages are never cropped
- The reasoning (a six-page preview was ~27 MB of print-resolution PNG, roughly 90 seconds on 4G; WebP brings it to ~250 KB) lives only in a code comment

---

## `src/lib/prisma.ts`

### 3.9 — P3 — No query logging or pool configuration **[Not in docs]**
`new PrismaClient({ adapter })` with nothing else. Fine, but it means there is no slow-query visibility.

---

## `src/lib/redis.ts`

### 3.10 — P3 — A `global._redisClient` singleton exists for dev hot-reload **[Not in docs]**
Prevents `tsx watch` from opening a new Redis connection on every file save. Only active when `NODE_ENV !== "production"`.

---

## `src/lib/logger.ts`

### 3.11 — P3 — Log level differs by environment **[Not in docs]**
`debug` in development, `info` in production, with `pino-pretty` only in development.

---

# 4. `src/middlewares/`

### 4.1 — P1 — There is no rate limiting anywhere in the application **[Gap in code]**
`PROJECT_CONTEXT.md` has a full Security section that never mentions this. Publicly reachable with no throttle:
- `POST /api/public/sessions` — creates unlimited DB rows
- `POST /api/public/feedbacks` — unlimited DB rows
- `POST /api/public/sessions/:id/photo/upload-url` — unlimited R2 upload URLs (see **3.4**)
- `POST /api/public/sessions/:id/generate` — spends real GPU money
- `POST /api/public/sessions/:id/pages/:n/regenerate` — spends real GPU money, capped at 3 per page but not per session

### 4.2 — P2 — Every guarded request does a fresh session lookup **[Not in docs]**
`requireAdmin` and `requireLoggedIn` both call `auth.api.getSession()` on every request with no caching. That is a database round-trip per request on every admin and user route.

### 4.3 — P3 — `validateBody` replaces `req.body` with the parsed result **[Not in docs]**
This means Zod `.default()` values are applied before the controller sees the body — which is how `Bubble.fontSize` and `sortOrder` get their defaults. Worth recording because it explains why the controllers can safely read fields the client never sent.

### 4.4 — P3 — `errorHandler` has no Prisma-specific handling **[Not in docs]**
Each service catches `P2002` / `P2025` individually. Any Prisma error that a service forgets to catch becomes a generic 500 with the message hidden in production.

---

# 5. `src/utils/`

### 5.1 — P3 — The error code strings are an undocumented API contract **[Not in docs]**
`errorHandler` returns `error.code` to the client: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`, plus `RUNPOD_SUBMIT_FAILED`, `RUNPOD_STATUS_FAILED`, `RUNPOD_JOB_FAILED`, `RUNPOD_POLL_TIMEOUT`, `RUNPOD_MALFORMED_OUTPUT` from the RunPod client. The frontend may branch on these. No document lists them.

---

# 6. `src/routes/`

## `src/routes/admin.ts`

### 6.1 — P2 — Page reordering is missing from the route map **[Not in docs]**
`PATCH /comics/:comicId/pages/reorder` exists with a full Zod schema and service implementation. `PROJECT_CONTEXT.md` §6 lists Page as only: list, create, upload-url, PATCH, DELETE. See **8.9** for the service-side detail.

### 6.2 — P3 — `GET /team-members/active` also exists on the admin router **[Not in docs]**
It duplicates the public endpoint. `DECISIONS.md:247` records splitting a duplicate `/team-members` route, but this admin-side "active" variant is a separate thing and is undocumented.

### 6.3 — P3 — Country POST and PUT bypass `validateBody` — *already tracked* **[Contradiction]**
Listed in `CURRENT_STATE.md:173`. Kept here for completeness.

---

## `src/routes/public.ts`

### 6.4 — P2 — Session route paths are wrong in two places in `PROJECT_CONTEXT.md` **[Contradiction]**
Line 186 says `PATCH /api/sessions/:sessionId/attach-user` and line 258 says `POST /api/sessions/:id/checkout`. Line 272 correctly says `/api/public/sessions/...`. Only the `/api/public/` form exists. In a doc that doubles as the frontend route map, this will send someone to a 404.

### 6.5 — P3 — `GET /countries` is not in the public route list **[Not in docs]**
The active-countries endpoint is new (uncommitted) and absent from `PROJECT_CONTEXT.md` §6.

---

# 7. `src/controllers/` and `src/jobs/workers/index.ts`

### 7.1 — P3 — Query strings are validated by a third, informal pattern **[Not in docs]**
`comic.controller.ts` (twice) and `feedback.controller.ts` call `schema.parse(req.query)` inside a try/catch that converts `ZodError` to `ValidationError`. This is the stand-in for the deferred `validateQuery` middleware. It works and is safe, but it is a third validation style alongside `validateBody` and the leftover controller `.parse()` calls — undocumented as a pattern.

### 7.2 — P2 — Graceful shutdown never terminates the process **[Gap in code]**
`workers/index.ts` closes the BullMQ workers, then does nothing. It never calls `process.exit()`, never closes the Redis connection, and never closes the HTTP server (see **2.6**). On SIGTERM the process can hang until Cloud Run force-kills it.

### 7.3 — P3 — Leftover controller `.parse()` calls — *already tracked, but the risk is overstated* **[Contradiction]**
`CURRENT_STATE.md:172` lists `page.controller.ts`, `bubble.controller.ts`, and `font.controller.ts` as still double-validating. Five call sites remain, none wrapped in try/catch. **They are currently unreachable** — every one of those routes runs `validateBody` with the *same* schema first, so the second parse cannot fail. This is duplication, not a live 500 risk. It only becomes the failure mode `DECISIONS.md:37` prohibits if someone removes a `validateBody` from one of those routes.

### 7.4 — P3 — `theme.controller.ts` has an import in the middle of the file **[Not in docs]**
`import { getAllThemes }` sits below the delete handler. Valid ESM (imports are hoisted), just inconsistent with every other file.

### 7.5 — P3 — `theme.controller.ts` doesn't guard its route param **[Not in docs]**
Every other controller checks `if (!id || typeof id !== "string")`. This one passes `themeId` straight through to a service typed as `any`.

### 7.6 — P3 — Unused import in `country.controller.ts` **[Not in docs]**
`import { success } from "zod"` — never referenced.

### 7.7 — P3 — Dead code in `comic.controller.ts` — *already tracked* **[Contradiction]**
`uploadThumbnailRequestSchema` plus a fully commented-out handler. Listed in `CURRENT_STATE.md:171`.

---

# 8. `src/services/`

## `src/services/session.service.ts`

### 8.1 — P1 — `GET /sessions/:id` hands out `wsRoomToken` to anyone **[Contradiction]**
`PROJECT_CONTEXT.md:185` and `:422` establish a two-tier secret model: "`sessionId` is semi-public, `wsRoomToken` is the actual secret." But `GET /api/public/sessions/:id` is unauthenticated and returns `wsRoomToken` in its response. Anyone who learns a sessionId immediately has the WebSocket secret too, which collapses the model into a single secret. The response also exposes the full shipping address and `notificationEmail` to anyone with the sessionId.

### 8.2 — P1 — `confirmSessionPhoto` trusts a client-supplied R2 key **[Gap in code]**
The endpoint accepts `{ key }` and writes it straight to `bestPhotoUrl` and `rawPhotoUrls` with no check that the key sits under `sessions/{thisSessionId}/`. A caller can point their session at any object in the private bucket — including another session's child photo, which then gets face-swapped into their comic and delivered to them.

### 8.3 — P2 — `updateOrderSession` has no status or expiry guard **[Gap in code]**
Every other session mutation checks status (`PHOTO_MUTABLE_STATUSES`, `GENERATABLE_STATUSES`, `REGENERATABLE_STATUSES`). This one checks nothing. You can PATCH `childName` or `pronounKey` after generation has already finished, which leaves the personalised text in the generated images out of sync with the database — including after payment.

### 8.4 — P2 — The `GET` response shape changed but is marked LOCKED **[Contradiction]**
Each variant now returns `displayImageUrl`. `PROJECT_CONTEXT.md:283-312` documents this shape as "LOCKED — frontend building against this" without the field.

### 8.5 — P2 — `attachUserToSession` doesn't check expiry **[Gap in code]**
An expired session can still have a user attached to it.

### 8.6 — P3 — Orphaned-row recovery is built, but the docs say it's still open **[Contradiction]**
`CURRENT_STATE.md:157` and `DECISIONS.md:268` both list this as an unfixed loose end. The code now handles it fully: it finds existing rows, creates only the missing ones, resets stale non-QUEUED rows back to QUEUED with `errorMessage: null`, skips rows already at `SD_READY`, and pairs each row to its page by ID lookup rather than array position. This item can be closed.

### 8.7 — P3 — Sessions at `AWAITING_PAYMENT`, `PAID`, or `CONFIRMED` cannot regenerate **[Not in docs]**
`REGENERATABLE_STATUSES` is `[GENERATING_PREVIEW, PREVIEW_READY, GENERATING_PAID, PAID_PAGES_READY]`. A user who has paid but whose paid-page generation hasn't started yet cannot regenerate anything. Probably intentional, but unrecorded.

### 8.8 — P3 — `PHOTO_MUTABLE_STATUSES` is shared between two endpoints on purpose **[Not in docs]**
The upload-URL and confirm endpoints gate on the same constant. The code comment notes the two halves drifted apart once, making photo re-upload unreachable from the frontend. The docs only mention the confirm side accepting both statuses.

---

## `src/services/page.service.ts`

### 8.9 — P1 — R2 files are deleted before the database row **[Contradiction]**
`deletePage` deletes the artwork and mask from R2, *then* calls `prisma.page.delete()`. If the DB delete fails, the files are already gone and the page row survives pointing at dead URLs. `PROJECT_CONTEXT.md:173` explicitly states the rule as "DB row first, R2 cleanup logged on failure." The three CMS services follow that rule; this one and `comic.service` do not.

### 8.10 — P2 — Pages of a PUBLISHED comic can be freely edited and deleted **[Gap in code]**
`reorderComicPages` refuses to touch a published comic and refuses if any active order sessions exist. `updatePage` and `deletePage` have neither guard. You can delete a page out from under a comic that customers are actively ordering.

### 8.11 — P2 — The whole reorder feature is undocumented **[Not in docs]**
Undocumented behaviour worth recording:
- Refuses to reorder a `PUBLISHED` comic (409)
- Refuses if any order session is in a non-terminal status (409)
- Requires the **complete** list of page IDs, not a subset (400)
- Rejects page IDs belonging to another comic (400)
- Uses a **two-phase renumber**: it first parks every page on a negative page number, then assigns the real ones. This is a workaround for `@@unique([comicId, pageNumber])`, which Postgres enforces per-statement — writing final numbers directly would fail the moment two pages swap positions.

### 8.12 — P3 — A mask uploaded without artwork is stored completely unvalidated **[Not in docs]**
`createPage` only checks mask dimensions if artwork is present in the same request. Otherwise the mask is saved with no check at all and only gets verified later, when artwork is eventually attached via `updatePage`.

### 8.13 — P3 — The aspect-ratio warning threshold is undocumented **[Not in docs]**
`ASPECT_RATIO_TOLERANCE = 0.01`. The docs say an aspect-ratio change warns but never say how much change counts as one.

### 8.14 — P3 — `createPage` always returns an empty `warnings` array **[Not in docs]**
The field exists purely so create and update return the same shape. Only `updatePage` ever populates it.

---

## `src/services/comic.service.ts`

### 8.15 — P1 — R2 files are deleted before the database row **[Contradiction]**
Same problem as **8.9**. `deleteComic` removes all thumbnails and all page assets from R2 *first*, then calls `prisma.comic.delete()`. A failure at the delete step — for example the active-session guard passing but a foreign key firing — leaves a comic whose every image is gone.

### 8.16 — P2 — A theme can be attached to a comic but never removed **[Gap in code]**
`updateComic` only ever does `updateData.theme = { connect: { id } }`. There is no `disconnect` path and no way to send null. Once a comic has a theme, it has one forever.

### 8.17 — P2 — `updateComic` never re-checks `freePreviewPages < pageCount` **[Gap in code]**
`createComicSchema` enforces this with a `.refine()`. `updateComicSchema` does not. You can PATCH a comic into a state where the free preview count exceeds the total page count, which then triggers the drift warning in `enqueuePreviewGenerationJobs` forever.

### 8.18 — P3 — `deleteComic` also cleans up page artwork and masks **[Not in docs]**
`PROJECT_CONTEXT.md:242` and `DECISIONS.md:107` describe comic delete as cleaning up "all thumbnails." It also walks every page and deletes its artwork and mask from R2 — necessary, because pages cascade-delete in the DB but their R2 files do not.

### 8.19 — P3 — Create and update disagree on `freePreviewPages` **[Not in docs]**
Create allows `0` (`nonnegative()`), update requires at least `1` (`positive()`). Same field, two different rules.

---

## `src/services/bubble.service.ts`

### 8.20 — P2 — Cross-comic fonts are blocked on update but not on create **[Gap in code]**
`updateBubble` verifies the font belongs to the same comic and throws 409 if not. `createBubble` does no such check — it just does `{ connect: { id: input.fontId } }`. `PROJECT_CONTEXT.md:172` and `DECISIONS.md:31` say "Cross-comic font assignment blocked on bubble update," which is literally accurate but reads as if the rule is fully enforced. You can assign any comic's font at creation time.

---

## `src/services/font.service.ts`

### 8.21 — P2 — Replacing a font file leaves the old file in R2 forever **[Contradiction]**
`updateFont` overwrites `fileUrl` with the new key and never deletes the old object. `PROJECT_CONTEXT.md:173` describes cleanup-on-replace as the established pattern, and pages, comics, and team members all implement it. Fonts do not.

### 8.22 — P2 — Deleting a font leaves its file in R2 forever **[Gap in code]**
`deleteFont` correctly blocks when bubbles reference the font, then deletes the DB row — but never removes the `.ttf`/`.otf` from the private bucket.

---

## `src/services/country.service.ts`

### 8.23 — P2 — `Country.isActive` can never be changed **[Gap in code]**
The field exists, defaults to `true`, and `getActiveCountries()` filters on it — but it is absent from `createCountrySchema`, absent from `updateCountrySchema` (which is just `createCountrySchema.partial()`), and there is no toggle route. Every country is permanently active. The new public `GET /countries` endpoint therefore filters on something that can never be false.

### 8.24 — P3 — Deleting a country leaves its flag image in R2 **[Gap in code]**
`deleteCountry` blocks on pricing rules and deletes the DB row, but never removes the flag from the public bucket.

---

## `src/services/heroImage.service.ts`, `customerReview.service.ts`, `teamMember.service.ts`

### 8.25 — P3 — `HeroImage` and `CustomerReview` have no update endpoint **[Not in docs]**
Only create, toggle status, and delete. To fix a typo in a customer review's name or description you must delete the row and recreate it, which also means re-uploading the video. The route map matches this, but the limitation is never called out as a deliberate choice.

### 8.26 — P3 — These three are the ones following the documented delete order **[Not in docs]**
All three delete the DB row first, then attempt R2 cleanup inside a try/catch. This is exactly what `PROJECT_CONTEXT.md:173` prescribes. Recording it here so it's clear that **8.9** and **8.15** are the outliers, not the norm.

---

## `src/services/photoValidation.service.ts`

### 8.27 — P3 — Still copied into the Docker image, but Python is not **[Not in docs]**
The Dockerfile copies all of `src/`, including this file, while deliberately excluding `venv/` and `requirements.txt`. If anything ever imports and calls it in production it will fail at runtime looking for a Python executable that isn't there. Currently nothing calls it.

---

# 9. `src/jobs/`

## `src/jobs/workers/generationWorker.ts`

### 9.1 — P1 — A permanently failed page leaves the session stuck forever **[Gap in code]**
When a page exhausts all three BullMQ attempts, the row is marked `FAILED` and `page:error` is emitted — but the **session status is never changed**. It stays at `GENERATING_PREVIEW` indefinitely. Consequences:
- `maybeMarkPreviewReady` can never fire, because that page will never reach `SD_READY`, so the count never completes
- The user's page sits on a loading state with no terminal state to render
- `OrderSessionStatus.FAILED` exists in the schema and **is never written by any code in the repository**

There is no timeout, no dead-letter handling, and no admin path to recover a stuck session.

### 9.2 — P1 — `maybeMarkPreviewReady` does not have the lock the docs claim **[Contradiction]**
`CURRENT_STATE.md:35`, `PROJECT_CONTEXT.md:158`, and `DECISIONS.md:143` all describe "a `$transaction` that locks the OrderSession row." The inline comment goes further and argues the mechanism explicitly: *"calling findUnique inside a transaction serializes access via Postgres' MVCC."*

That is backwards. MVCC exists specifically so readers do **not** block each other, and `findUnique` emits a plain `SELECT` with no `FOR UPDATE`. At READ COMMITTED, two workers finishing the last two preview pages can both read `GENERATING_PREVIEW`, both pass the guard, and both flip the status and emit `session:preview-ready`.

The window is narrow and the damage is a duplicate WebSocket event, not corruption. But the docs record a guarantee the code does not provide, which means it stops being re-examined. A real fix needs `SELECT ... FOR UPDATE` via `$queryRaw`, or a conditional `updateMany` with the status in the `where` clause and a check on the returned count.

### 9.3 — P2 — The worker never checks session expiry before spending money **[Gap in code]**
A job picked up after the session's 24-hour `expiresAt` will still run the full RunPod face-swap at real GPU cost, for a session the user can no longer meaningfully use. See also **10.1**.

### 9.4 — P2 — The docs describe the counting bug you already fixed **[Contradiction]**
`CURRENT_STATE.md:37` and `PROJECT_CONTEXT.md:158` both say the transition fires "when count reaches `freePreviewPages`." The code counts `page.count({ comicId, isPreviewPage: true })` instead, which is correct and consistent with the August 7 decision. **The code is right and the docs are wrong here** — following the docs would reintroduce the exact drift bug that decision was written to prevent.

### 9.5 — P3 — `buildAndUploadDisplayImage` is undocumented **[Not in docs]**
Including the deliberate design choice that it **never throws**: if the resize fails, it logs and returns `null` rather than failing a job that has already completed an expensive GPU round-trip. The API then returns `displayImageUrl: null` and the client falls back to `finalImageUrl`.

### 9.6 — P3 — The zero-preview-pages guard is undocumented **[Not in docs]**
`if (totalPreviewPages === 0) return false;` — without it, the comparison below is `0 >= 0` and a comic with no preview pages flagged would flip to `PREVIEW_READY` instantly.

### 9.7 — P3 — Error messages are truncated to 500 characters **[Not in docs]**
`MAX_ERROR_MESSAGE_LENGTH = 500` before writing to `errorMessage`. A long RunPod traceback is cut off, and that truncated text is what the frontend shows the user.

---

## `src/jobs/workers/sd/runpodClient.ts`

### 9.8 — P1 — One network blip on a status poll costs you a full GPU job **[Not in docs]**
`fetchStatus()` has no retry. A single transient failure — a dropped connection, a 502 from RunPod's edge, a DNS hiccup — throws immediately. That propagates up through `pollUntilDone` to the worker's catch block, which re-throws so BullMQ retries **the entire job**, including a brand-new RunPod submission.

The already-running job on RunPod is never cancelled, so you pay for both. With a warm A40 at roughly 120 seconds per page, a poll failure at the 100-second mark costs a full extra generation. At 200 polls per job over ~17 minutes, the chance of at least one transient failure is not small. A couple of retries around `fetchStatus` would remove this entirely.

### 9.9 — P3 — Only the first output image is read **[Not in docs]**
`decodeResultImage` reads `output.images[0]` and silently ignores anything else. Fine for the current workflow, which has one `SaveImage` node — but it fails silently rather than loudly if the workflow ever changes.

---

## `src/jobs/workers/sd/textStamp.ts`

### 9.10 — P2 — Fonts are re-downloaded from R2 on every single job **[Not in docs]**
`fontCache` is a `Map` created **inside** `stampTextOnPage`, so it only deduplicates fonts within one page. Every job for every page of every session downloads the same font files again. The docs describe the photo cache in careful detail; nothing mentions that fonts have no equivalent, even though they are the more obvious caching candidate (a comic has 1–3 fonts shared across all 24 pages and every user).

### 9.11 — P2 — A bubble flush against the edge can crash the job **[Not in docs]**
Bubble geometry is validated as `x + width <= 1 + BUBBLE_BOUND_EPSILON`, so `x + width` can legitimately be slightly over 1. Those fractions are then multiplied by the artwork size and rounded **independently**:

```
xPx = Math.round(bubble.x * artworkWidth)
widthPx = Math.round(bubble.width * artworkWidth)
```

`xPx + widthPx` can therefore land one or two pixels past the canvas edge, and Sharp throws `Image to composite must have same dimensions or smaller` — failing the whole page. Untested edge case, and it is reachable by an admin dragging a bubble flush to the right or bottom edge in the mapper.

### 9.12 — P3 — The font family name is injected into the SVG unescaped **[Not in docs]**
`escapeXml` is correctly applied to the dialogue text, but `fontFamily` comes straight from `Font.name` and goes into both a CSS `@font-face` block and a class rule. A font named `Bob"s Font` produces malformed SVG. Admin-only input, so low risk.

### 9.13 — P3 — A bubble with no font still emits an empty `@font-face` **[Not in docs]**
When `bubble.font` is null, `fontBase64` is `""` and the SVG contains `src: url(data:font/truetype;base64,)`. The browser-equivalent parser in Sharp ignores it and falls back to `sans-serif`, so it works — but it is emitting invalid CSS on purpose.

### 9.14 — P3 — The auto-shrink loop decrements one pixel at a time **[Not in docs]**
`fitTextToBox` starts at `fontSize * artworkHeight` and subtracts 1 until the text fits or hits the floor. With the default `fontSize` of 0.02 on a 1536px page that starts at ~31px, which is fine. With a large `fontSize` on a tall page it can iterate hundreds of times per bubble, re-wrapping the text on every pass.

---

## `src/jobs/workers/sd/photoCache.ts`

### 9.15 — P2 — The cache has no size limit **[Not in docs]**
Entries are bounded only by refcount and a 15-minute idle sweep. Under a burst of many simultaneous sessions, the map can hold many multi-megabyte photo buffers at once, in a container documented at `--memory 1Gi`. Nothing caps the total.

### 9.16 — P3 — The justification for the missing `.unref()` is wrong **[Contradiction]**
The comment reads: *"this module is only imported inside the worker process... the worker itself holds the process open, so we don't need it."* There is no separate worker process — `initJobs()` runs in the same process as the web server (see **2.8**). The outcome is harmless because the HTTP server keeps the process alive regardless, but the stated reason is based on an architecture that doesn't exist.

---

## `src/jobs/queues.ts`

### 9.17 — P3 — Job retention settings are undocumented **[Not in docs]**
Completed jobs kept 24 hours or the last 1000, whichever is stricter. Failed jobs kept 7 days. The docs mention `attempts: 3` and the exponential backoff but not the retention policy, which is what determines how long you can debug a failure after the fact.

### 9.18 — P3 — Nothing ever enqueues to `pdfCompilationQueue` **[Not in docs]**
The queue is created and `pdfWorker` is running and listening, but no code anywhere adds a job to it. The docs say the worker is a stub; they do not say the producer side is entirely absent.

---

## `src/test-job.ts`

### 9.19 — P3 — It enqueues a payload shape the worker no longer understands **[Not in docs]**
It sends `{ prompt, sessionId, userId }`. The worker expects `{ pageVersionId }` and would immediately fail on `findUnique({ where: { id: undefined } })`. Running this file injects a guaranteed-failing job into the real queue.

---

# 10. `src/websocket/`

## `src/websocket/wsServer.ts`

### 10.1 — P2 — The upgrade handler fires for every WebSocket request on any path **[Not in docs]**
`httpServer.on("upgrade", ...)` has no path check. Any upgrade attempt to any URL runs the full session lookup. There is no `/ws` prefix guard.

### 10.2 — P2 — Token verification runs the heaviest query in the codebase **[Not in docs]**
The handshake calls `getOrderSessionId(sessionId)` — three sequential queries returning the session, every page of the comic, and every page version — purely to compare one token string and read one boolean. Two problems: it is wasteful per connection, and it silently couples WebSocket authentication to the shape of the public GET response. Any future trim of that response breaks WS auth with no compile-time warning.

### 10.3 — P2 — No ping/pong heartbeat **[Gap in code]**
Dead connections stay in the room `Map` until the OS tears down the socket. Since rooms are the delivery mechanism for `page:ready`, a stale socket means the emit loop iterates over connections that will never receive anything, and the room is never cleaned up.

### 10.4 — P3 — No limit on connections per session **[Gap in code]**
One sessionId and token can open unlimited sockets, all of which receive every event.

---

## `src/websocket/event.ts`

### 10.5 — P2 — The event contract changed but is marked LOCKED **[Contradiction]**
`emitPageReady` now includes `displayImageUrl`. `PROJECT_CONTEXT.md:315` and `DECISIONS.md:156` both document the shape as `{ type, pageNumber, variantIndex, imageUrl, pageVersionId }` and flag it as "LOCKED — frontend building against this."

---

# 11. `prisma/schema.prisma`

### 11.1 — P1 — Session expiry is never actually enforced **[Contradiction]**
The `expiresAt` comment says "24hr TTL equivalent, enforced at query time / cleanup job." Neither exists:
- **No cleanup job** — nothing deletes or fails expired sessions
- **Query-time enforcement only reports** — `getOrderSessionId` computes `isExpired` and returns it, but nothing acts on it
- The **only** place expiry blocks anything is the WebSocket handshake (410 Gone)

An expired session can still be PATCHed, still generate, still regenerate, still have a user attached, and still consume GPU budget. Expired sessions accumulate in the database forever along with their R2 assets.

### 11.2 — P2 — Most of `OrderSessionStatus` is unreachable **[Not in docs]**
Only four of the thirteen values are ever written: `CREATED`, `PHOTO_UPLOADED`, `GENERATING_PREVIEW`, `PREVIEW_READY`. Never written by any code: `AWAITING_PAYMENT`, `PAID`, `GENERATING_PAID`, `PAID_PAGES_READY`, `CONFIRMED`, `COMPILING_PDF`, `DISPATCHED`, `COMPLETED`, `FAILED`. Most are waiting on unbuilt features and that's expected — but `FAILED` is different, because the failure path that should set it already exists and doesn't (see **9.1**). The docs list the full enum without indicating which values are live.

### 11.3 — P2 — `displayImageUrl` is a new column no document mentions **[Not in docs]**
Added in migration `20260808020240_added_display_image_in_page_version`.

### 11.4 — P3 — `Page.mirrorFace` and `Page.faceDirection` are completely dead **[Not in docs]**
Both are stored, both are in the create and update Zod schemas, both are editable through the admin API — and **neither is read by anything**. The worker never reads them and `buildWorkflow` never receives them. They are dead in exactly the way `Comic.loraFileUrl` is dead, but unlike the LoRA fields, no document lists them as retained-but-unused. The admin UI will surface controls that do nothing.

### 11.5 — P3 — `OrderSession.photoScoreJson` is dead **[Not in docs]**
Left over from the removed Python validation pipeline. Nothing writes it, and `getOrderSessionId` deliberately excludes it from the response. Not listed alongside the other retained-but-unused fields.

### 11.6 — P3 — The `Country` model has no `@@map` **[Not in docs]**
Its table is named `Country` while every other table is snake_case: `comics`, `pages`, `bubbles`, `order_sessions`, `page_versions`, `pricing_rules`. Fixing it now requires a rename migration.

### 11.7 — P3 — `PageVersion.isSelected` is never written **[Not in docs]**
It is read and returned in the GET response but nothing sets it. Waiting on the unbuilt confirm endpoint.

### 11.8 — P3 — Three models have no code touching them at all **[Not in docs]**
`Order`, `WebhookEvent`, and `SystemConfig`. Expected given payments aren't built, but the docs describe them without noting they are entirely inert.

### 11.9 — P3 — Stale schema comments — *already tracked* **[Contradiction]**
`Country.flagUrl` says "path" but stores a full URL; `rawPhotoUrls` says "up to 2" but the decision is 1; a stray `// pageNumber Int` comment sits in `PageVersion`. All listed in `CURRENT_STATE.md:174-175`.

---

# 12. Build and tooling

## `tsconfig.json`

### 12.1 — P2 — There is no typecheck safety net anywhere **[Not in docs]**
Two things combine here:
- `"types": []` means Node's type definitions are not loaded globally, so `process`, `Buffer`, `setInterval` and friends have no types
- You run `tsx`, which strips types and never typechecks

The result is that **nothing in the project ever runs a type check**. `npx tsc --noEmit` today would produce a wall of errors from the missing Node types, so it isn't usable as a check either. `PROJECT_CONTEXT.md` says "No `tsc` build step," which is true and intentional — but it does not follow that there should be no typecheck *step*. Type errors currently surface only when the line executes at runtime.

### 12.2 — P3 — A code comment claims a compiler setting that is off **[Contradiction]**
`announcement.service.ts` has a comment reading "exactOptionalPropertyTypes-safe: build the update object field-by-field." `tsconfig.json` sets `"exactOptionalPropertyTypes": false`. The defensive pattern is good practice regardless, but the stated reason is wrong.

### 12.3 — P3 — `"jsx": "react-jsx"` in a backend-only project **[Not in docs]**
Harmless leftover from the tsconfig template.

---

## `package.json`

### 12.4 — P2 — `winston` is an installed dependency **[Contradiction]**
`DECISIONS.md:10` lists "Winston logging" as a NEVER-DO with the reasoning "Pino chosen." Winston is in `dependencies`, ships to production, and is imported by nothing. Either the decision or the dependency should go.

### 12.5 — P3 — `prettier` is in `dependencies`, not `devDependencies` **[Not in docs]**
It ships into the production image for no reason.

### 12.6 — P3 — `ts-node-dev` is installed but unused **[Not in docs]**
Superseded by `tsx`.

### 12.7 — P3 — `"main": "server.ts"` is the wrong path **[Not in docs]**
Should be `src/server.ts`. Harmless because nothing reads it.

### 12.8 — P3 — No `engines` field **[Not in docs]**
The Dockerfile pins `node:22-bookworm-slim`, but nothing stops a developer running Node 18 or 24 locally.

### 12.9 — P3 — No test, lint, or build scripts **[Not in docs]**
Only `dev` and `start`. Consistent with testing via Apidog, but it means there is no command a CI pipeline could run even once **1.1** is built.

---

## `Dockerfile`

### 12.10 — P3 — The container runs as root **[Not in docs]**
No `USER node` directive. Standard hardening step that hasn't been taken.

### 12.11 — P3 — No `HEALTHCHECK` **[Not in docs]**
`GET /health` exists in the app but the container never declares it.

---

# 13. Corrections needed in the four documents

Separate from code changes — these are edits to the docs themselves.

### 13.1 — P1 — Update both LOCKED frontend contracts for `displayImageUrl`
`PROJECT_CONTEXT.md:283-312` (GET response) and `:315` / `DECISIONS.md:156` (WebSocket events). These are the two things explicitly marked as what the frontend is building against, so they are the highest-value lines in the doc set to keep accurate.

### 13.2 — P2 — Move four resolved items out of the loose-ends list
`PROJECT_CONTEXT.md:76` instructs "Never assume a task is done just because it was discussed — check `CURRENT_STATE.md`." Right now that check returns stale data and would cause redundant work. All four of these are already built:

| Listed as open | Where it's actually implemented |
|---|---|
| "Orphaned QUEUED rows... needs a recovery path" (`CURRENT_STATE:157`, `DECISIONS:268`) | `session.service.ts`, Steps 2–4 of `enqueuePreviewGenerationJobs` |
| "PATCH-only-artwork rejecting stale mask (likely bug)" (`CURRENT_STATE:148`) | `page.service.ts` — re-verifies an untouched mask when artwork changes |
| "Partial bubble PATCH bounds (likely bug)" (`CURRENT_STATE:150`) | `bubble.service.ts` — merges stored and incoming values before validating |
| "Verify `/api/admin/status` exists" (`CURRENT_STATE:176`) | It exists, `admin.ts:134` |

### 13.3 — P2 — Correct the `maybeMarkPreviewReady` description in three files
`CURRENT_STATE:35`, `PROJECT_CONTEXT:158`, `DECISIONS:143`. Remove the row-lock claim (see **9.2**) and correct the count source from `freePreviewPages` to `isPreviewPage` (see **9.4**).

### 13.4 — P2 — Fix the session route paths in `PROJECT_CONTEXT.md`
Lines 186 and 258 use `/api/sessions/...`; only `/api/public/sessions/...` exists. See **6.4**.

### 13.5 — P3 — `DECISIONS.md:172` describes a seed conversion that doesn't happen **[Contradiction]**
It states: "Seed conversion: `Number(seed)` from BigInt before JSON stringify." The actual flow is the reverse — the worker generates a JavaScript number with `Math.floor(Math.random() * 1e9)`, patches that number directly into the workflow, and only converts to `BigInt(seed)` when writing to the database afterward. There is no BigInt-to-Number conversion anywhere in the codebase.

### 13.6 — P3 — `PROJECT_CONTEXT.md:96` overstates the Sharp wrapper
It says Sharp is "wrapped in `src/lib/image.ts`." Both `generationWorker.ts` and `textStamp.ts` import `sharp` directly. The wrapper is one of three entry points, not the only one.

### 13.7 — P3 — `PROJECT_CONTEXT.md` §7 folder structure is missing `config/constants.ts`
See **2.12**.

### 13.8 — P3 — `DECISIONS.md` is fighting its own stated rule
The header says "Prune superseded entries — don't keep historical footnotes," but the file carries a 21-line SUPERSEDED section and a 46-line MISTAKES CAUGHT section. Roughly a third of MISTAKES CAUGHT is "Claude did X wrong" — session narrative that `SESSION_LOG.md` already records verbatim. At 297 lines the file is past the point where it gets read start to finish, which undermines its purpose as the conflict-check reference.

### 13.9 — P3 — The NEVER-DO list has two homes that have drifted
`PROJECT_CONTEXT.md:53-76` carries 26 never-dos and says "see DECISIONS.md for full list." `DECISIONS.md:9-82` carries 60+. The subset is hand-maintained, so every new decision must be remembered in two places. Items **13.1** and **13.3** are what happens when that upkeep slips.

---

# 14. Suggested order of work

Not a schedule — just the sequence that removes the most risk per hour.

**First — things that cost money or lose data**
- **9.1** Session never marked FAILED (stuck sessions)
- **9.8** RunPod poll retry (paying twice for GPU jobs)
- **8.9** / **8.15** Flip the R2-before-DB delete order in `page.service` and `comic.service`
- **11.1** Decide what enforcing session expiry actually means

**Second — the security cluster** (these four are one piece of work)
- **8.1** `wsRoomToken` exposed by the public GET
- **8.2** `confirmSessionPhoto` trusts a client-supplied key
- **4.1** No rate limiting
- **3.4** No upload size cap

**Third — quick correctness wins**
- **2.9** Add `R2_PUBLIC_URL_BASE` to the required env list (a one-line change that prevents a silent, permanent data-corruption mode)
- **8.20** Cross-comic font check on bubble create
- **8.23** A way to toggle `Country.isActive`
- **8.16** A way to remove a theme from a comic
- **8.3** Status guard on `updateOrderSession`

**Fourth — doc sync**
- **13.1** through **13.4**

**Fifth — everything else**, as it comes up.
