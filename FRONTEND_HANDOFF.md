# Unilake Backend — Frontend Handoff

Technical reference for building the frontend against the Unilake backend. Pulled directly from route files, controllers, Zod validators, and `schema.prisma` — not from intent docs. Where the docs and code disagreed, the code won; every disagreement found is listed in Section 16.

---

## 1. Project overview

Unilake is a personalized children's storybook platform: a parent uploads a photo of their child, picks a comic template, and the platform generates a 24-page comic with the child's face AI-inserted into the artwork and personalized dialogue (name, pronouns) stamped into speech bubbles. The finished comic is compiled into a print-ready PDF and shipped.

Two audiences: **parents** (browse/preview anonymously, must log in via Google/Facebook/email before paying) and **admins** (manage comics, pages, bubbles, fonts, pricing, themes, CMS content, orders — small trusted set, roles assigned manually in the DB).

Flow: an anonymous visitor creates an `OrderSession` tied to a `comicId`, uploads a photo, fills in child details, triggers generation of free preview pages, then must log in before paying to unlock the remaining pages, select final variants, and receive a shipped physical book.

---

## 2. What's built vs not built

### ✅ Ready today
- Full CRUD: Comics, Pages, Bubbles, Fonts, Themes, Countries, Pricing rules
- Full CRUD: AnnouncementBar, HeroImage, CustomerReview, TeamMember, Feedback (CMS)
- SavedAddress CRUD (list/create/update/delete/set-default) with ownership checks
- OrderSession create/update/get, photo upload + validation, generate-trigger, per-page regenerate endpoints
- Auth: Better Auth (Google, Facebook, email/password), `requireAdmin`/`requireLoggedIn` middleware, `attach-user` flow
- WebSocket server with token-based auth and room-based event delivery

### 🚧 In progress / partially working
- **Generation pipeline** — `POST /sessions/:sessionId/generate` and the regenerate endpoint work and enqueue real BullMQ jobs, but `sdWorker.ts`/`hdWorker.ts` are **stubs**. Jobs get queued, `status` flips to `GENERATING_PREVIEW`, but nothing currently processes them into real images — no `page:ready` WebSocket event will fire yet. Treat the generation pipeline as **not functionally complete** even though the endpoints exist and respond successfully.
- **Photo validation** — endpoint is live and enforced server-side today (legacy Python pipeline), even though the documented long-term intent is to move this fully to frontend MediaPipe.js. See Section 12 and Section 16.

### ⏳ Planned (no code exists yet)
- Checkout / payment confirmation endpoints (`POST /sessions/:id/checkout`, `POST /sessions/:id/confirm`)
- Razorpay integration
- HD upscale + PDF compilation
- User-facing order list/detail (`/api/user/orders`)
- Admin order list/detail
- Shiprocket integration
- Email notifications
- `POST /api/webhooks/razorpay`, `POST /api/webhooks/shiprocket`

---

## 3. Base URLs & environments

| Environment | URL |
|---|---|
| Local dev | `http://localhost:<PORT>` — `PORT` from `.env`, defaults to `8080` in Cloud Run |
| Cloud Run (production) | `https://unilake-backend-590672762351.asia-south1.run.app` (`asia-south1`) |
| Alternate/staging seen in code | `https://unilake-backend.onrender.com` (present in Better Auth `trustedOrigins` — confirm with backend which is actually live before relying on it) |
| WebSocket | `ws://<host>/?sessionId=<orderSessionId>&token=<wsRoomToken>` (`wss://` in production) |
| Auth base path | `/api/auth/*` (all Better Auth routes — sign-in, sign-out, callback, session, etc.) |
| Health check | `GET /health` → plain text `"Logger is working!"`, not JSON |

**CORS is currently hardcoded to `http://localhost:3000` only** ([app.ts:24-30](src/app.ts#L24-L30)) — `credentials: true` is set, but no production frontend origin is allow-listed yet. This must be updated before the frontend can call the API from anywhere other than that exact local URL.

---

## 4. Authentication

Better Auth backs both admin and customer auth ([lib/auth.ts](src/lib/auth.ts)).

- **Providers enabled:** Google, Facebook, email/password.
- **Session cookie:** `sameSite: "none"`, `secure: true`, `httpOnly: true`. Because `secure: true` is set, the cookie will only be sent over HTTPS — most browsers treat `localhost` as a secure context so local dev over `http://localhost` still works, but any non-localhost HTTP origin will silently fail to receive/send the cookie.
- **Role field:** every `User` has a `role` (`"ADMIN" | "USER"`, default `"USER"`), added via Better Auth's `additionalFields` with `input: false` — **the frontend cannot set or change this on signup/update**, it's server/DB-only. Admin roles are assigned manually in the database.
- **Checking login state:** call Better Auth's own session endpoint (under `/api/auth/*`) or attempt any `/api/user/*` route — a `401` means logged out.
- **Which routes require login:**
  - `/api/admin/*` → `requireAdmin` (must be logged in **and** `role === "ADMIN"`)
  - `/api/user/*` → `requireLoggedIn` (any authenticated user)
  - `/api/public/*` → no guard, **except** `PATCH /api/public/sessions/:sessionId/attach-user`, which has `requireLoggedIn` applied inline just on that one route.
- **`attach-user` flow:** after a Better Auth login callback completes, the frontend calls `PATCH /api/public/sessions/:sessionId/attach-user` (no body needed — `userId` comes from the cookie). Behavior:
  - If the session has no `userId` yet → attaches the current user, returns `200`.
  - If the session's `userId` already equals the current user → no-op, returns `200` (idempotent — safe to call more than once).
  - If the session's `userId` belongs to a **different** user → `409 Conflict`, `"Session already belongs to another user"`.
- **Critical rule: never send `userId` in any request body.** Every endpoint that needs it derives it server-side from the Better Auth cookie via `auth.api.getSession(...)`. `createSessionHandler` also silently attempts this on session creation — if the visitor happens to already be logged in when they start a session, `userId` is auto-attached without needing a separate `attach-user` call.

---

## 5. The three route tiers

| Tier | Mount | Guard | Use for |
|---|---|---|---|
| `/api/admin` | [admin.ts](src/routes/admin.ts) | `requireAdmin` | Catalogue management (comics/pages/bubbles/fonts/themes/countries/pricing), CMS content management, feedback triage |
| `/api/user` | [user.ts](src/routes/user.ts) | `requireLoggedIn` | Saved addresses today; orders once built |
| `/api/public` | [public.ts](src/routes/public.ts) | none (except `attach-user`) | Public catalogue browsing, CMS read endpoints, the entire anonymous order-session/photo/generation flow, feedback submission |

Route mount order in `app.ts` is `/api/admin` → `/api/user` → `/api/public` ([app.ts:38-40](src/app.ts#L38-L40)).

---

## 6. Full API reference

All success responses now follow one standardized envelope (recently unified across every controller):
```json
{ "success": true, "data": { }, "message": "optional, only on some endpoints" }
```
Lists return the array directly under `data`. `204 No Content` deletes have no body at all. See Section 13 for the error envelope.

### Comics — ✅ Ready

| Method & Path | Tier | Purpose |
|---|---|---|
| `GET /comics` | public | List published comics (filterable) |
| `GET /comics/:comicId` | public | Public comic detail (published only) |
| `GET /comics` | admin | List all comics (any status, filterable) |
| `GET /comics/:comicId` | admin | Full admin comic detail |
| `POST /comics/thumbnail/upload-url` | admin | Get signed upload URL for a comic thumbnail |
| `POST /comics/lora/upload-url` | admin | Get signed upload URL for a LoRA file |
| `POST /comics` | admin | Create a new comic (DRAFT) |
| `PATCH /comics/:comicId` | admin | Update comic fields (partial) |
| `DELETE /comics/:comicId` | admin | Delete a comic |
| `GET /comics/:comicId/pricing` | admin | Get pricing rules for a comic |
| `PUT /comics/:comicId/pricing` | admin | Fully replace pricing rules |
| `PATCH /comics/:comicId/status` | admin | Change DRAFT/PUBLISHED/UNPUBLISHED |

**`POST /api/admin/comics`** — body (`createComicSchema`):
```json
{
  "title": "The Magic Treehouse",
  "genderTag": "UNISEX",
  "pageCount": 24,
  "freePreviewPages": 10,
  "thumbnailKey": "comics/temp/9f2b-cover.png",
  "pricing": [
    { "countryId": "550e8400-e29b-41d4-a716-446655440000", "coverType": "HARDCOVER", "price": 29.99 }
  ],
  "loraKey": "comics/lora/1721-abc.safetensors",
  "loraStrength": 1.0,
  "description": "A story about...",
  "themeId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "ageGroup": "AGE_3_5",
  "isBestseller": false
}
```
Required: `title`, `genderTag` (`BOY`|`GIRL`|`UNISEX`), `pageCount` (positive int), `freePreviewPages` (non-negative int, **must be strictly less than `pageCount`**), `thumbnailKey`, `pricing` (min 1 entry, each `countryId` uuid + `coverType` `HARDCOVER`|`SOFTCOVER` + positive `price`). Everything else optional.
Response `201`: `{ success, message: "Comic catalogue item created successfully.", data: <comic> }` — **note the returned comic does not include `pricingRules`**; fetch `GET /comics/:comicId/pricing` separately to see them.
Errors: `400` on any schema violation; `409` `"A pricing rule conflict occurred, or a comic with this parameter exists."` on unique constraint hit.

**`PATCH /api/admin/comics/:comicId`** — body (`updateComicSchema`, all optional, at least one required):
```json
{ "title": "New title", "thumbnailKey": "comics/temp/new-cover.png", "isBestseller": true }
```
Fields: `title`, `genderTag`, `pageCount`, `freePreviewPages`, `loraStrength`, `loraKey`, `thumbnailKey`, `description`, `themeId`, `ageGroup`, `isBestseller`. Sending `thumbnailKey` replaces `coverThumbnailUrl` and deletes the old thumbnail file from R2 in the background (best-effort, failure only logged). Response `200`: `{ success, data: <comic> }`, no `message`.

**`DELETE /api/admin/comics/:comicId`** → `204`. Blocked with `409` if `status === "PUBLISHED"` ("Cannot delete a published comic. Unpublish it first.") or if the comic has active order sessions (message includes the count).

**`PATCH /api/admin/comics/:comicId/status`** — body: `{ "status": "PUBLISHED" }` (`DRAFT`|`PUBLISHED`|`UNPUBLISHED`). Moving to `PUBLISHED` requires a non-null `coverThumbnailUrl` and at least one pricing rule, else `400`. Response message is dynamic: `"Comic status successfully changed to PUBLISHED."`

**`GET/PUT /api/admin/comics/:comicId/pricing`** — `PUT` body:
```json
{ "pricing": [{ "countryId": "550e8400-...", "coverType": "SOFTCOVER", "price": 19.99 }] }
```
This is a **full replace** (existing rules deleted, new ones inserted in one transaction), min 1 entry required. Response `data` is the full comic **with** `pricingRules` nested — different shape from plain create/update responses.

**`GET /comics` (public)** — query (`comicFilterQuerySchema`, all optional): `gender` (`BOY`|`GIRL`|`UNISEX`), `ageGroup`, `themeId` (uuid), `search` (string, case-insensitive contains on title). Only `PUBLISHED` comics. `data` is an array of `{ id, title, description, genderTag, ageGroup, isBestseller, pageCount, coverThumbnailUrl, theme: {id,name}, pricingRules: [{price, coverType, country: {code,name,flagUrl,currencyCode}}] }`.

**`GET /comics/:comicId` (public)** — `404` if not found or not `PUBLISHED`. Adds `freePreviewPages` and `pages` (only `isPreviewPage: true`, each `{id, pageNumber, artworkUrl}` — **no bubbles/dialogue exposed publicly**, just the empty-bubble preview artwork).

**Upload-url endpoints:** `POST /comics/thumbnail/upload-url` body `{ fileName, contentType }` (`contentType` must match `image/(png|jpeg|jpg|webp)`) → `200` `{ success, message, data: { uploadUrl, key } }`, targets the **public** bucket, key pattern `comics/temp/{uuid}-{fileName}`. `POST /comics/lora/upload-url` body `{ fileName }` only (no `contentType` needed — hardcoded to `application/octet-stream`) → `200` `{ success, data: { uploadUrl, key } }` (no message), targets the **private** bucket, key pattern `comics/lora/{timestamp}-{fileName}`, 1hr expiry.

### Countries — ✅ Ready (admin only for writes)

| Method & Path | Tier | Purpose |
|---|---|---|
| `POST /countries/upload-url` | admin | Signed upload URL for a flag image |
| `GET /countries` | admin | List all countries |
| `POST /countries` | admin | Create a country |
| `PUT /countries/:countryId` | admin | Update a country |
| `DELETE /countries/:countryId` | admin | Delete a country |

**`POST /api/admin/countries`** — body:
```json
{ "code": "IN", "name": "India", "currencyCode": "INR", "flagKey": "flags/abc-in.svg" }
```
`code` must be a real ISO 3166-1 alpha-2 code, `currencyCode` a real ISO 4217 code (both validated against full hardcoded lists — invalid codes get a `400` listing the accepted format). `flagKey` → converted to a public URL server-side. `PUT` uses the same shape but all fields optional (partial update). `409` `"A country with the code '<code>' already exists."` on duplicate. `DELETE` → `409` if any pricing rule still references the country (message includes count).
Gotcha: the flag upload-url endpoint validates its own body inline in the controller (not via the shared `validateBody` middleware like everywhere else) — functionally identical from the frontend's perspective, just an internal inconsistency.

### Pages / Bubbles / Fonts — ✅ Ready (admin only)

| Method & Path | Tier | Purpose |
|---|---|---|
| `GET /comics/:comicId/pages` | admin | List pages (with nested bubbles) |
| `POST /comics/:comicId/pages` | admin | Create a page |
| `POST /comics/:comicId/pages/upload-url` | admin | Signed upload URL for page artwork/mask |
| `PATCH /pages/:pageId` | admin | Update a page |
| `DELETE /pages/:pageId` | admin | Delete a page (cascades its bubbles) |
| `GET /pages/:pageId/bubbles` | admin | List bubbles for a page (with font info) |
| `POST /pages/:pageId/bubbles` | admin | Create a bubble |
| `PATCH /bubbles/:bubbleId` | admin | Update a bubble |
| `DELETE /bubbles/:bubbleId` | admin | Delete a bubble |
| `GET /comics/:comicId/fonts` | admin | List fonts (with bubble usage count) |
| `POST /comics/:comicId/fonts/upload-url` | admin | Signed upload URL for a font file |
| `POST /comics/:comicId/fonts` | admin | Register a font |
| `PATCH /fonts/:fontId` | admin | Update a font |
| `DELETE /fonts/:fontId` | admin | Delete a font |

**`POST /comics/:comicId/pages`** — body:
```json
{
  "pageNumber": 1,
  "artworkUrl": "comics/xyz/pages/artwork/171....png",
  "maskUrl": "comics/xyz/pages/masks/171....png",
  "hasFace": true,
  "mirrorFace": false,
  "faceDirection": "front",
  "isPreviewPage": true,
  "pagePrompt": "A child riding a dragon over a castle"
}
```
`pageNumber` (positive int, required) + `comicId`+`pageNumber` unique together → `409` `"Page number N already exists for this comic"` on conflict. `hasFace`/`mirrorFace`/`isPreviewPage` default `false`. `faceDirection` is `"front"|"three-quarter"|"side"` if set.
`PATCH /pages/:pageId` — same fields, all optional (`faceDirection`/`pagePrompt` nullable), at least one required.
`POST /comics/:comicId/pages/upload-url` — body `{ fileExtension: "png", fileType: "artwork" }` (`fileType` is `"artwork"|"masks"`) → `{ uploadUrl, key }`, **private** bucket, key `comics/{comicId}/pages/{artwork|masks}/{timestamp}.{ext}`, 15 min expiry.

**`POST /pages/:pageId/bubbles`** — body:
```json
{
  "x": 120.5, "y": 340.0, "width": 200, "height": 80,
  "dialogue": "Hi {name}, let's go!",
  "fontId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "fontSize": 28,
  "sortOrder": 0
}
```
`dialogue` supports template tokens: `{name}`, `{pronoun_subject}`, `{pronoun_object}`, `{pronoun_possessive}` — these get substituted server-side (by the not-yet-built Sharp text-render step) using the session's `childName`/`pronounKey`. `fontSize` defaults `24`, `sortOrder` defaults `0`.
`PATCH /bubbles/:bubbleId` — all fields optional, `fontId` nullable (send `null` to disconnect the font). Gotcha: if `fontId` is set to a font belonging to a **different comic** than the bubble's page, this returns `409` `"Font does not belong to the same comic as this bubble"`.

**`POST /comics/:comicId/fonts`** — body `{ "name": "ComicSans-Bold", "fontKey": "comics/xyz/fonts/171....ttf" }`. Gotcha: `fontKey` is stored **as-is** as `fileUrl` — it is **not** converted into a fetchable URL (unlike thumbnails, hero images, etc.), because fonts live in the private bucket and are only ever read server-side for text rendering. If your admin UI wants to preview the actual font file in-browser, there is currently no signed-download endpoint for it — `fileUrl` in the API response is a raw R2 key, not something you can put in a `<link rel="stylesheet">` or `FontFace` call.
`DELETE /fonts/:fontId` → `409` if any bubble still references it (message includes count).

### Themes — ✅ Ready

| Method & Path | Tier | Purpose |
|---|---|---|
| `GET /themes` | public | List all themes |
| `POST /themes` | admin | Create a theme |
| `PATCH /themes/:themeId` | admin | Rename a theme |
| `DELETE /themes/:themeId` | admin | Delete a theme |

Body for both create and update: `{ "name": "Adventure" }` — note `updateThemeSchema` requires `name` (not optional/partial) even on PATCH. `name` is globally unique → `409` `"A theme with the name \"X\" already exists"`. `DELETE` → `409` if any comics still reference the theme (message includes count). There is **no admin-only theme list** — the single `GET /themes` in the public router serves both use cases.

### Sessions (order flow) — 🚧 partially working

| Method & Path | Tier | Purpose |
|---|---|---|
| `POST /sessions` | public | Start an anonymous order session |
| `PATCH /sessions/:sessionId` | public | Add child/shipping details |
| `GET /sessions/:sessionId` | public | Get current session state + page versions |
| `PATCH /sessions/:sessionId/attach-user` | public (+ `requireLoggedIn`) | Attach logged-in user to the session |
| `POST /sessions/:sessionId/photo/upload-url` | public | Signed URL for the child's photo |
| `POST /sessions/:sessionId/photo/validate` | public | Server-side photo quality check |
| `POST /sessions/:sessionId/generate` | public | Trigger preview-page generation |
| `POST /sessions/:sessionId/pages/:pageNumber/regenerate` | public | Regenerate one page |

**`POST /api/public/sessions`** — body: `{ "comicId": "550e8400-e29b-41d4-a716-446655440000" }`. `404` `"Comic not found"` if the comic doesn't exist **or** isn't `PUBLISHED` (same message either way — you can't distinguish "wrong ID" from "not published yet" from the response). Response `201`: full `OrderSession` record — `id`, `comicId`, `userId` (auto-attached if already logged in, else `null`), `status: "CREATED"`, `wsRoomToken`, `expiresAt` (24h from now), all other fields `null`.

**`PATCH /api/public/sessions/:sessionId`** — body (all optional, at least one required):
```json
{
  "childName": "Aiden",
  "age": 5,
  "pronounKey": "HE",
  "notificationEmail": "parent@example.com",
  "coverType": "HARDCOVER",
  "shippingName": "Jane Doe",
  "shippingLine1": "123 Main St",
  "shippingLine2": "Apt 4B",
  "shippingCity": "Mumbai",
  "shippingState": "Maharashtra",
  "shippingZip": "400001",
  "shippingCountry": "IN",
  "shippingPhone": "+919876543210"
}
```
`age` 0–18, `pronounKey` `HE`|`SHE`|`THEY`, `coverType` `HARDCOVER`|`SOFTCOVER`, `shippingCountry` exactly 2 letters. Response `200`: updated session.

**`GET /api/public/sessions/:sessionId`** — `200`: the session plus `pageVersions` (ordered by `variantIndex`) and a computed `isExpired: boolean`. Use this to resync state after a WebSocket reconnect.

**`PATCH /api/public/sessions/:sessionId/attach-user`** — no body. See Section 4.

**Photo endpoints:**
`POST /sessions/:sessionId/photo/upload-url` body `{ "fileExtension": "jpg" }` (`jpg`|`jpeg`|`png`|`webp`) → `{ uploadUrl, key }`, **private** bucket, key `sessions/{sessionId}/photo-{timestamp}.{ext}`, 5 min expiry. Only allowed while `status === "CREATED"`, else `409`.
`POST /sessions/:sessionId/photo/validate` body `{ "key": "sessions/xxx/photo-171....jpg" }` → runs the (legacy, still-live) server-side Python validation pipeline. Only allowed while `status === "CREATED"`, else `409`. Response `200`: `{ success, data: { session, validation: { passed, reason } } }`. On pass: `bestPhotoUrl` set, `status` → `"PHOTO_UPLOADED"`. On fail: `rawPhotoUrls` updated but `bestPhotoUrl` stays `null`, status unchanged — retry by calling upload-url + validate again. See Section 12 for what the checks actually verify, and Section 16 for the doc/code conflict on this endpoint's existence.

**`POST /sessions/:sessionId/generate`** — no body (`sessionId` must be a valid uuid, else `400`). Requires `status` to be `CREATED` or `PHOTO_UPLOADED`, else `409`. Requires `childName`, `age`, `pronounKey`, and `bestPhotoUrl` all set, else `400` listing exactly which fields are missing. On success: `status` → `"GENERATING_PREVIEW"`, one SD-generation job enqueued per preview page (`pageNumber <= comic.freePreviewPages`). Response: `{ success, data: { status: "GENERATING_PREVIEW", jobsEnqueued: 10 } }`.
**⚠️ As of today, `sdWorker.ts` is a stub — jobs are enqueued but never processed, so no `page:ready` event will ever arrive after calling this.** Don't build against this as if it completes end-to-end yet.

**`POST /sessions/:sessionId/pages/:pageNumber/regenerate`** — no body, `pageNumber` coerced from the URL param to a positive int. Requires session to be in an active generation stage (`GENERATING_PREVIEW`/`PREVIEW_READY` = SD stage, `GENERATING_PAID`/`PAID_PAGES_READY`/`CONFIRMED` = HD stage), else `409`. `404` if the page doesn't exist for this comic. Enforces the variant cap: **3 for SD, 8 for HD** ([config/generation.ts](src/config/generation.ts)) — `409` once reached. Response: `{ success, data: { queued: true, pageNumber, variantIndex, stage: "SD" } }`.

### Saved Addresses — ✅ Ready (`/api/user`, requires login)

| Method & Path | Purpose |
|---|---|
| `GET /addresses` | List the logged-in user's saved addresses |
| `POST /addresses` | Add a new address |
| `PATCH /addresses/:id` | Update an address |
| `DELETE /addresses/:id` | Delete an address |
| `POST /addresses/:id/set-default` | Make an address the default |

**`POST /api/user/addresses`** — body:
```json
{
  "label": "Home", "name": "Jane Doe", "line1": "123 Main St", "line2": "Apt 4B",
  "city": "Mumbai", "state": "Maharashtra", "zip": "400001", "country": "IN", "phone": "+919876543210"
}
```
`label` optional, everything else required except `line2`. **The first address a user creates automatically becomes their default** (`isDefault: true`). Response `201`: `{ success, message: "Address saved successfully", data: <address> }`.
`PATCH`/`DELETE`/`set-default` all enforce ownership — `403 Forbidden` if the address belongs to a different user. Deleting the current default **promotes the most-recently-created remaining address** to default automatically. `set-default` uses `POST` (it's an action, not a field patch) and runs in a transaction (unset-all-then-set-one).

### CMS — ✅ Ready

| Feature | Public read | Admin write |
|---|---|---|
| AnnouncementBar | `GET /announcements` (active only) | full CRUD + `/reorder`, `/:id/status` |
| HeroImage | `GET /hero-images` (active only) | create, `/:id/status`, list (all), delete — **no update endpoint** |
| CustomerReview | `GET /customer-reviews` (active only) | create, `/:id/status`, list (all), delete — **no update endpoint** |
| TeamMember | `GET /team-members` (active only) | full CRUD incl. update, `/:id/status` |
| Feedback | `POST /feedbacks` (submit) | list (`?status=`), `/:id/status`, delete |

**AnnouncementBar** — create/update body `{ "message": "Free shipping this week!" }`. `reorder` body `{ "orderedIds": ["uuid1","uuid2",...] }` — every ID must already exist (`400` `"One or more announcement IDs do not exist"` otherwise) and no duplicates; reassigns `sortOrder` by array position and returns the full reordered list.

**HeroImage** — upload-url body `{ fileName, contentType }` (`image/(png|jpeg|jpg|webp)`), public bucket, key `hero-images/{uuid}-{fileName}`. Create body `{ "imageKey": "..." }`. Gotcha: deleting a hero image does **not** clean up its R2 file (unlike TeamMember/CustomerReview) — this matches the documented intent, just noting it so you don't expect the old image to disappear from storage.

**CustomerReview** — upload-url body `{ fileName, contentType }` (`video/(mp4|webm|mov|quicktime)`), public bucket, key `customer-reviews/{uuid}-{fileName}`, 30 min expiry. Create body `{ "customerName", "description", "videoKey" }`. Delete **does** clean up the R2 video file (best-effort, logged on failure).

**TeamMember** — upload-url body `{ fileName, contentType }` (image types), public bucket, key `team-members/{uuid}-{fileName}`. Create body `{ "name", "role", "description"?, "imageKey"?, "linkedinUrl"?, "instagramUrl"?, "twitterUrl"? }` (URLs validated as real URLs if present). **Update supports changing `imageKey`** — old R2 file is cleaned up automatically, same pattern as the comic thumbnail fix. Admin list is `GET /team-members`; active-only is `GET /team-members/active` (split into two distinct paths — previously these collided on the same path and the active-only handler was unreachable dead code, now fixed).

**Feedback** — public submit body `{ "name", "email", "phone", "message" }`, all required. Admin list query `?status=OPEN|VIEWED|RESOLVED|DISMISSED` (optional). Status update body `{ "status": "RESOLVED" }`. No content-edit endpoint — admins can only triage status or delete, never edit the submitted text.

### Orders — ⏳ Planned (no code yet)

No route file, controller, or validator exists for orders. Based on the `Order` model in `schema.prisma`, expect (provisional — not implemented, do not build against this yet):
- `GET /api/user/orders` — list the logged-in user's orders
- `GET /api/user/orders/:id` — order detail with tracking info
- `GET /api/admin/orders`, `GET /api/admin/orders/:id` — admin views
- `POST /api/public/sessions/:id/checkout`, `POST /api/public/sessions/:id/confirm` — payment + final variant selection

### Webhooks — ⏳ Planned (no code yet)

No route file exists. `WebhookEvent` model exists in the schema for idempotency tracking (`source`, unique `eventId`, `eventType`, `payloadJson`) but nothing consumes it yet. Expect `POST /api/webhooks/razorpay` and `POST /api/webhooks/shiprocket` eventually, each with signature verification — not live today.

---

## 7. File uploads to R2

Every upload follows the same two-step pattern: ask the backend for a signed URL, PUT the file directly to R2 from the browser, then send the resulting **key** (not the signed URL) to whichever create/update endpoint expects it.

**Worked example — comic thumbnail:**

1. `POST /api/admin/comics/thumbnail/upload-url`
   ```json
   { "fileName": "cover.png", "contentType": "image/png" }
   ```
   Response:
   ```json
   {
     "success": true,
     "message": "Presigned thumbnail upload URL generated successfully",
     "data": {
       "uploadUrl": "https://<account>.r2.cloudflarestorage.com/unilake-public/comics/temp/9f2b-cover.png?X-Amz-...",
       "key": "comics/temp/9f2b-cover.png"
     }
   }
   ```
2. Frontend does a direct `PUT` to `uploadUrl` with the raw file bytes and the **same** `Content-Type` header used in step 1 (the signed URL enforces it — a mismatched `Content-Type` on the PUT will fail).
3. `POST /api/admin/comics` (or `PATCH /api/admin/comics/:comicId`) with `{ "thumbnailKey": "comics/temp/9f2b-cover.png", ... }` — the backend converts the key into a permanent public URL and stores that.

**Two buckets:**
- **`unilake-public`** — anything meant to be directly viewable by end users without auth: comic thumbnails, hero images, customer review videos, team member photos, country flags. Backend converts the key to a plain public URL immediately (`getPublicUrl`).
- **`unilake-private`** — anything the backend needs to read later but should never be directly link-shareable: child photos, page artwork/masks, fonts, LoRA files. The backend either downloads these server-side or (not built yet for most cases) would issue a short-lived signed *download* URL — currently no endpoint hands back a signed read URL for private-bucket assets (see the fonts gotcha in Section 6).

---

## 8. WebSocket protocol

**Connection:** `ws://<host>/?sessionId=<orderSessionId>&token=<wsRoomToken>` (`wss://` in production). Both query params are required.

**Handshake (happens during the HTTP upgrade, before the socket opens):**
1. Missing `sessionId` or `token` → connection rejected with `400 Bad Request`.
2. `sessionId` doesn't match a real `OrderSession` → `404 Not Found`.
3. `token` doesn't match that session's `wsRoomToken` → `401 Unauthorized`.
4. Session's `expiresAt` has passed → `410 Gone`.
5. All checks pass → socket opens and is placed into a room keyed by `sessionId`.

**Events you will receive:**

| Event | Shape | When |
|---|---|---|
| `page:ready` | `{ "type": "page:ready", "pageNumber": 3, "variantIndex": 0, "imageUrl": "https://...", "pageVersionId": "uuid" }` | A page variant finished generating |
| `page:error` | `{ "type": "page:error", "pageNumber": 3, "variantIndex": 0, "errorMessage": "..." }` | A page variant failed to generate |

These are the **only** two event types defined ([websocket/event.ts](src/websocket/event.ts)) — there is no `session:status`, `order:paid`, etc. event today.

**Reconnection:** the server has no message replay or backlog. If the socket drops, reconnect with the exact same `sessionId` + `token` query params — nothing server-side needs to change. To resync any events you might have missed while disconnected, call `GET /api/public/sessions/:sessionId`, which returns the full current list of `pageVersions` — treat the WebSocket as a live nudge and the GET endpoint as the source of truth after any gap.

**Scaling note:** rooms are stored in an in-memory `Map` in a single Node process — this is why Cloud Run is pinned to `--max-instances 1`. Don't build any assumption of horizontal scaling into the frontend's reconnect logic; there is exactly one backend instance handling all sockets.

---

## 9. The order/generation flow end-to-end

1. **Catalogue browse (anonymous).** `GET /api/public/comics` (optionally filtered), `GET /api/public/comics/:comicId` for detail.
2. **Start a session.** `POST /api/public/sessions` with `{ comicId }` → get back `sessionId` + `wsRoomToken`. Status: `CREATED`.
3. **Open the WebSocket immediately** (not at "Generate" time) using `sessionId` + `wsRoomToken` — connect as soon as the session exists so no early events are missed.
4. **Upload the child's photo.** `POST /sessions/:id/photo/upload-url` → PUT to R2 → `POST /sessions/:id/photo/validate` with the key. On pass, status → `PHOTO_UPLOADED`. On fail, retry (upload a new photo and validate again) — status stays `CREATED`. (Frontend should also be running its own MediaPipe checks before ever reaching this step — see Section 12.)
5. **Fill in child + shipping details.** One or more `PATCH /sessions/:id` calls with `childName`, `age`, `pronounKey`, and eventually `coverType`/shipping fields. Can happen in any order relative to step 4, but all of `childName`/`age`/`pronounKey`/`bestPhotoUrl` must be set before generation.
6. **Trigger preview generation.** `POST /sessions/:id/generate` → status → `GENERATING_PREVIEW`. Expect `page:ready` (or `page:error`) events over the WebSocket for each free preview page. **⚠️ Currently these events will never arrive — the SD worker is a stub.** Build the UI for this, but don't expect it to complete in any environment right now.
7. **(Intended, once the worker is real)** All preview pages ready → status becomes `PREVIEW_READY` (this transition is not yet wired up anywhere in the code — see Section 15, "`PREVIEW_READY` status flipping mechanism — not designed").
8. **Login required before payment.** At any point before checkout, the frontend must get the user logged in (Google/Facebook/email) and call `PATCH /sessions/:id/attach-user`. Login is optional before this point, mandatory before checkout.
9. **Checkout / payment.** ⏳ Not built. Planned: `POST /sessions/:id/checkout` → `AWAITING_PAYMENT` → Razorpay → webhook confirms → `PAID`.
10. **Paid-page generation.** ⏳ Not built. Planned: `GENERATING_PAID` → `PAID_PAGES_READY` (pages 11–24).
11. **Variant confirmation.** ⏳ Not built. User picks final variants for all 24 pages → `CONFIRMED`.
12. **HD upscale + PDF compile.** ⏳ Not built. `GENERATING_HD` → `COMPILING_PDF`.
13. **Shipping.** ⏳ Not built. `DISPATCHED` (Shiprocket) → `COMPLETED`. Tracking email planned but not implemented; a PDF-ready email is meant to be automatic, revisit-link emails are meant to be sent on user request — neither exists in code yet.

---

## 10. State machines

### `OrderSessionStatus`

| Value | Fires when | Frontend UI |
|---|---|---|
| `CREATED` | Session just started | Show photo upload + detail form |
| `PHOTO_UPLOADED` | Photo passed validation | Enable "Generate preview" |
| `GENERATING_PREVIEW` | `/generate` called | Loading state, listen for `page:ready`/`page:error` (currently never fires — worker stub) |
| `PREVIEW_READY` | All preview pages done | Show preview pages, prompt login/checkout |
| `AWAITING_PAYMENT` | Checkout started (⏳ not built) | Payment UI |
| `PAID` | Payment confirmed (⏳ not built) | "Processing your book" |
| `GENERATING_PAID` | Paid-page generation started (⏳ not built) | Loading, listen for events on pages 11–24 |
| `PAID_PAGES_READY` | All 24 pages generated (⏳ not built) | Variant selection UI |
| `CONFIRMED` | User picked all variants (⏳ not built) | "Finalizing your book" |
| `GENERATING_HD` | HD upscale started (⏳ not built) | Loading |
| `COMPILING_PDF` | PDF compile started (⏳ not built) | Loading |
| `DISPATCHED` | Shipped (⏳ not built) | Tracking info |
| `COMPLETED` | Delivered (⏳ not built) | Order complete |
| `FAILED` | Any stage failed | Error state, contact support |

### `PageVersionStatus`

| Value | Meaning | UI |
|---|---|---|
| `QUEUED` | Job enqueued, not started | Spinner / "waiting in queue" |
| `GENERATING_SD` | SD generation in progress | Spinner |
| `SD_READY` | SD image ready | Show preview-quality image |
| `GENERATING_HD` | HD upscale in progress | Spinner |
| `HD_READY` | Final HD image ready | Show final image, allow selection |
| `FAILED` | Generation failed | Show retry/regenerate option |

---

## 11. Business rules the frontend must respect

- **Free preview page count is per-comic** (`Comic.freePreviewPages`) — never hardcode a number like 10; always read it from the comic record.
- **SD variant cap: 3 per page. HD variant cap: 8 per page.** Regenerate buttons should disable once the cap is hit (the backend also enforces this with a `409`).
- **Single photo per session** — there is no multi-photo upload; each new upload/validate call replaces the previous attempt.
- **Cover type is required before payment** — `coverType` (`HARDCOVER`|`SOFTCOVER`) must be set via `PATCH /sessions/:id` before checkout (once checkout exists).
- **Login is optional before checkout, mandatory before payment.** Anonymous users can browse, start a session, upload a photo, and generate previews without ever logging in.
- **Never send `userId` in any request body** — always derived from the Better Auth cookie server-side (repeated from Section 4 because it's the single most important rule).
- **Address snapshot, not a live link** — once an order exists (⏳ not built yet), its shipping address is a frozen snapshot, not a reference to a `SavedAddress`; editing a saved address later never retroactively changes a past order.
- **`notificationEmail` is independent of the account's login email** — don't assume they're the same value.

---

## 12. Photo validation

**This is the frontend's responsibility going forward** (MediaPipe.js), per the project's stated direction — but as of today, the backend endpoint (`POST /sessions/:id/photo/validate`) **still runs its own legacy Python-based validation and still gates `status → PHOTO_UPLOADED` on passing it** (see Section 16 for the full doc/code conflict). Frontend should still run its own MediaPipe checks first for fast local feedback, but must still call the real upload-url + validate endpoints as part of the flow — you cannot currently skip the backend validation call.

**What the legacy pipeline actually checks** (from `validate_photo.py`, so you know the quality bar to match on the frontend):
- Exactly one face detected (`no_face_or_multiple_faces_detected` if zero or more than one)
- Face isn't too small or cropped out of frame (`face_too_small_or_cropped`)
- Face is roughly centered in the image (`face_not_centered`)
- No sunglasses detected, via a brightness/uniformity heuristic over the eye region (`possible_sunglasses_detected`)
- A basic expression check (`expression_check_failed`) — exact criteria live in `check_expression()`, not fully broken down here

Target: match or exceed this bar in the frontend's own MediaPipe checks before ever letting a photo reach the upload step, since the backend will still reject anything that fails these same checks.

---

## 13. Error handling contract

Every error response (thrown from anywhere, caught by the global `errorHandler` middleware) has this exact shape:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed - childName: Required, age: Expected number, received string"
  }
}
```

| HTTP status | `error.code` | Fires when |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Zod schema failure, or a hand-written business-rule check (e.g. missing required session fields before generate) |
| `401` | `UNAUTHORIZED` | Not logged in on a route that requires it |
| `403` | `FORBIDDEN` | Logged in, but wrong role (non-admin hitting `/api/admin/*`) or wrong owner (someone else's saved address/session) |
| `404` | `NOT_FOUND` | Resource doesn't exist |
| `409` | `CONFLICT` | Business-rule conflict — duplicate unique field, cascade-guard (delete blocked by references), status-mismatch (e.g. generate called in wrong session state), variant cap reached |
| `500` | `INTERNAL_SERVER_ERROR` | Unhandled server error. Message is sanitized to a generic string in production; full message shown in local dev |

**How to distinguish programmatically:** always check `error.code`, not just the HTTP status — `409` in particular covers several very different situations (duplicate name vs. reference-guard vs. session-state mismatch), and the `message` string is the only place the specific reason is described (there's no separate machine-readable sub-code per 409 case).

---

## 14. CORS + cookies

- Allowed origin: **`http://localhost:3000` only**, currently ([app.ts:26](src/app.ts#L26)) — must be updated with your real dev/staging/prod URLs before this works anywhere else.
- `credentials: true` is set on both the CORS config and (implicitly, via cookie flags) Better Auth — send `credentials: "include"` on every `fetch`/`axios` call so the session cookie is attached.
- `methods` includes `PATCH` explicitly (this was previously missing and caused real bugs — confirmed present now).
- Cookie flags: `sameSite: "none"`, `secure: true`, `httpOnly: true` — the frontend JS can never read the session cookie directly (by design); always go through Better Auth's own session-check endpoint to know if you're logged in.

---

## 15. Open questions / not-yet-decided

- **`PREVIEW_READY` status-flipping mechanism is not designed** — nothing currently transitions a session from `GENERATING_PREVIEW` to `PREVIEW_READY` once all preview pages finish; this needs backend work before the preview stage can be considered complete.
- **SD/HD workers are stubs** — the entire generation pipeline is enqueue-only right now (see Section 2/9).
- **Checkout, payment, HD upscale, PDF compile, shipping, order endpoints** are all unbuilt — treat everything past `PREVIEW_READY` as a future milestone, not something to build the UI against yet beyond static mockups.
- **Email provider not chosen** — no transactional email (PDF-ready, revisit-link) is implemented.
- **Razorpay order-ID reuse vs. regeneration on payment retry** — undecided.
- **Shiprocket country-name format vs. ISO codes, and international customs declaration format** — undecided; don't assume `shippingCountry` (currently ISO alpha-2) will map cleanly to whatever Shiprocket needs.
- **No signed-download endpoint exists for private-bucket assets** (fonts, raw photos) — if the frontend ever needs to preview a private asset directly, that endpoint doesn't exist today.
- **`validateQuery` middleware doesn't exist** — query-param validation is handled ad hoc per-controller (some wrap in try/catch, some don't); don't expect uniform query-validation error messages across every list endpoint.

---

## 16. Doc/code mismatches found

1. **Photo validation location.** `PROJECT_CONTEXT.md`/`DECISIONS.md` state photo validation was "moved to frontend MediaPipe.js" and explicitly say to never suggest backend Python validation. In reality, `POST /sessions/:id/photo/validate` is a live, wired-up endpoint that still runs the full legacy Python pipeline (`photoValidation.service.ts` → `validate_photo.py` via `child_process.execFile`) and the session's `status`/`bestPhotoUrl` still depend on it passing. The frontend cannot currently skip this call — the stated architectural decision and the actual live behavior disagree. Flagging so this can be reconciled (either the docs are aspirational/not-yet-executed, or the endpoint needs to be simplified to trust-the-frontend and stop running Python).
2. **`getOrderSessionId` pageVersions ordering bug**, noted in `CURRENT_STATE.md`'s "VERIFY / LOOSE ENDS" as orderBy-ing by a non-existent `pageNumber` field on `PageVersion` (would crash) — **this is already fixed in the current code** ([session.service.ts:76-93](src/services/session.service.ts#L76-L93)), it orders by `variantIndex` only. The doc is stale on this point.
3. **`page.service.ts` single-quote template literal bug**, also noted in `CURRENT_STATE.md` as a key-interpolation bug in `getPageArtworkUploadUrl` — **also already fixed**; the current code uses proper backtick template literals throughout. Doc is stale here too.
4. **Missing `POST /comics/:comicId/pages` route**, noted as unverified in `CURRENT_STATE.md` — **confirmed present and working** in `admin.ts`.
5. **CORS `PATCH` addition**, noted as "confirm deployed" in `CURRENT_STATE.md` — confirmed present in the current `app.ts` methods array; whether it's actually deployed to Cloud Run is outside what the code can confirm, so that half of the open item still stands.
