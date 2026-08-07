# Unilake — Comic Integration Guide (Frontend)

**Scope:** everything needed to build (a) the **admin comic upload wizard**, (b) the **country & theme management screens** it depends on, and (c) the **user-facing comic browse and detail pages**.

**Out of scope for this milestone:** photo upload, AI generation, checkout, payment, orders. Those endpoints exist in various states but you are not wiring them yet.

**Status:** all previously-reported blockers are resolved. Nothing is preventing you from starting.

**Last verified against code:** July 29, 2026. Every endpoint, request body, response shape, and validation rule below was read directly out of the route / controller / service / validator files. Where the code and older docs disagreed, the code won.

---

# TABLE OF CONTENTS

| Part | Contents |
|---|---|
| **0** | Read this first — mental model, upload pattern, auth, response envelope |
| **1** | **How to build this** — stack, API layer, wizard architecture, bubble mapper |
| **2** | Prerequisites — Countries & Themes (full endpoint reference) |
| **3** | The comic upload wizard — 6 steps, full endpoint reference |
| **4** | Managing an existing comic — including thumbnail add / delete / reorder |
| **5** | User-facing pages |
| **6** | Complete endpoint index |
| **7** | Path-shape gotchas |
| **8** | Enum & numeric bounds reference |
| **9** | ⚠️ Cautions & catches — read before writing code |
| **10** | Do not build these |
| **11** | Known limitations (accepted by design) |
| **12** | Suggested build order |

---

# PART 0 — READ THIS FIRST

## 0.1 The mental model: what "uploading a comic" actually means

A comic is **not** one form submit. It is a tree of record types created in a strict order, because each level needs the ID of the level above it:

```
Country  (global — created once, reused by every comic)
Theme    (global — created once, reused by every comic)
   │
   └── Comic ────────────────── created in ONE call, together with its pricing rules
        │
        ├── Font ────────────── per comic. The typefaces used in this comic's bubbles
        │
        └── Page ───────────── one per physical page of the book (e.g. 24 of them)
             │
             └── Bubble ─────── one per speech bubble. A rectangle + dialogue template
```

So the wizard is: **create countries & themes → create the comic shell → attach fonts → attach pages → map bubbles onto pages → publish.**

## 0.2 The file-upload pattern — learn this once, use it everywhere

**No file is ever POSTed to our backend.** Files go straight from the browser to Cloudflare R2. Our backend only issues a temporary signed URL, and later records where the file ended up.

Every upload in this system follows this exact three-step dance:

```
STEP 1  →  POST <backend>/.../upload-url
           Send: filename + type
           Receive: { uploadUrl, key }

STEP 2  →  PUT <uploadUrl>                    ← direct to Cloudflare, NOT our backend
           Body: the raw File object
           Header: Content-Type must EXACTLY match what you declared in step 1
           NO auth header. NO cookies. Do NOT use your configured axios instance —
           its default headers and credentials will break the signature.

STEP 3  →  POST/PATCH <backend>/...
           Send the `key` string from step 1 inside the record you're creating.
           Backend converts it to a permanent URL and stores that.
```

**The `key` is the contract.** It's an opaque string like `comics/temp/9f2c1a44-...-cover.png`. You never build it, never modify it, never guess it. You receive it in step 1 and hand it back in step 3.

Write this helper once and reuse it everywhere:

```ts
async function uploadToR2(uploadUrl: string, file: File, contentType: string) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
    // deliberately NO credentials, NO Authorization header
  });
  if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);
}
```

**Signed URL lifetimes** — request the URL immediately before uploading, never when the wizard step first renders:

| Asset | Expiry |
|---|---|
| Comic thumbnails | 15 minutes |
| Country flags | 15 minutes |
| Page artwork & masks | 15 minutes |
| Fonts | **10 minutes** |

## 0.3 Which assets you can display

| Asset | Bucket | Stored in DB as | Usable in `<img>` / `@font-face`? |
|---|---|---|---|
| Comic thumbnails | public | full URL | ✅ Yes |
| Country flags | public | full URL | ✅ Yes |
| **Page artwork** | **public** | **full URL** | ✅ **Yes** |
| **Page masks** | **public** | **full URL** | ✅ **Yes** |
| Fonts (.ttf/.otf) | private | R2 key | ❌ **No** — see §11.1 |

Everything except fonts comes back as a complete `https://...` URL you can use directly.

## 0.4 Authentication — including how to actually log in

Auth is handled by **Better Auth**, mounted at `ALL /api/auth/*` on the backend. These endpoints are **not** in the `/api/admin` or `/api/public` trees and are not listed in Part 6 — they're Better Auth's own surface.

### Use the Better Auth client, not hand-rolled requests

```bash
npm install better-auth
```

```ts
// lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,   // same origin as the API, e.g. http://localhost:8080
});

export const { signIn, signOut, useSession } = authClient;
```

It handles cookie storage, session refresh, and the social-login redirect dance for you. Hand-rolling these calls is possible but there's no upside.

### What's enabled

| Method | How |
|---|---|
| **Email + password** | `authClient.signIn.email({ email, password })` |
| **Google** | `authClient.signIn.social({ provider: "google" })` |
| **Facebook** | `authClient.signIn.social({ provider: "facebook" })` |

The underlying endpoints, if you need them: `POST /api/auth/sign-in/email`, `POST /api/auth/sign-up/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session`.

### 🔴 The admin-role gotcha

**Signing up does not make someone an admin.** The `role` field is configured with `input: false` — it **cannot** be set through any signup or profile endpoint, by design. New accounts are always `USER`.

An admin is promoted **manually in the database** by backend. So:

1. The account must be created first (sign-up, or Google/Facebook login)
2. Backend flips `role` to `ADMIN` on that row
3. The user signs out and back in

**There is one admin account today:** `devs@pantharinfohub.com`. Ask backend if you need another.

A logged-in non-admin hitting any `/api/admin/*` route gets **`403 FORBIDDEN`**, not 401 — the session is valid, the role isn't. Handle those two differently: 401 → send to login; 403 → "you don't have admin access", signing in again won't help.

### Wiring rules

- **Cookie only.** There is no bearer token and no API key. Don't build an auth header.
- **Every** request to our backend needs `credentials: "include"` (fetch) or `withCredentials: true` (axios). Forget this and every admin call returns 401 — see §1.2.
- `/api/public/*` requires no auth at all.

**Smoke test your auth wiring before building anything else:**
```
GET /api/admin/status
→ { "success": true, "message": "Admin router is active and guarded.", "adminEmail": "..." }
```
If this 401s your cookie isn't reaching the server. If it 403s you're logged in as a non-admin.

### CORS and origins

Currently allowed from **`http://localhost:3000` only**, with `credentials: true`. Developing on any other port fails at the browser, before the request is even sent.

This origin is configured in **two** places on the backend — the CORS middleware and Better Auth's `trustedOrigins`. When you have a real deploy URL, tell backend so they update both; updating only one produces a confusing half-working state where API calls succeed but login doesn't.

## 0.5 The response envelope — every response, no exceptions

**Success (2xx):**
```json
{
  "success": true,
  "message": "optional — not always present",
  "data": { }
}
```
The real payload is **always** under `data`. Write one response interceptor that unwraps `.data.data` and never think about it again.

**Error (4xx / 5xx):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "human-readable, safe to show in a toast"
  }
}
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad body, missing field, out-of-range value, or a business rule violation |
| 401 | `UNAUTHORIZED` | No session cookie |
| 403 | `FORBIDDEN` | Logged in but not an ADMIN |
| 404 | `NOT_FOUND` | The referenced ID doesn't exist |
| 409 | `CONFLICT` | Duplicate, **or** a delete blocked by a dependency |
| 500 | `INTERNAL_SERVER_ERROR` | Bug. Message is masked in production |

**All DELETE endpoints return `204 No Content` with an empty body.** Do not attempt to parse JSON from a successful delete — you will throw.

## 0.6 Two validation-error message formats

Most endpoints validate in middleware and produce a **path-prefixed** message:
```
"Validation failed - title: Title cannot be empty, pricing: You must provide at least one pricing rule."
```

A handful validate inside the controller and produce a **bare joined** message with no field paths:
```
"Invalid content type. Only PNG, JPEG, and WEBP images are allowed for thumbnails."
```

Endpoints in the second group: **batch thumbnail upload-url**, **country flag upload-url**, **country create**, **country update**, and the two **public comic** endpoints (query validation).

**Practical advice:** don't parse these strings to map errors back to form fields. Do your own client-side validation using the rules documented throughout this guide, and use the server message as a fallback toast.

---

# PART 1 — HOW TO BUILD THIS

This part is about *approach*. Parts 2–5 are the endpoint reference. Read this one first — it will save you rewriting things.

## 1.1 Recommended stack

You don't have to use these, but the rest of this guide assumes them, and each is chosen for a specific reason in *this* project.

| Concern | Recommendation | Why for this project |
|---|---|---|
| **Server state** | **TanStack Query** (React Query) | Non-negotiable in spirit. The wizard constantly re-reads the comic tree after mutations. Hand-rolling `useState` + `useEffect` here means stale thumbnails, stale page lists, and manual refetch calls scattered everywhere. See §1.3 |
| **Forms** | **react-hook-form + zod** | Every endpoint has strict validation. Mirroring the backend's rules in a client-side zod schema catches errors before a round trip and gives you typed form values for free |
| **Bubble mapper** | **react-konva** | The one screen with genuinely hard UI. See §1.5 |
| **File uploads** | **plain `fetch`** — never your configured client | Your API client adds cookies and headers that break the R2 signature. See §1.2 |
| **Routing** | any — but **`comicId` must live in the URL** | Makes the wizard resumable for free. See §1.4 |
| **HTTP client** | axios or fetch, your call | Either works. Axios interceptors make §1.2 slightly tidier |

**Do not reach for:** a canvas framework heavier than Konva, a form library without validation integration, or global state (Redux / Zustand) for server data — TanStack Query already *is* your server-state store.

## 1.2 Build the API layer first — before any UI

This is step one for a reason. Every screen depends on it, and three things must be right from the start.

**a) One client, cookies always on, response unwrapped:**

```ts
// api/client.ts
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,   // e.g. http://localhost:8080
  withCredentials: true,                    // ← without this, every admin call 401s
});

// unwrap { success, data } → data
api.interceptors.response.use(
  (res) => res.data.data,
  (err) => {
    const e = err.response?.data?.error;
    return Promise.reject({
      code: e?.code ?? "NETWORK_ERROR",
      message: e?.message ?? "Something went wrong. Please try again.",
      status: err.response?.status,
    });
  }
);
```

Now every call site gets the payload directly and every failure is the same shape. Show `error.message` in a toast; branch on `error.code` when you need specific handling (e.g. `CONFLICT` on a blocked delete).

**b) 🔴 The R2 upload must NOT go through this client.**

The presigned URL's signature covers the exact headers sent. Your interceptor adds cookies and possibly `Authorization`, `X-Requested-With`, or a `baseURL` prefix — any of which produces a **403 with an opaque XML body** from Cloudflare that looks nothing like an auth problem.

Use the bare `uploadToR2` from §0.2. Keep it in a **separate file** so nobody later "helpfully" refactors it to use the shared client.

**c) One typed module per resource:**

```
api/
  client.ts
  comics.ts      ← listComics, getComic, createComic, updateComic, deleteComic,
                   getComicPricing, updateComicPricing, updateComicStatus,
                   getThumbnailUploadUrls, setThumbnails
  countries.ts
  themes.ts
  pages.ts
  bubbles.ts
  fonts.ts
  upload.ts      ← uploadToR2, deliberately isolated
  types.ts       ← Comic, Page, Bubble, Font, Country, Theme, PricingRule
```

Type the responses from the samples in Parts 2–5. It's about an hour of work and it turns every field-name mistake into a compile error instead of a runtime `undefined`.

## 1.3 Server state: what to invalidate after every mutation

This is where wizards usually go wrong. After each mutation, invalidate the queries below or the UI shows stale data.

**Query key structure:**
```ts
["comics"]                          // list
["comic", comicId]                  // full tree
["comic", comicId, "pages"]         // pages + bubbles
["comic", comicId, "fonts"]
["comic", comicId, "pricing"]
["countries"]
["themes"]
```

**Invalidation map:**

| After this mutation | Invalidate |
|---|---|
| Create / update / delete country | `["countries"]` |
| Create / update / delete theme | `["themes"]`, plus `["comics"]` if a comic's theme changed |
| Create comic | `["comics"]` |
| Update comic (incl. thumbnails) | `["comics"]`, `["comic", id]` |
| Update pricing | `["comic", id]`, `["comic", id, "pricing"]`, `["comics"]` |
| Publish / unpublish | `["comics"]`, `["comic", id]` |
| Create / update / delete page | `["comic", id, "pages"]`, `["comic", id]`, **`["comics"]`** |
| Create / update / delete bubble | `["comic", id, "pages"]` |
| Create / update / delete font | `["comic", id, "fonts"]`, plus `["comic", id, "pages"]` if a bubble's font changed |
| Delete comic | `["comics"]`, remove `["comic", id]` |

⚠️ **The easy one to miss:** creating or deleting a page changes `_count.pages` on the **comic list**, which drives your "24 of 24 pages" completeness badge. Invalidate `["comics"]` too, or the badge lies.

**On optimistic updates:** use them for the bubble mapper drag (§1.5), where latency is visible and failure is rare. Everywhere else prefer a plain refetch — the endpoints are fast, and correctness beats perceived speed on a form that creates real records.

## 1.4 Wizard architecture

### Put `comicId` in the URL

```
/admin/comics/new                              ← steps 1–2 only (no comic exists yet)
/admin/comics/:comicId/fonts                   ← step 3
/admin/comics/:comicId/pages                   ← step 4
/admin/comics/:comicId/pages/:pageId/bubbles   ← step 5
/admin/comics/:comicId/review                  ← step 6
```

**Why this matters more than it looks:** the comic is a **real DRAFT record in the database** from the moment step 2 succeeds. It is not client-side draft state. If the admin closes the tab at step 4, the comic still exists with its thumbnails and pricing — they just need a way back to it. A `comicId` in the URL gives you that for free, and `GET /api/admin/comics/:comicId` (§4.5) rehydrates the entire tree in one request.

Without this you get support tickets reading *"I uploaded a comic and it vanished"*, when it's actually sitting in the list as a DRAFT.

### The step boundary

```
STEP 1 + 2   →  one screen, one submit. Nothing persisted until it succeeds.
─────────────── comicId now exists; everything below saves independently ───────
STEP 3       →  fonts    — each font saved on its own
STEP 4       →  pages    — each page saved on its own
STEP 5       →  bubbles  — each bubble saved on its own
STEP 6       →  publish  — a status flip
```

Steps 1–2 are the only place with an all-or-nothing submit. From step 3 onward **every action writes immediately**. Don't build a "Save all" button at the end — there is nothing to save, it's already persisted.

### Step gating

Let the admin move freely between steps 3–6 rather than forcing linear progression — they *will* want to add a font after starting bubbles. Gate only on real dependencies:

| Step | Requires |
|---|---|
| 3, 4 | `comicId` exists |
| 5 (bubbles) | at least one page exists |
| 6 (publish) | the §9.1 checklist passes |

### Form state vs server state

| Data | Lives in |
|---|---|
| The step 1–2 form before submit | react-hook-form |
| Selected files before upload | component state (`File[]`) |
| Everything after `comicId` exists | TanStack Query |
| Bubble positions during a drag | component state, flushed to the server debounced |

Do not copy server data into form state and then try to keep them in sync. Read from the query, mutate through the API, let invalidation refresh it.

### Resuming

On mount of any `/:comicId/*` route, fetch `["comic", comicId]`. That single response tells you everything: which thumbnails exist, how many pages, which pages have artwork, which fonts are uploaded, whether pricing is set. **Derive step completion from it** rather than storing wizard progress anywhere.

## 1.5 The bubble mapper — recommended implementation

The hardest screen in the panel. Budget 2–3× your first estimate.

### Use `react-konva`

```bash
npm install konva react-konva use-image
```

| Option | Verdict |
|---|---|
| **react-konva** | ✅ **Recommended.** Built-in `Transformer` gives resize handles for free. Zoom/pan is a single `scale` prop on the Stage. Hit-testing handled |
| DOM + `react-rnd` / `react-moveable` | Workable for drag/resize, but zoom and pan get fiddly — you fight CSS transforms and hit-testing at the same time |
| Fabric.js | Capable, but imperative and awkward inside React's lifecycle |
| Raw `<canvas>` | You'd reimplement selection, handles, and hit-testing. Don't |

**Zoom is the deciding factor.** Artwork is ~2048px wide displayed at ~900px. Placing a bubble precisely over a small speech balloon is genuinely hard at 44% scale, and admins do this ~24 times per comic. Konva makes zoom/pan trivial; DOM-based approaches don't.

### Component structure

```
<Stage width={W} height={H} scaleX={zoom} scaleY={zoom} draggable>
  <Layer>
    <KonvaImage image={artwork} />            {/* from useImage(page.artworkUrl) */}
    {bubbles.map(b => (
      <Rect                                    {/* denormalized to stage pixels */}
        x={b.x * artworkDisplayWidth}
        y={b.y * artworkDisplayHeight}
        width={b.width * artworkDisplayWidth}
        height={b.height * artworkDisplayHeight}
        stroke="#00A3FF" strokeWidth={2}
        draggable
        onDragEnd={...} onTransformEnd={...}
      />
    ))}
    <Transformer ref={trRef} />                {/* attach to the selected Rect */}
  </Layer>
</Stage>
```

`page.artworkUrl` is a plain public URL, so `useImage(page.artworkUrl)` just works — no auth, no signed URL, no CORS setup needed for display.

### 🔴 The single most important rule: normalize only at the API boundary

**Work in pixels everywhere inside the component. Convert to fractions only when you send, and from fractions only when you load.**

```ts
// api/bubbles.ts — the ONLY place these conversions exist
const toApi = (r: PixelRect, w: number, h: number) => ({
  x: r.x / w,          y: r.y / h,
  width: r.width / w,  height: r.height / h,
});

const fromApi = (b: Bubble, w: number, h: number) => ({
  x: b.x * w,          y: b.y * h,
  width: b.width * w,  height: b.height * h,
});
```

If fractions leak into your drag handlers you will lose an afternoon to bugs where a rectangle jumps on the second drag. Keep the conversion at the edge.

### Clamp before sending

The server rejects out-of-bounds bubbles (§3 STEP 5). Constrain during the drag instead of letting the request bounce:

```ts
const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max);

x = clamp(x, 0, 1 - width);
y = clamp(y, 0, 1 - height);
```

Konva's `dragBoundFunc` and the Transformer's `boundBoxFunc` are the right hooks.

### Debounce the save

A drag fires continuously. Update local state every frame; PATCH the bubble **300–500 ms after the drag settles**. Konva's `onDragEnd` / `onTransformEnd` are natural triggers — they fire once, so debouncing on top is belt-and-braces for rapid successive drags.

### `fontSize` in the mapper

`fontSize` is a fraction of artwork **height** (§3 STEP 5). To render preview text at the right size:

```ts
const displayPx = bubble.fontSize * artworkDisplayHeight;
```

Give the admin a **pixel-equivalent input**, not the raw fraction — nobody thinks in `0.02`:

```ts
// show px, store the fraction
const shownPx    = Math.round(bubble.fontSize * page.artworkHeight);
const onChangePx = (px: number) => save({ fontSize: px / page.artworkHeight });
```

Note this uses `page.artworkHeight` — the **real** artwork height from the API, not the displayed height — so the number the admin sees matches the printed result.

### What the mapper cannot do

Fonts live in a private bucket, so you **cannot** `@font-face` the real typeface (§11.1). Preview text renders in a fallback face. To partly compensate, show a character count against the bubble width so the admin has some signal about overflow.

## 1.6 Upload UX patterns

| Situation | Do this |
|---|---|
| **Thumbnails** (1–10 files) | One `upload-urls` call for all of them, then `Promise.all` the PUTs. Parallel is safe here |
| **Fonts** | 🔴 **Strictly sequential.** Await each fully before starting the next — see §9.8 |
| **Page artwork + mask** | Both PUTs for a single page can run in parallel. Across pages, prefer sequential or small batches so one failure doesn't obscure the others |
| **Progress** | `fetch` gives no upload progress. If you need a progress bar, use `XMLHttpRequest` for the PUT, or show an indeterminate spinner |
| **Expiry** | URLs last 10–15 min. If a PUT fails with a signature error, request a **fresh** upload URL and retry — don't retry the stale one |
| **Failure mid-batch** | Track which files succeeded. Only re-request URLs for the failures. A file uploaded to R2 but never referenced in a create call is harmless — it just sits there |

---

# PART 2 — PREREQUISITES: COUNTRIES & THEMES

`POST /api/admin/comics` **requires at least one pricing rule**, and every pricing rule needs a real `countryId`. So **countries must exist before any comic can be created.** Themes are optional but you'll want them for the dropdown and the catalogue filter.

> ⚠️ **The database currently has zero countries and zero themes.** Build these two screens first, or the comic wizard cannot be completed even once.

---

## 2.1 COUNTRIES

A country carries a name, an ISO code, a currency, and a flag image. It exists to drive per-country pricing.

### `GET /api/admin/countries`

Lists every country. Use it for the country management screen **and** to build the pricing matrix in the comic wizard.

**Request:** no body, no query parameters.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "b1e6c3d2-...-uuid",
      "code": "IN",
      "name": "India",
      "currencyCode": "INR",
      "flagUrl": "https://pub-xxxx.r2.dev/flags/9f2c1a44-...-india.png",
      "isActive": true
    }
  ]
}
```

Sorted by `name` ascending.

⚠️ **This model has no `createdAt` / `updatedAt`** — unlike every other model in the system. Don't build a "date added" column.

⚠️ **`isActive` is read-only.** It defaults to `true` and no endpoint field can change it. Display it if you like, but don't build a toggle — it won't do anything.

---

### `POST /api/admin/countries/upload-url`

Step 1 of the flag upload.

**Request body:**
```json
{
  "fileName": "india-flag.png",
  "contentType": "image/png"
}
```

| Field | Required | Rules |
|---|---|---|
| `fileName` | ✅ | string, min 1. Sanitized server-side — every non-alphanumeric character becomes `_` |
| `contentType` | ✅ | must match `^image/(png\|jpeg\|jpg\|svg\+xml\|webp)$` |

Note this one **accepts SVG**, unlike comic thumbnails.

**Response `200`:**
```json
{
  "success": true,
  "message": "Presigned upload URL generated successfully",
  "data": {
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/unilake-public/flags/...?X-Amz-Signature=...",
    "key": "flags/9f2c1a44-3b2e-4d1f-8a7c-1e2f3a4b5c6d-india-flag.png"
  }
}
```

Bucket: **public**. Expiry: **15 minutes**.

**Then:** `PUT` the file to `uploadUrl` with `Content-Type: image/png`.

**Errors:**
- `400` — `"Invalid content type. Only PNG, JPEG, SVG, and WEBP images are allowed."`
- `400` — `"file name is requried"` *(typo is in the backend, not this doc)*

---

### `POST /api/admin/countries`

**Request body:**
```json
{
  "code": "IN",
  "name": "India",
  "currencyCode": "INR",
  "flagKey": "flags/9f2c1a44-...-india-flag.png"
}
```

| Field | Required | Rules |
|---|---|---|
| `code` | ✅ | **Must be a real ISO 3166-1 alpha-2 code**, validated against a hardcoded 249-entry list. Uppercase. e.g. `IN`, `US`, `GB` |
| `name` | ✅ | string, 1–100 characters |
| `currencyCode` | ✅ | **Must be a real ISO 4217 code**, validated against a hardcoded list. e.g. `INR`, `USD`, `EUR` |
| `flagKey` | ✅ | the `key` from the upload-url call — **not** a URL |

The backend converts `flagKey` into a full public URL and stores it as `flagUrl`.

⚠️ **`code` and `currencyCode` are strict allow-lists.** `UK` is not a valid country code (it's `GB`). Build both as searchable dropdowns from a client-side ISO list rather than free-text inputs — otherwise admins guess wrong and get opaque 400s.

**Response `201`:**
```json
{
  "success": true,
  "message": "Country record created successfully.",
  "data": {
    "id": "b1e6c3d2-...-uuid",
    "code": "IN",
    "name": "India",
    "currencyCode": "INR",
    "flagUrl": "https://pub-xxxx.r2.dev/flags/9f2c1a44-...-india-flag.png",
    "isActive": true
  }
}
```

**Errors:**
- `409` — `"A country with the code 'IN' already exists."`
- `400` — `"Invalid country code. Must be a real ISO 3166-1 alpha-2 code (e.g., US, IN, GB)."`
- `400` — `"Invalid currency code. Must be a real ISO 4217 code (e.g., USD, INR, EUR)."`

---

### `PUT /api/admin/countries/:countryId`

⚠️ **This is a `PUT`, not a `PATCH`** — the only update endpoint in the API that uses PUT. But the body is **partial**: send only what changed.

**Request body:** any subset of `{ code, name, currencyCode, flagKey }`. Same validation rules as create.

```json
{ "name": "Republic of India" }
```

Sending `{}` → `400 "No valid fields provided for update."`

Supplying a new `flagKey` replaces the flag URL.

**Response `200`:**
```json
{
  "success": true,
  "message": "Country record updated successfully.",
  "data": { /* full country row */ }
}
```

**Errors:**
- `404` — `"The requested country record does not exist."`
- `409` — `"A country with this code already exists."`

⚠️ **Replacing a flag does not delete the old file from R2.** Harmless — just an orphaned object.

---

### `DELETE /api/admin/countries/:countryId`

**Response `204`**, empty body.

**`409 CONFLICT`** if any pricing rule references it:
```
"Cannot delete country \"India\" — 12 pricing rule(s) reference it. Remove the pricing rules first."
```

Show this message verbatim — it carries the count the admin needs. The list response has no pricing-rule count, so you can't pre-emptively disable the button; handle the 409 gracefully instead.

---

## 2.2 THEMES

A theme is just a unique name (e.g. "Space Adventure"). Comics optionally link to one, and the public catalogue can filter by it.

### `GET /api/public/themes`

⚠️ **The theme list lives on the PUBLIC router.** There is no `GET /api/admin/themes`. Use this one inside the admin panel too — it needs no auth and returns everything.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "d3a8f1e0-...-uuid",
      "name": "Space Adventure",
      "createdAt": "2026-07-01T10:22:11.000Z",
      "updatedAt": "2026-07-01T10:22:11.000Z"
    }
  ]
}
```

Sorted by `name` ascending.

---

### `POST /api/admin/themes`

**Request body:**
```json
{ "name": "Space Adventure" }
```

| Field | Required | Rules |
|---|---|---|
| `name` | ✅ | string, trimmed, min 1 character, **globally unique** |

**Response `201`:** the created theme row.

**`409`** — `"A theme with the name \"Space Adventure\" already exists"`

---

### `PATCH /api/admin/themes/:themeId`

**Request body:**
```json
{ "name": "Deep Space Adventure" }
```

⚠️ **`name` is required, not optional.** Despite being a PATCH, this is not a partial update — the schema demands `name`. Sending `{}` returns a 400.

**Response `200`:** the updated theme row.

**Errors:** `404` if not found, `409` on a duplicate name.

---

### `DELETE /api/admin/themes/:themeId`

**Response `204`.**

**`409 CONFLICT`** if any comic is linked:
```
"Cannot delete theme \"Space Adventure\" — it still has 3 comic(s) linked to it. Unlink them first."
```

⚠️ **"Unlink them first" is misleading.** A comic's theme **cannot be removed** once set — only switched to a different theme (§11.2). In practice the admin must reassign every linked comic to some other theme. Word your error UI accordingly, or they'll hunt for a "clear theme" button that doesn't exist.

---

# PART 3 — THE COMIC UPLOAD WIZARD

Six steps, in this order:

```
 STEP 1   Upload thumbnails             → get keys
 STEP 2   Create the comic (+ pricing)  → get comicId   ⚑ unlocks everything below
 STEP 3   Upload fonts                  → get fontIds
 STEP 4   Per page: upload artwork + mask, create page → get pageIds
 STEP 5   Per page: draw + create bubbles (needs fontIds + pageIds)
 STEP 6   Publish
```

> **Persist `comicId` the instant step 2 succeeds** — see §1.4. The comic is a real DRAFT record from that moment on.

---

## STEP 1 — Thumbnails

A comic has **1 to 10** thumbnails. **The first element of the array is the primary** — it appears on catalogue cards. The full array appears on the product detail page. Order is meaningful, so give the admin drag-to-reorder.

Managing thumbnails *after* creation — adding, deleting, reordering — is covered in **§4.1.1**.

### `POST /api/admin/comics/thumbnails/upload-urls`

One call for all thumbnails. There is **no single-file variant** — for one file, send an array of one.

**Request body:**
```json
{
  "files": [
    { "fileName": "cover-front.png", "contentType": "image/png" },
    { "fileName": "cover-back.jpg",  "contentType": "image/jpeg" }
  ]
}
```

| Field | Required | Rules |
|---|---|---|
| `files` | ✅ | array, **min 1, max 10** |
| `files[].fileName` | ✅ | string, min 1 |
| `files[].contentType` | ✅ | must match `^image/(png\|jpeg\|jpg\|webp)$` — **no SVG** here |

**Response `200`:**
```json
{
  "success": true,
  "message": "Presigned thumbnail upload URLs generated successfully",
  "data": {
    "uploads": [
      { "uploadUrl": "https://...signed...", "key": "comics/temp/9f2c...-cover-front.png" },
      { "uploadUrl": "https://...signed...", "key": "comics/temp/a71d...-cover-back.jpg" }
    ]
  }
}
```

⚠️ **Note the nesting:** `response.data.uploads`, not `response.data`.

**`uploads[i]` corresponds to `files[i]` by index** — the backend uses `Promise.all` over your array and preserves order. Zip them back together by index.

**Then**, for each file: `PUT uploads[i].uploadUrl` with `Content-Type: files[i].contentType`.

**Then** collect the keys in display order:
```ts
const thumbnailKeys = uploads.map(u => u.key);  // [0] becomes the primary
```

**Errors:**
- 11+ files → `400 "Maximum 10 thumbnails per request"`
- 0 files → `400 "At least one file is required"`
- `image/gif` → `400 "Invalid content type. Only PNG, JPEG, and WEBP images are allowed for thumbnails."`

---

## STEP 2 — Create the comic

This single call creates the comic **and all its pricing rules** inside one database transaction. All-or-nothing.

### `POST /api/admin/comics`

**Request body:**
```json
{
  "title": "Captain Aarav and the Lost Star",
  "genderTag": "BOY",
  "pageCount": 24,
  "freePreviewPages": 10,
  "thumbnailKeys": [
    "comics/temp/9f2c...-cover-front.png",
    "comics/temp/a71d...-cover-back.jpg"
  ],
  "pricing": [
    { "countryId": "b1e6...-uuid", "coverType": "HARDCOVER", "price": 1499 },
    { "countryId": "b1e6...-uuid", "coverType": "SOFTCOVER", "price": 999 },
    { "countryId": "c2f7...-uuid", "coverType": "HARDCOVER", "price": 29.99 },
    { "countryId": "c2f7...-uuid", "coverType": "SOFTCOVER", "price": 19.99 }
  ],
  "description": "A brave young astronaut sets out to find a fallen star.",
  "themeId": "d3a8...-uuid",
  "ageGroup": "AGE_6_8",
  "isBestseller": false
}
```

**Required fields:**

| Field | Type | Rules |
|---|---|---|
| `title` | string | 1–255 characters |
| `genderTag` | enum | exactly `BOY` \| `GIRL` \| `UNISEX` |
| `pageCount` | number | integer, **> 0** |
| `freePreviewPages` | number | integer, **≥ 0**, and **strictly less than `pageCount`** |
| `thumbnailKeys` | string[] | **min 1, max 10**, each non-empty. Order preserved, `[0]` is primary |
| `pricing` | object[] | **min 1** |
| `pricing[].countryId` | string | valid UUID of an **existing** country |
| `pricing[].coverType` | enum | `HARDCOVER` \| `SOFTCOVER` |
| `pricing[].price` | number | **> 0**. Send a plain number, never a string |

**Optional fields:**

| Field | Type | Rules |
|---|---|---|
| `description` | string | min 1 if present |
| `themeId` | string | valid UUID of an existing theme |
| `ageGroup` | enum | `AGE_0_2` \| `AGE_3_5` \| `AGE_6_8` \| `AGE_9_12` |
| `isBestseller` | boolean | defaults `false` |
| `loraKey`, `loraStrength` | — | ⛔ **DO NOT USE. DO NOT BUILD UI.** See §10.1 |

**Enforce client-side:** `freePreviewPages < pageCount`. The server rejects with
`"Free preview pages must be strictly less than the total page count."`, but catching it in the form is far better UX.

**Pricing UX:** the natural interface is a grid — countries down the side, HARDCOVER / SOFTCOVER across the top, one price input per cell. Flatten that grid into the `pricing` array on submit.

⚠️ The database has a unique constraint on `[comicId, countryId, coverType]`. **Never emit two entries for the same country + coverType pair** — you'll get a 409 and the whole transaction rolls back.

**Response `201`:**
```json
{
  "success": true,
  "message": "Comic catalogue item created successfully.",
  "data": {
    "id": "e4b9a7c1-...-uuid",
    "title": "Captain Aarav and the Lost Star",
    "genderTag": "BOY",
    "pageCount": 24,
    "freePreviewPages": 10,
    "coverThumbnailUrls": [
      "https://pub-xxxx.r2.dev/comics/temp/9f2c...-cover-front.png",
      "https://pub-xxxx.r2.dev/comics/temp/a71d...-cover-back.jpg"
    ],
    "loraFileUrl": null,
    "loraStrength": 1,
    "status": "DRAFT",
    "publishJobId": null,
    "publishError": null,
    "isBestseller": false,
    "description": "A brave young astronaut sets out to find a fallen star.",
    "themeId": "d3a8...-uuid",
    "ageGroup": "AGE_6_8",
    "createdAt": "2026-07-28T09:12:33.120Z",
    "updatedAt": "2026-07-28T09:12:33.120Z"
  }
}
```

⚠️ **You sent `thumbnailKeys`, you get back `coverThumbnailUrls`** — full public URLs, directly usable in `<img>`.

⚠️ **The created pricing rules are NOT in the response.** Call `GET /api/admin/comics/:comicId/pricing` (§4.2) if you need to display them back.

⚠️ Status is always `DRAFT` on creation. You cannot create a published comic.

**➡️ Save `data.id` as `comicId`. Everything below needs it.**

**Errors:**
- `400` — any validation failure above
- `409` — `"A pricing rule conflict occurred, or a comic with this parameter exists."` (duplicate country + coverType)
- ⚠️ A **well-formed but non-existent** `countryId` surfaces as a **500**, not a clean 404 — foreign-key violations aren't specially handled. Always source `countryId` from `GET /api/admin/countries`; never let an admin type one.

---

## STEP 3 — Fonts

Fonts are **scoped to a single comic**. A font uploaded for comic A cannot be used by a bubble in comic B — deliberate and permanent. If two comics use the same typeface, upload it twice.

Do this **before** bubbles, because bubble creation takes a `fontId`.

### `POST /api/admin/comics/:comicId/fonts/upload-url`

**Request body:**
```json
{
  "fileName": "ComicSans-Bold",
  "fileExtension": "ttf"
}
```

| Field | Required | Rules |
|---|---|---|
| `fileName` | ✅ | string, min 1. ⚠️ **Required but unused** — the generated key is timestamp-based and ignores it. Send it anyway |
| `fileExtension` | ✅ | enum, exactly `ttf` \| `otf` \| `woff` \| `woff2` |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...signed...",
    "key": "comics/e4b9a7c1-...-uuid/fonts/1753689153000.ttf"
  }
}
```

Bucket: **private**. Expiry: **10 minutes** — the shortest in the system, don't stall.

**Content-Type for the PUT:** `ttf → font/ttf`, `otf → font/otf`, `woff → font/woff`, `woff2 → font/woff2`.

🔴 **CAUTION — font keys have no random component.** The key is `comics/<id>/fonts/<Date.now()>.<ext>`. Two upload-url requests landing in the same millisecond produce **the same key**, and the second upload silently overwrites the first. **Upload fonts strictly sequentially — never `Promise.all` them.** (Page artwork does not have this problem; its keys include a UUID.)

**`404`** if `comicId` doesn't exist.

---

### `POST /api/admin/comics/:comicId/fonts`

**Request body:**
```json
{
  "name": "ComicSans-Bold",
  "fontKey": "comics/e4b9a7c1-.../fonts/1753689153000.ttf"
}
```

| Field | Required | Rules |
|---|---|---|
| `name` | ✅ | string, min 1. The display name shown in the bubble font dropdown |
| `fontKey` | ✅ | string, min 1. The `key` from the upload-url call |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "f5c0b2a9-...-uuid",
    "comicId": "e4b9a7c1-...-uuid",
    "name": "ComicSans-Bold",
    "fileUrl": "comics/e4b9a7c1-.../fonts/1753689153000.ttf",
    "createdAt": "2026-07-28T09:20:00.000Z"
  }
}
```

⚠️ **`fileUrl` is a private R2 key despite the name** — you cannot `@font-face` it. Font selection is by **name only**. See §11.1.

**➡️ Save `data.id` as `fontId` per font.**

---

### `GET /api/admin/comics/:comicId/fonts`

Populates the font dropdown in the bubble mapper, and drives the font-management screen.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "f5c0b2a9-...-uuid",
      "comicId": "e4b9a7c1-...-uuid",
      "name": "ComicSans-Bold",
      "fileUrl": "comics/e4b9a7c1-.../fonts/1753689153000.ttf",
      "createdAt": "2026-07-28T09:20:00.000Z",
      "_count": { "bubbles": 47 }
    }
  ]
}
```

Sorted by `createdAt` ascending. `_count.bubbles` tells you how many bubbles use this font — display it, and use it to disable the delete button.

🔴 **This endpoint is the ONLY legitimate source for the bubble font picker.** See §9.4.

---

### `PATCH /api/admin/fonts/:fontId`

⚠️ Path is `/api/admin/fonts/:fontId` — **not** nested under the comic.

**Request body:** at least one of:
```json
{ "name": "ComicSans-Regular", "fontKey": "comics/.../fonts/1753699999000.ttf" }
```

Empty body `{}` → `400 "At least one field must be provided"`.

To replace the file: upload-url → PUT → PATCH with the new `fontKey`. ⚠️ The old file is not deleted from R2.

**Response `200`:** the updated font row (without `_count`).

---

### `DELETE /api/admin/fonts/:fontId`

**Response `204`.**

**`409`** if bubbles reference it:
```
"Cannot delete font \"ComicSans-Bold\" — 47 bubble(s) reference it. Unassign the font from those bubbles first."
```

---

## STEP 4 — Pages

One record per physical page of the book. Each page has up to two image assets:

- **`artworkUrl`** — the base illustration with **empty** speech bubbles
- **`maskUrl`** — a PNG marking the head region where the child's face is composited. Only meaningful when `hasFace: true`

Both are **optional at create time** — you can create the page row first and PATCH the assets in later.

### 4a. `POST /api/admin/comics/:comicId/pages/upload-url`

Call this **twice per page** — once for artwork, once for the mask.

**Request body:**
```json
{
  "fileExtension": "png",
  "fileType": "artwork"
}
```

| Field | Required | Rules |
|---|---|---|
| `fileExtension` | ✅ | enum, exactly `jpg` \| `jpeg` \| `png` \| `webp` |
| `fileType` | ✅ | enum, exactly `artwork` \| `masks` — ⚠️ note the **plural** on `masks`. `"mask"` is rejected |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...signed...",
    "key": "comics/e4b9a7c1-.../pages/artwork/9f2c1a44-3b2e-4d1f-8a7c-1e2f3a4b5c6d-1753689200000.png"
  }
}
```

Bucket: **public**. Expiry: **15 minutes**.

**Content-Type for the PUT:** `jpg → image/jpeg`, `jpeg → image/jpeg`, `png → image/png`, `webp → image/webp`.
⚠️ `jpg` maps to `image/jpeg`. There is no such MIME type as `image/jpg`.

**`404`** if `comicId` doesn't exist.

---

### 4b. `POST /api/admin/comics/:comicId/pages`

**Request body:**
```json
{
  "pageNumber": 1,
  "artworkUrl": "comics/e4b9a7c1-.../pages/artwork/9f2c...-1753689200000.png",
  "maskUrl": "comics/e4b9a7c1-.../pages/masks/a71d...-1753689201000.png",
  "hasFace": true,
  "mirrorFace": false,
  "faceDirection": "front",
  "isPreviewPage": true,
  "pagePrompt": "A boy in a spacesuit floating near a glowing star",
  "steps": 3,
  "cfg": 1.0
}
```

| Field | Required | Type | Rules / meaning |
|---|---|---|---|
| `pageNumber` | ✅ | number | integer, **> 0**. **Unique within the comic**. **Immutable after creation** |
| `artworkUrl` | ❌ | string | The **key** from upload-url with `fileType: "artwork"` |
| `maskUrl` | ❌ | string | The **key** from upload-url with `fileType: "masks"` |
| `hasFace` | ❌ | boolean | defaults `false`. Does the child's face appear on this page? |
| `mirrorFace` | ❌ | boolean | defaults `false`. Should the face be horizontally flipped? |
| `faceDirection` | ❌ | string | enum `front` \| `three-quarter` \| `side`. ⚠️ **lowercase, hyphenated** |
| `isPreviewPage` | ❌ | boolean | defaults `false`. **This is what the public detail endpoint filters on** |
| `pagePrompt` | ❌ | string | min 1. Per-page AI generation prompt |
| `steps` | ❌ | number | integer, **1–8**. Omit → default **3** |
| `cfg` | ❌ | number | float, **1.0–3.0**. Omit → default **1.0** |

⚠️ **The field names say `Url` but you send the `key`.** A legacy naming quirk. Send the key; the backend stores the resolved public URL.

**On `steps` and `cfg`:** AI tuning knobs. Put them behind an "Advanced" collapsible with defaults pre-filled and a note that changing them affects output quality. Most admins should never touch them.

🔴 **The mask must be exactly the same pixel dimensions as the artwork.** The backend probes both with Sharp and rejects a mismatch:
```
400 "Mask dimensions (1024x768) must match artwork dimensions (2048x1536)."
```
ComfyUI overlays the two pixel-for-pixel, so a mismatch puts the face in the wrong place on every printed copy. See §9.2.

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "a9d2e5f8-...-uuid",
    "comicId": "e4b9a7c1-...-uuid",
    "pageNumber": 1,
    "artworkUrl": "https://pub-xxxx.r2.dev/comics/e4b9a7c1-.../pages/artwork/9f2c...-1753689200000.png",
    "maskUrl": "https://pub-xxxx.r2.dev/comics/e4b9a7c1-.../pages/masks/a71d...-1753689201000.png",
    "artworkWidth": 2048,
    "artworkHeight": 1536,
    "hasFace": true,
    "mirrorFace": false,
    "faceDirection": "front",
    "isPreviewPage": true,
    "pagePrompt": "A boy in a spacesuit floating near a glowing star",
    "steps": 3,
    "cfg": 1,
    "createdAt": "2026-07-28T09:25:00.000Z",
    "updatedAt": "2026-07-28T09:25:00.000Z",
    "warnings": []
  }
}
```

✅ **`artworkUrl` and `maskUrl` come back as full public URLs** — display them directly.

✅ **`artworkWidth` / `artworkHeight`** are measured server-side with Sharp. Read-only; you cannot set them. Use them to reserve layout space, to show the admin what they uploaded, and to convert `fontSize` to pixels (§1.5).

✅ **`warnings`** is an array of human-readable strings. Empty on create. Can be populated on update (§3 STEP 4d). Always render it when non-empty.

**➡️ Save `data.id` as `pageId`. Bubbles attach to this.**

**`409`** on duplicate: `"Page number 1 already exists for this comic"`.

---

### 4c. `GET /api/admin/comics/:comicId/pages`

The workhorse for the page-management screen and for resuming an interrupted wizard. Returns pages **with bubbles nested**, and each bubble's font info.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "a9d2e5f8-...-uuid",
      "comicId": "e4b9a7c1-...-uuid",
      "pageNumber": 1,
      "artworkUrl": "https://pub-xxxx.r2.dev/comics/.../artwork/9f2c...png",
      "maskUrl": "https://pub-xxxx.r2.dev/comics/.../masks/a71d...png",
      "artworkWidth": 2048,
      "artworkHeight": 1536,
      "hasFace": true,
      "mirrorFace": false,
      "faceDirection": "front",
      "isPreviewPage": true,
      "pagePrompt": "A boy in a spacesuit...",
      "steps": 3,
      "cfg": 1,
      "createdAt": "...",
      "updatedAt": "...",
      "bubbles": [
        {
          "id": "c7e1d4b6-...-uuid",
          "pageId": "a9d2e5f8-...-uuid",
          "x": 0.3418,
          "y": 0.2994,
          "width": 0.2734,
          "height": 0.1172,
          "dialogue": "Look, {name}! A shooting star!",
          "fontId": "f5c0b2a9-...-uuid",
          "fontSize": 0.02,
          "sortOrder": 0,
          "createdAt": "...",
          "updatedAt": "...",
          "font": { "id": "f5c0b2a9-...-uuid", "name": "ComicSans-Bold" }
        }
      ]
    }
  ]
}
```

Pages sorted by `pageNumber` ascending; bubbles by `sortOrder` ascending.

---

### 4d. `PATCH /api/admin/pages/:pageId`

⚠️ Path is `/api/admin/pages/:pageId` — **not** nested under the comic.

**Request body:** any subset. At least one field required — `{}` → `400 "At least one field must be provided"`.

| Field | Type | Note |
|---|---|---|
| `hasFace` | boolean | |
| `mirrorFace` | boolean | |
| `faceDirection` | string \| **null** | nullable — send `null` to clear |
| `isPreviewPage` | boolean | |
| `pagePrompt` | string \| **null** | nullable — send `null` to clear |
| `artworkUrl` | string | the new **key**. Replaces the artwork |
| `maskUrl` | string | the new **key**. Replaces the mask |
| `steps` | number | int, 1–8 |
| `cfg` | number | float, 1.0–3.0 |

⚠️ **`pageNumber` cannot be changed.** Not in the update schema. To renumber, delete and recreate — which destroys the page's bubbles. **Do not build page reordering.** See §10.3.

**Response `200`:** the full updated page row, including refreshed `artworkWidth`/`artworkHeight` and a `warnings` array.

🔴 **Replacing artwork can trigger a warning or a rejection:**

**Warning** (does not block) — new artwork has a **different aspect ratio**:
```json
{
  "success": true,
  "data": {
    "...page fields...": "",
    "warnings": [
      "Artwork aspect ratio changed from 2048x1536 to 2048x2048. Re-check bubble positions on this page."
    ]
  }
}
```
A same-aspect resolution change (2048×1536 → 4096×3072) produces **no warning** — bubble coordinates are normalized and stay correct.

**Rejection** (blocks the save) — resulting artwork and mask no longer match:
```
400 "Mask dimensions (2048x1536) must match artwork dimensions (4096x3072)."
```
⚠️ **This fires even if you only sent `artworkUrl`.** The backend re-validates the page's *existing* mask against the *new* artwork. **When changing artwork on a page that has a mask, send both keys in the same PATCH.**

⚠️ Replacing artwork or mask **does** delete the old file from R2 (unlike fonts and flags).

---

### 4e. `DELETE /api/admin/pages/:pageId`

**Response `204`.**

⚠️ **Cascade-deletes every bubble on the page**, and deletes its artwork and mask from R2. No confirmation, no 409 guard. Put a hard confirm dialog in front of it naming the bubble count.

---

## STEP 5 — Bubbles (the bubble mapper)

The most involved screen. **Read §1.5 for the recommended implementation** — this section is the API contract.

### 🔴 The coordinate system

**All bubble geometry is stored as normalized fractions between 0 and 1**, relative to the artwork's dimensions. **Not pixels.**

- `x: 0.35` means "35% of the way across the artwork"
- `width: 0.27` means "27% of the artwork's width"
- `x`/`y` is the **top-left corner**. Origin is the top-left of the image

**Why:** the artwork is a large HD image displayed shrunk-down in the browser. Storing on-screen pixels would break the moment the display size changed. Fractions are correct at any resolution, and stay correct even if the artwork is later re-uploaded larger.

**Converting when you send:**
```ts
const payload = {
  x:      rect.x      / img.clientWidth,
  y:      rect.y      / img.clientHeight,
  width:  rect.width  / img.clientWidth,
  height: rect.height / img.clientHeight,
};
```

**Converting when you render:**
```ts
const box = {
  left:   bubble.x      * img.clientWidth,
  top:    bubble.y      * img.clientHeight,
  width:  bubble.width  * img.clientWidth,
  height: bubble.height * img.clientHeight,
};
```

✅ **You never need `naturalWidth`/`naturalHeight`.** Use the displayed size. That's the whole point of the fractional model.

**Server-enforced constraints** — violations return a 400:
- `0 ≤ x ≤ 1` and `0 ≤ y ≤ 1`
- `0 < width ≤ 1` and `0 < height ≤ 1`
- `x + width ≤ 1` → else `"Bubble extends past the right edge of the artwork"`
- `y + height ≤ 1` → else `"Bubble extends past the bottom edge of the artwork"`

A tiny floating-point tolerance is applied, so a rectangle dragged flush to the edge is accepted. **Clamp on the client anyway** — see §1.5.

### 🔴 `fontSize` is also a fraction

```
fontSize: 0.02
```

A fraction of the artwork's **HEIGHT**, not a pixel value.
Rendered size = `fontSize × artworkHeight`. So `0.02` on a 1536px-tall page ≈ 31px.

| | Value |
|---|---|
| Minimum | `0.005` |
| Maximum | `0.25` |
| Default | `0.02` |
| Type | float — **integers outside the range are rejected** |

⚠️ **Sending `24` returns a 400.** The most commonly missed change — the field looks unrelated to the coordinate work. §1.5 shows how to give the admin a pixel input that converts on submit.

### The dialogue token system

`dialogue` is a **template**, not final text. These tokens are substituted per child at generation time:

| Token | Replaced with |
|---|---|
| `{name}` | The child's first name |
| `{pronoun_subject}` | he / she / they |
| `{pronoun_object}` | him / her / them |
| `{pronoun_possessive}` | his / her / their |

Example: `"Look, {name}! {pronoun_subject} found it!"`

**UX guidance:**
- Give an insert-token toolbar rather than making admins type braces
- Render a live preview with sample values ("Aarav", he/him) so they can check line length against the rectangle
- ⚠️ **Token names are not validated by the backend.** A typo like `{Name}` or `{pronoun}` is accepted and renders **literally** in the printed book. Build a client-side lint flagging any `{...}` not in the table above

---

### `POST /api/admin/pages/:pageId/bubbles`

**Request body:**
```json
{
  "x": 0.3418,
  "y": 0.2994,
  "width": 0.2734,
  "height": 0.1172,
  "dialogue": "Look, {name}! A shooting star!",
  "fontId": "f5c0b2a9-...-uuid",
  "fontSize": 0.02,
  "sortOrder": 0
}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `x` | ✅ | number | `0`–`1` |
| `y` | ✅ | number | `0`–`1` |
| `width` | ✅ | number | `> 0`, `≤ 1`, and `x + width ≤ 1` |
| `height` | ✅ | number | `> 0`, `≤ 1`, and `y + height ≤ 1` |
| `dialogue` | ✅ | string | min 1 character |
| `fontId` | ❌ | string | valid UUID. **Omit entirely if none — do NOT send `null`** |
| `fontSize` | ❌ | number | `0.005`–`0.25`. Defaults to **`0.02`** |
| `sortOrder` | ❌ | number | integer. Defaults to `0` |

⚠️ **`fontId: null` returns a 400 on create.** The create schema is `.optional()` without `.nullable()`. (The *update* schema does accept `null`.) Omit the key entirely.

⚠️ **`fontId` is NOT checked for comic ownership on create.** See §9.4.

**`sortOrder` guidance:** assign sequentially (`0, 1, 2, …`) as bubbles are added. It doesn't affect visual position — that's what x/y are for — but gives stable ordering in lists.

**Response `201`:** the created bubble row.
⚠️ The create response does **not** include the nested `font` object. List and update responses do.

**`404`** if `pageId` doesn't exist.

---

### `GET /api/admin/pages/:pageId/bubbles`

**Response `200`:** array of bubbles sorted by `sortOrder` ascending, each with `font: { id, name } | null`.

Often unnecessary — `GET /api/admin/comics/:comicId/pages` already nests bubbles. Use this when working on a single page and wanting a lighter payload.

---

### `PATCH /api/admin/bubbles/:bubbleId`

⚠️ Path is `/api/admin/bubbles/:bubbleId` — top-level.

**Request body:** any subset. At least one field required.

| Field | Type | Rules |
|---|---|---|
| `x`, `y` | number | `0`–`1` |
| `width`, `height` | number | `> 0`, `≤ 1` |
| `dialogue` | string | min 1 |
| `fontId` | string \| **null** | valid UUID, **or `null` to unassign** |
| `fontSize` | number | `0.005`–`0.25` |
| `sortOrder` | number | integer, **`≥ 0`** (create allows negative; update does not) |

🔴 **Bounds are re-checked against the merged result.** If you send only `x`, the server combines it with the stored `width` and rejects if the total overflows:
```
400 "Bubble extends past the right edge of the artwork"
```
So a partial drag update **can** be rejected even though the value you sent looks fine alone.

✅ **Cross-comic font IS enforced here** (unlike create):
- Font belongs to another comic → `409 "Font does not belong to the same comic as this bubble"`
- Font doesn't exist → `404 "Font not found"`

**Response `200`:** the updated bubble **with nested `font: { id, name } | null`**.

**Debounce this endpoint** (~300–500 ms) — see §1.5.

---

### `DELETE /api/admin/bubbles/:bubbleId`

**Response `204`.** No guards, deletes immediately.

---

## STEP 6 — Publish

### `PATCH /api/admin/comics/:comicId/status`

**Request body:**
```json
{ "status": "PUBLISHED" }
```
`status` must be exactly `DRAFT` | `PUBLISHED` | `UNPUBLISHED`.

**Publish is a synchronous database flip.** It returns immediately. There is **no background job, no progress bar, no polling, no websocket event.** A button with a brief spinner is exactly right.

**Server-side gates when publishing — there are only two:**
1. `coverThumbnailUrls.length > 0` → else `400 "Cannot publish comic: at least one cover thumbnail is required."`
2. `pricingRules.length > 0` → else `400 "Cannot publish comic: At least one pricing rule is required."`

🔴 **That is the entire gate.** It does **not** check that pages exist, that artwork was uploaded, that bubbles were mapped, or that page count matches. **The pre-publish checklist is permanently your responsibility** — see §9.1. This is a deliberate product decision, not a gap backend will close later.

Switching to `DRAFT` or `UNPUBLISHED` has no gates.

**Response `200`:**
```json
{
  "success": true,
  "message": "Comic status successfully changed to PUBLISHED.",
  "data": { /* full comic row, status now PUBLISHED */ }
}
```

⚠️ The database enum also contains `PUBLISHING`, a leftover from a removed async flow. Nothing sets it, but include a defensive branch in any exhaustive `switch` so an unexpected value doesn't blank the UI.

---

# PART 4 — MANAGING AN EXISTING COMIC

## 4.1 `PATCH /api/admin/comics/:comicId`

The unified endpoint for every plain comic field. **Not** for pricing (§4.3) and **not** for status (§3 STEP 6).

**Request body:** any subset. At least one field — `{}` → `400 "At least one field must be provided to update"`.

| Field | Type | Rules |
|---|---|---|
| `title` | string | min 1 |
| `genderTag` | enum | BOY / GIRL / UNISEX |
| `pageCount` | number | int, > 0 |
| `freePreviewPages` | number | int, **> 0** ⚠️ |
| `thumbnailKeys` | string[] | min 1, max 10 — **see §4.1.1** |
| `description` | string | min 1 |
| `themeId` | string | valid UUID |
| `ageGroup` | enum | AGE_0_2 / AGE_3_5 / AGE_6_8 / AGE_9_12 |
| `isBestseller` | boolean | |
| `loraKey`, `loraStrength` | — | ⛔ do not use |

🔴 **Two inconsistencies with create — enforce both client-side:**
1. On **create**, `freePreviewPages` allows `0`. On **update** it must be **> 0**. A comic created with `0` cannot be updated back to `0`.
2. On **update**, the `freePreviewPages < pageCount` rule is **NOT enforced**. You can PATCH `freePreviewPages: 50` onto a 24-page comic and it succeeds. **Validate this in your edit form.**

⚠️ **`themeId` cannot be unset** — only switched to a different theme. See §11.2.

**Response `200`:** the updated comic row. No `message` field on this one.

---

## 4.1.1 🖼️ Managing thumbnails — delete, add, reorder, set primary

**All four operations use the same endpoint and the same idea:** send the **full array you want to end up with**. The backend replaces the stored array and deletes from R2 anything that disappeared.

There is no separate add endpoint, no delete endpoint, and no reorder endpoint. You always describe the desired end state.

### ✅ The array accepts BOTH full URLs and fresh keys

This is what makes it easy. Each entry can be either:

- a **full URL** exactly as it came back from `GET` → means *"keep this one"*
- a **fresh key** from `thumbnails/upload-urls` → means *"add this one"*

You can mix them freely in a single call.

**You do not need to know `R2_PUBLIC_URL_BASE`. You do not need to convert URLs back into keys.** Send back the strings you were given.

### The four operations

Given a comic with:
```js
comic.coverThumbnailUrls = [urlA, urlB, urlC]   // urlA is the primary
```

---

**🗑️ Delete a single thumbnail** — filter it out, send the rest:

```ts
const remaining = comic.coverThumbnailUrls.filter(u => u !== urlToDelete);
await setThumbnails(comicId, remaining);
```

Result: the array becomes `[urlA, urlC]`, and **`urlB`'s file is permanently deleted from R2**.

---

**➕ Add thumbnails** — upload first, then append the new keys:

```ts
// 1. get upload URLs for the new files
const { uploads } = await getThumbnailUploadUrls([
  { fileName: "extra.png", contentType: "image/png" }
]);

// 2. PUT each file to R2
await uploadToR2(uploads[0].uploadUrl, file, "image/png");

// 3. send existing URLs + the new key
await setThumbnails(comicId, [...comic.coverThumbnailUrls, uploads[0].key]);
```

---

**🔀 Reorder** — same entries, different order:

```ts
await setThumbnails(comicId, [urlC, urlA, urlB]);   // urlC is now primary
```

Nothing is deleted — the set is unchanged, only the order.

---

**⭐ Set a different primary** — move it to index 0. It's just a reorder:

```ts
const setPrimary = (urls: string[], target: string) =>
  [target, ...urls.filter(u => u !== target)];

await setThumbnails(comicId, setPrimary(comic.coverThumbnailUrls, urlB));
```

---

**🔁 Delete and add in one call** — perfectly fine:

```ts
await setThumbnails(comicId, [urlA, urlC, newKey]);   // urlB deleted, newKey added
```

### 🔴 The rule that protects you

**Minimum 1.** You cannot delete the last remaining thumbnail:
```
400 "A comic must have at least one thumbnail — you cannot remove the last one"
```

**➡️ Disable the ✕ button when only one thumbnail remains**, with a tooltip such as *"A comic must have at least one thumbnail. Upload a replacement first."* Don't let the admin click into an error.

### 🔴 The rule that will bite you

**Omission means deletion.** If you send only the new key and forget the existing URLs, **every existing thumbnail is permanently deleted from R2.** There is no undo.

```ts
// ❌ CATASTROPHIC — deletes urlA, urlB and urlC
await updateComic(comicId, { thumbnailKeys: [newKey] });

// ✅ CORRECT
await updateComic(comicId, {
  thumbnailKeys: [...comic.coverThumbnailUrls, newKey]
});
```

**Route every thumbnail operation through one helper** so this rule is enforced in a single place rather than at four call sites:

```ts
// api/comics.ts
// Always takes the COMPLETE desired list.
// Deleting = omitting. Adding = appending. Reordering = reordering.
export async function setThumbnails(comicId: string, desired: string[]) {
  if (desired.length === 0) {
    throw new Error("A comic must keep at least one thumbnail");
  }
  if (desired.length > 10) {
    throw new Error("Maximum 10 thumbnails per comic");
  }
  return updateComic(comicId, { thumbnailKeys: desired });
}
```

### UX notes

- **Deleting index 0 promotes index 1 to primary**, which changes what appears on catalogue cards. Show the primary badge clearly and warn when a delete will move it — or make "set as primary" an explicit action so it's never a surprise side-effect.
- **Confirm deletions.** The file is removed from R2 immediately and cannot be recovered; the admin must re-upload.
- **Invalidate `["comic", id]` and `["comics"]`** after any thumbnail change — the list's cover image comes from `coverThumbnailUrls[0]`.

---

## 4.2 `GET /api/admin/comics/:comicId/pricing`

**Response `200`:**
```json
{
  "success": true,
  "message": "Pricing rules fetched successfully.",
  "data": [
    {
      "id": "p1a2b3c4-...-uuid",
      "comicId": "e4b9a7c1-...-uuid",
      "countryId": "b1e6c3d2-...-uuid",
      "coverType": "HARDCOVER",
      "price": "1499.00",
      "createdAt": "...",
      "updatedAt": "...",
      "country": {
        "id": "b1e6c3d2-...-uuid",
        "name": "India",
        "code": "IN",
        "currencyCode": "INR",
        "flagUrl": "https://pub-xxxx.r2.dev/flags/..."
      }
    }
  ]
}
```

Sorted by country name ascending.

🔴 **`price` comes back as a STRING, but must be SENT as a number.** It's a Postgres `DECIMAL(10,2)`, serialized as a string to avoid float precision loss.
- Reading: `"1499.00"` — `parseFloat()` before arithmetic, or format as-is for display
- Writing: send `1499`. Sending `"1499"` → `400`

Handle this asymmetry in one place in your API layer. See §9.5.

---

## 4.3 `PUT /api/admin/comics/:comicId/pricing`

**Full replacement.** In one transaction the backend deletes **every** existing pricing rule for the comic and inserts exactly what you send.

**Request body:**
```json
{
  "pricing": [
    { "countryId": "b1e6...-uuid", "coverType": "HARDCOVER", "price": 1599 },
    { "countryId": "b1e6...-uuid", "coverType": "SOFTCOVER", "price": 1099 }
  ]
}
```
Same field rules as create. `pricing` min 1.

⚠️ **Anything you omit is deleted.** Always GET the current rules, edit the whole grid in local state, then PUT the complete set. Same "full desired state" model as thumbnails.

**Response `200`:**
```json
{
  "success": true,
  "message": "Pricing rules fully replaced.",
  "data": { "...comic fields...": "", "pricingRules": [ /* raw rules, NO nested country */ ] }
}
```
The nested `pricingRules` here omit the `country` object — re-fetch with the GET if you need country names.

---

## 4.4 `GET /api/admin/comics`

The admin comic list. Returns **all comics regardless of status**.

**Query parameters** — all optional:

| Param | Rules |
|---|---|
| `gender` | `BOY` \| `GIRL` \| `UNISEX` |
| `ageGroup` | `AGE_0_2` \| `AGE_3_5` \| `AGE_6_8` \| `AGE_9_12` |
| `themeId` | valid UUID |
| `search` | case-insensitive **substring** match on `title` |

Example: `GET /api/admin/comics?gender=BOY&ageGroup=AGE_6_8&search=star`

⚠️ **Never send empty-string params.** `?themeId=` → `400 "Invalid theme ID"`. Strip empty values before building the query string. (`search=""` is safe — treated as absent — but the others are not.) See §9.6.

⚠️ **No pagination.** Every comic in one array. Paginate client-side.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "...all comic scalar fields...": "",
      "theme": { "id": "d3a8...-uuid", "name": "Space Adventure" },
      "_count": { "pages": 24, "orderSessions": 0, "pricingRules": 4 }
    }
  ]
}
```
Sorted by `createdAt` **descending**.

**`_count` is your friend.** Show a warning chip when `_count.pages !== pageCount`, and disable delete when `_count.orderSessions > 0`.

---

## 4.5 `GET /api/admin/comics/:comicId`

**The single most useful endpoint in the admin panel.** Returns the entire comic tree in one call. Use it to hydrate the edit screen and to resume a half-finished wizard (§1.4).

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "...all comic scalar fields...": "",
    "theme": { "id": "...", "name": "Space Adventure" },
    "pages": [
      {
        "...all page fields including artworkWidth/artworkHeight...": "",
        "bubbles": [ { "...all bubble fields..." } ]
      }
    ],
    "fonts": [
      { "id": "...", "comicId": "...", "name": "ComicSans-Bold", "fileUrl": "comics/.../fonts/....ttf", "createdAt": "..." }
    ],
    "pricingRules": [
      { "...rule fields...": "", "country": { "id": "...", "code": "IN", "name": "India", "currencyCode": "INR", "flagUrl": "https://..." } }
    ],
    "_count": { "orderSessions": 0 }
  }
}
```

Ordering: `pages` by `pageNumber` asc; each page's `bubbles` by `sortOrder` asc; `pricingRules` by country name asc.

⚠️ Unlike `GET /pages`, the bubbles nested here do **NOT** include the `font` object — only the raw `fontId`. Join against the top-level `fonts` array yourself; it's in the same response.

**`404`** if not found.

---

## 4.6 `DELETE /api/admin/comics/:comicId`

**Response `204`.**

**Two hard guards:**
1. `409` if `status === "PUBLISHED"` → `"Cannot delete a published comic. Unpublish it first."`
2. `409` if non-terminal order sessions exist → `"Cannot delete this comic — it has 3 active order session(s). Wait for them to complete or fail first."`

On success the backend deletes all thumbnails **and all page artwork and masks** from R2, then cascade-deletes pages → bubbles, fonts, and pricing rules.

🔴 **Destructive and irreversible.** Require a type-the-title-to-confirm dialog.

---

# PART 5 — USER-FACING PAGES

Two endpoints. No auth. Both return **only** comics with `status === "PUBLISHED"`.

## 5.1 `GET /api/public/comics` — catalogue

**Query parameters** — all optional: `gender`, `ageGroup`, `themeId`, `search`. Same rules and same empty-string caveat as §4.4.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "e4b9a7c1-...-uuid",
      "title": "Captain Aarav and the Lost Star",
      "description": "A brave young astronaut...",
      "genderTag": "BOY",
      "ageGroup": "AGE_6_8",
      "isBestseller": false,
      "pageCount": 24,
      "coverThumbnailUrls": [
        "https://pub-xxxx.r2.dev/comics/temp/9f2c...-cover-front.png",
        "https://pub-xxxx.r2.dev/comics/temp/a71d...-cover-back.jpg"
      ],
      "theme": { "id": "d3a8...-uuid", "name": "Space Adventure" },
      "pricingRules": [
        {
          "price": "1499.00",
          "coverType": "HARDCOVER",
          "country": { "code": "IN", "name": "India", "flagUrl": "https://...", "currencyCode": "INR" }
        }
      ]
    }
  ]
}
```
Sorted by `createdAt` descending. No pagination.

**Building the catalogue card:**
- Cover image → `coverThumbnailUrls[0]` (always the primary)
- Price → filter `pricingRules` to the user's country, pick a `coverType` (SOFTCOVER is the usual "from" price). Format the **string** `price` with `currencyCode`
- Guard against `coverThumbnailUrls` being empty — the publish gate prevents it, but a published comic could have thumbnails removed afterwards

**Note:** `freePreviewPages` is **not** in the list response — only on detail.

---

## 5.2 `GET /api/public/comics/:comicId` — product detail

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "e4b9a7c1-...-uuid",
    "title": "Captain Aarav and the Lost Star",
    "description": "A brave young astronaut sets out to find a fallen star.",
    "genderTag": "BOY",
    "ageGroup": "AGE_6_8",
    "isBestseller": false,
    "pageCount": 24,
    "freePreviewPages": 10,
    "coverThumbnailUrls": [ "https://...", "https://..." ],
    "theme": { "id": "d3a8...-uuid", "name": "Space Adventure" },
    "pricingRules": [
      { "coverType": "HARDCOVER", "price": "1499.00", "country": { "code": "IN", "name": "India", "flagUrl": "https://...", "currencyCode": "INR" } },
      { "coverType": "SOFTCOVER", "price": "999.00",  "country": { "code": "IN", "name": "India", "flagUrl": "https://...", "currencyCode": "INR" } }
    ],
    "pages": [
      {
        "id": "a9d2e5f8-...-uuid",
        "pageNumber": 1,
        "artworkUrl": "https://pub-xxxx.r2.dev/comics/.../pages/artwork/9f2c...png",
        "artworkWidth": 2048,
        "artworkHeight": 1536
      }
    ]
  }
}
```

**`404`** — `"Comic not found or not available."` — returned both when the ID is wrong **and** when the comic exists but isn't PUBLISHED. Render the same not-found page for both.

**Building the detail page:**
- **Gallery:** iterate the whole `coverThumbnailUrls` array; `[0]` is the hero
- **Price selector:** `pricingRules` has one entry per country × coverType. Filter to the user's country, offer HARDCOVER/SOFTCOVER
- ✅ **Preview carousel:** `pages[].artworkUrl` are **full public URLs** — render them directly. Use `artworkWidth`/`artworkHeight` to set an aspect-ratio box and avoid layout shift while images load

⚠️ The `pages` array contains only pages flagged `isPreviewPage: true`, sorted by `pageNumber`. This is filtered by the **boolean flag**, not the `freePreviewPages` **number**. If the admin flagged 3 pages but set `freePreviewPages: 10`, you receive 3. **Display `pages.length` for "N free preview pages"**, not `freePreviewPages`, if you want the copy to match reality. See §9.3.

---

## 5.3 Adjacent public endpoints — exist, but not documented here

If you're building the **marketing homepage** rather than just the catalogue, these are live and need no auth. They follow the same `{ success, data }` envelope but are outside this guide's scope — ask backend for their field details when you get to them.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/public/hero-images` | Homepage hero carousel (active only) |
| GET | `/api/public/announcements` | Announcement bar (active only, has `sortOrder`) |
| GET | `/api/public/customer-reviews` | Video testimonials (active only) |
| GET | `/api/public/team-members` | About-us page (active only) |
| POST | `/api/public/feedbacks` | Contact form submission |
| GET | `/health` | Plain-text uptime check. Returns a string, **not** the JSON envelope |

Each has a matching admin CRUD screen under `/api/admin/*` — also out of scope here.

**Also out of scope and not yet wired:** the order-session endpoints (`/api/public/sessions/*`), photo upload and validation, AI generation, the WebSocket channel, checkout, payment, and orders. Those are the next milestone. Don't build against them from this document.

---

# PART 6 — COMPLETE ENDPOINT INDEX

Base URL: your backend origin (`http://localhost:8080` locally).

### Admin — requires ADMIN session cookie

| Method | Path | Body | Returns | Used at |
|---|---|---|---|---|
| GET | `/api/admin/status` | — | `{ message, adminEmail }` | auth smoke test |
| **Countries** |
| GET | `/api/admin/countries` | — | `Country[]` | country screen, pricing grid |
| POST | `/api/admin/countries/upload-url` | `{fileName, contentType}` | `{uploadUrl, key}` | flag upload |
| POST | `/api/admin/countries` | `{code,name,currencyCode,flagKey}` | `Country` (201) | create country |
| PUT | `/api/admin/countries/:countryId` | partial country | `Country` | edit country |
| DELETE | `/api/admin/countries/:countryId` | — | 204 | delete country |
| **Themes** |
| GET | `/api/public/themes` ⚠️ public | — | `Theme[]` | theme screen + dropdowns |
| POST | `/api/admin/themes` | `{name}` | `Theme` (201) | create theme |
| PATCH | `/api/admin/themes/:themeId` | `{name}` (required) | `Theme` | edit theme |
| DELETE | `/api/admin/themes/:themeId` | — | 204 | delete theme |
| **Comic** |
| POST | `/api/admin/comics/thumbnails/upload-urls` | `{files:[...]}` | `{uploads:[...]}` | **wizard 1**, adding thumbnails |
| POST | `/api/admin/comics` | see §3 STEP 2 | `Comic` (201) | **wizard 2** |
| GET | `/api/admin/comics` | — (query filters) | `Comic[] + theme + _count` | comic list |
| GET | `/api/admin/comics/:comicId` | — | full tree | edit / resume wizard |
| PATCH | `/api/admin/comics/:comicId` | partial comic | `Comic` | edit screen, **thumbnail delete/add/reorder** |
| DELETE | `/api/admin/comics/:comicId` | — | 204 | delete comic |
| GET | `/api/admin/comics/:comicId/pricing` | — | `PricingRule[] + country` | pricing screen |
| PUT | `/api/admin/comics/:comicId/pricing` | `{pricing:[...]}` | `Comic + pricingRules` | pricing screen |
| PATCH | `/api/admin/comics/:comicId/status` | `{status}` | `Comic` | **wizard 6** |
| **Fonts** |
| POST | `/api/admin/comics/:comicId/fonts/upload-url` | `{fileName, fileExtension}` | `{uploadUrl, key}` | **wizard 3** |
| POST | `/api/admin/comics/:comicId/fonts` | `{name, fontKey}` | `Font` (201) | **wizard 3** |
| GET | `/api/admin/comics/:comicId/fonts` | — | `Font[] + _count.bubbles` | font screen, bubble picker |
| PATCH | `/api/admin/fonts/:fontId` | `{name?, fontKey?}` | `Font` | edit font |
| DELETE | `/api/admin/fonts/:fontId` | — | 204 | delete font |
| **Pages** |
| POST | `/api/admin/comics/:comicId/pages/upload-url` | `{fileExtension, fileType}` | `{uploadUrl, key}` | **wizard 4** |
| POST | `/api/admin/comics/:comicId/pages` | see §3 STEP 4b | `Page + warnings` (201) | **wizard 4** |
| GET | `/api/admin/comics/:comicId/pages` | — | `Page[] + bubbles + font` | page screen, mapper |
| PATCH | `/api/admin/pages/:pageId` | partial page | `Page + warnings` | page edit |
| DELETE | `/api/admin/pages/:pageId` | — | 204 (cascades bubbles) | page delete |
| **Bubbles** |
| POST | `/api/admin/pages/:pageId/bubbles` | see §3 STEP 5 | `Bubble` (201) | **wizard 5** |
| GET | `/api/admin/pages/:pageId/bubbles` | — | `Bubble[] + font` | mapper |
| PATCH | `/api/admin/bubbles/:bubbleId` | partial bubble | `Bubble + font` | drag / edit |
| DELETE | `/api/admin/bubbles/:bubbleId` | — | 204 | delete bubble |

### Public — no auth

| Method | Path | Returns |
|---|---|---|
| GET | `/api/public/comics` | published `Comic[]` |
| GET | `/api/public/comics/:comicId` | published comic + preview pages |
| GET | `/api/public/themes` | `Theme[]` |

---

# PART 7 — PATH-SHAPE GOTCHAS

The nesting is inconsistent. **CREATE and LIST are nested under the parent; UPDATE and DELETE are top-level.** Memorize this or lose an afternoon to 404s.

```
CREATE / LIST  (nested)                    UPDATE / DELETE  (top-level)
────────────────────────────────           ──────────────────────────────
POST /comics/:comicId/pages                PATCH  /pages/:pageId
GET  /comics/:comicId/pages                DELETE /pages/:pageId

POST /pages/:pageId/bubbles                PATCH  /bubbles/:bubbleId
GET  /pages/:pageId/bubbles                DELETE /bubbles/:bubbleId

POST /comics/:comicId/fonts                PATCH  /fonts/:fontId
GET  /comics/:comicId/fonts                DELETE /fonts/:fontId
```

Other traps:
- `POST /comics/thumbnails/upload-urls` — **plural on both words**
- `fileType: "masks"` — **plural**. `"mask"` is rejected
- Countries update with **PUT**; everything else uses **PATCH**
- `GET /api/public/themes` — theme list is on the **public** router even for admin use
- Theme PATCH requires `name` — it is not a partial update
- There is **no** thumbnail delete / add / reorder endpoint — all of it is `PATCH /comics/:comicId` (§4.1.1)

---

# PART 8 — ENUM & BOUNDS REFERENCE

Send these strings **exactly**. Case-sensitive.

| Enum | Values |
|---|---|
| `genderTag` | `BOY`, `GIRL`, `UNISEX` |
| `ageGroup` | `AGE_0_2`, `AGE_3_5`, `AGE_6_8`, `AGE_9_12` |
| `coverType` | `HARDCOVER`, `SOFTCOVER` |
| `status` (comic) | `DRAFT`, `PUBLISHED`, `UNPUBLISHED` — (`PUBLISHING` exists in the DB but is never set) |
| `faceDirection` | `front`, `three-quarter`, `side` — ⚠️ **lowercase, hyphenated**, unlike every other enum |
| `fileType` (page) | `artwork`, `masks` |
| `fileExtension` (page) | `jpg`, `jpeg`, `png`, `webp` |
| `fileExtension` (font) | `ttf`, `otf`, `woff`, `woff2` |
| `contentType` (thumbnail) | `image/png`, `image/jpeg`, `image/jpg`, `image/webp` |
| `contentType` (flag) | above **plus** `image/svg+xml` |

**Numeric bounds:**

| Field | Min | Max | Default | Type |
|---|---|---|---|---|
| `Bubble.x`, `Bubble.y` | 0 | 1 | — | float |
| `Bubble.width`, `Bubble.height` | >0 | 1 | — | float |
| `Bubble.fontSize` | 0.005 | 0.25 | **0.02** | **float** |
| `Bubble.sortOrder` | — (create) / 0 (update) | — | 0 | integer |
| `Page.steps` | 1 | 8 | 3 | integer |
| `Page.cfg` | 1.0 | 3.0 | 1.0 | float |
| `thumbnailKeys` length | 1 | 10 | — | — |
| `pricing` length | 1 | — | — | — |
| `files` length (thumbnails) | 1 | 10 | — | — |
| `title` length | 1 | 255 | — | — |
| Country `name` length | 1 | 100 | — | — |

**Cross-field rules:** `x + width ≤ 1`, `y + height ≤ 1`, `freePreviewPages < pageCount` (create only), mask dimensions === artwork dimensions.

---

# PART 9 — ⚠️ CAUTIONS & CATCHES

Read this before writing code. Each item has bitten someone or will.

## 9.1 🔴 The pre-publish checklist is entirely yours

The server checks two things at publish. **Everything else is your responsibility, permanently** — a decided product position, not a temporary gap.

| # | Check | Source | Severity |
|---|---|---|---|
| 1 | At least 1 thumbnail | `coverThumbnailUrls.length > 0` | 🔴 server-enforced |
| 2 | At least 1 pricing rule | `pricingRules.length > 0` | 🔴 server-enforced |
| 3 | Every country has **both** HARDCOVER and SOFTCOVER priced | `pricingRules` × `countries` | 🔴 yours |
| 4 | `_count.pages === pageCount` | admin detail | 🔴 yours |
| 5 | Page numbers contiguous `1..pageCount`, no gaps | `pages[].pageNumber` | 🔴 yours |
| 6 | Every page has a non-null `artworkUrl` | `pages[]` | 🔴 yours |
| 7 | Every page with `hasFace: true` has a non-null `maskUrl` | `pages[]` | 🔴 yours |
| 8 | Count of `isPreviewPage: true` === `freePreviewPages` | `pages[]` vs comic | 🔴 yours |
| 9 | Every bubble has a `fontId` | `pages[].bubbles[]` | 🟡 advisory |
| 10 | No `dialogue` contains an unrecognized `{token}` | regex | 🟡 advisory |
| 11 | Bubbles within artwork bounds | — | ✅ server-enforced |

Items 3–8 are what reaches a customer as a broken book. Treat them as blocking. `GET /api/admin/comics/:comicId` (§4.5) gives you everything needed to evaluate all of them in one request.

## 9.2 🔴 Mask and artwork must be identical dimensions

The backend probes both with Sharp and **rejects** any mismatch. ComfyUI overlays them pixel-for-pixel.

**The non-obvious case:** if a page already has a mask and you PATCH **only** `artworkUrl` to a different-sized image, the request is rejected — the backend re-validates the existing mask against the new artwork.

**➡️ When replacing artwork on a page that has a mask, send both keys in the same PATCH.**

Also expect a `warnings` entry (not a rejection) when replaced artwork has a **different aspect ratio**. A same-aspect resize produces no warning.

## 9.3 🔴 `freePreviewPages` and `isPreviewPage` are not linked

Two independent fields. The backend never checks they agree.

Set the number to 10, flag 3 pages, and the site promises 10 free pages while delivering 3. **Warn the admin when the counts diverge** (checklist item 8), and display `pages.length` on the public page rather than the number.

## 9.4 🔴 The bubble font picker must come from one source only

`fontId` **is not validated for comic ownership on bubble CREATE** — only on update. A font from a different comic is accepted silently.

**➡️ Populate the picker exclusively from `GET /api/admin/comics/:comicId/fonts`.** Never let a global or cached font list reach that dropdown.

## 9.5 🔴 Price: read a string, write a number

`price` is a Postgres `DECIMAL(10,2)`. Reading gives `"1499.00"`; writing requires `1499`. Sending `"1499"` returns a 400. Normalize in one place in your API layer.

## 9.6 🔴 Never send empty-string query params

`?themeId=` → `400 "Invalid theme ID"`. Same for `gender=` and `ageGroup=`. Strip empty values before serializing. (`search=""` is the one safe exception.)

## 9.7 🔴 `thumbnailKeys` PATCH permanently deletes omitted entries

Full-array replacement with R2 cleanup of the diff. Omit an entry and that file is gone forever, with no undo.

✅ **The array accepts full URLs as well as fresh keys**, so keeping an existing thumbnail is just re-sending the URL you got from `GET` — no key conversion, no `PUBLIC_URL_BASE` needed on the client.

Route every thumbnail operation through one helper. See §4.1.1.

## 9.8 🔴 Upload fonts sequentially, never in parallel

Font keys are `<Date.now()>.<ext>` with **no random component**. Two requests in the same millisecond collide and one file is silently overwritten. Await each font upload before starting the next.

Page artwork does **not** have this problem — its keys include a UUID.

## 9.9 🔴 `fontSize` is 0.02, not 24

Sending an integer pixel value returns a 400. It's a fraction of artwork height. §1.5 shows the conversion that lets admins work in pixels.

## 9.10 🔴 Content-Type must match exactly on the R2 PUT

The signature covers the content type. `image/jpg` ≠ `image/jpeg`. A mismatch returns a **403 with an unhelpful XML body** from Cloudflare, not a JSON error from us.

| Symptom | Cause |
|---|---|
| CORS preflight error | Bucket CORS misconfigured — tell backend |
| 403 with XML body | Content-Type mismatch between step 1 and step 2 |
| 403, signature message | Signed URL expired (15 min, or 10 for fonts) |
| 403 on a request that "should work" | You used your configured API client instead of bare `fetch` (§1.2) |

## 9.11 🟠 A non-existent `countryId` returns 500, not 404

Well-formed UUID that doesn't exist → foreign-key violation → 500. Always source IDs from the list endpoints.

## 9.12 🟠 `fontId: null` is rejected on create, accepted on update

Create schema is `.optional()` without `.nullable()`. **Omit the key entirely** when there's no font. Update accepts `null` to unassign.

## 9.13 🟠 Partial bubble updates can be rejected on bounds

Send only `x` and the server merges it with the stored `width`. If the total exceeds 1 you get a 400, even though the value you sent was individually valid. Clamp during the drag (§1.5).

## 9.14 🟠 Debounce the bubble PATCH

A drag will otherwise fire dozens of requests. 300–500 ms is right.

## 9.15 🟠 Deleting a page destroys its bubbles silently

No 409, no confirmation from the backend. The cascade is immediate and the R2 files go too. Confirm in the UI with the bubble count named.

## 9.16 🟡 Some replaced files are cleaned up, some are not

| Replaced asset | Old file deleted from R2? |
|---|---|
| Comic thumbnail | ✅ Yes |
| Page artwork / mask | ✅ Yes |
| Country flag | ❌ No |
| Font file | ❌ No |

Not your problem, just don't be surprised.

## 9.17 🟡 No pagination anywhere

Both comic lists and the country list return everything. Fine at current scale — handle it client-side.

---

# PART 10 — DO NOT BUILD THESE

## 10.1 ⛔ LoRA upload UI
`POST /api/admin/comics/lora/upload-url` exists and works, and `loraKey` / `loraStrength` are accepted on comic create and update. **They do nothing.** The AI model is a single file baked into the generation server, identical for every comic. These fields exist only for schema stability. Do not surface `loraFileUrl` or `loraStrength` anywhere.

## 10.2 ⛔ Publish progress UI
No job, no polling, no websocket. Synchronous status flip. A button spinner is all you need.

## 10.3 ⛔ Page reordering
`pageNumber` is immutable after creation and there is no reorder endpoint. Permanent by decision.

## 10.4 ⛔ A "clear theme" control
A comic's theme cannot be unset — only switched. Permanent by decision. See §11.2.

---

> **The next two items are different from the rest of this list.** The *feature* exists and you should absolutely build UI for it — only the dedicated endpoint you might go looking for doesn't exist.

## 10.5 ⚠️ Thumbnail add / remove / reorder **sub-endpoints** — not the features

✅ **Adding a thumbnail, deleting a single thumbnail, reordering, and changing the primary are ALL supported. Build UI for all of them.**

They just don't have their own endpoints. Every one of them is `PATCH /api/admin/comics/:comicId` with the full desired array — **see §4.1.1 for working code for each operation.**

⛔ What doesn't exist, and won't:
- `DELETE /api/admin/comics/:comicId/thumbnails/:index`
- `POST /api/admin/comics/:comicId/thumbnails/add`
- `PATCH /api/admin/comics/:comicId/thumbnails/reorder`

Don't go hunting for them, and don't ask backend to add them — the full-array contract is deliberate, and index-based deletion would be race-prone with two admins on the same screen.

## 10.6 ⚠️ A single-file thumbnail upload endpoint — the batch one covers it

✅ **Uploading one thumbnail works fine.** Send `files: [{ fileName, contentType }]` — an array of one — to `POST /api/admin/comics/thumbnails/upload-urls`.

⛔ The old `POST /comics/thumbnail/upload-url` (singular) was removed. There is exactly one upload-URL endpoint for thumbnails and it always takes an array.

---

## 10.7 ⛔ A country `isActive` toggle
The field exists and is returned, but no endpoint can change it.

## 10.8 ⛔ Server-side pagination or sort controls
Not supported by any list endpoint.

## 10.9 ⛔ Generation, photo upload, checkout, payment, orders
Out of scope for this milestone.

---

# PART 11 — KNOWN LIMITATIONS (accepted by design)

Settled decisions, not gaps awaiting a fix. Plan around them.

## 11.1 Fonts cannot be previewed in their real typeface
Font files stay in the private bucket, so `@font-face` is impossible. **Font selection is by name only** — the admin picks "ComicSans-Bold" from a dropdown and sees dialogue rendered in a fallback face.

**Consequence:** the admin cannot visually confirm dialogue fits its bubble at the real typeface's metrics. Combined with §9.1, text overflow won't be caught until a printed proof. Showing a character count against bubble width is a partial mitigation.

## 11.2 A comic's theme cannot be removed
Internally the update uses a `connect` operation and the validator rejects `null`. A theme can be **switched**, never cleared. This also means deleting a theme requires reassigning every linked comic first.

## 11.3 Page numbers are immutable
Renumbering requires delete + recreate, which destroys the page's bubbles.

## 11.4 Fonts are per-comic
No sharing across comics. The same typeface in three comics is three uploads.

## 11.5 Publish validates almost nothing
Two checks only. See §9.1.

---

# PART 12 — SUGGESTED BUILD ORDER

Nothing is blocked. This order minimizes rework.

| # | Task | Notes |
|---|---|---|
| 0 | **Login screen + auth client** | §0.4. Nothing else can be tested until an admin can sign in. Use `better-auth/react`. Confirm you can reach `GET /api/admin/status` as `devs@pantharinfohub.com` |
| 1 | **API layer** | §1.2. Response unwrapping, error normalization, `credentials: "include"`. Distinguish 401 (re-login) from 403 (not an admin) |
| 2 | **The `uploadToR2` helper** | §0.2, §1.2. Isolated from the API client. Test with a flag upload first — smallest possible surface |
| 3 | **Countries screen** | 🔴 **Build this first.** The database has zero countries, and the comic wizard cannot be completed without at least one |
| 4 | **Themes screen** | Small. Remember the list endpoint is on the public router |
| 5 | **Comic list** | Filters + `_count` badges |
| 6 | **Wizard steps 1–2** | Thumbnails + create. Unlocks everything else — once `comicId` exists the rest is parallelizable |
| 7 | **Thumbnail management** | §4.1.1. Build the `setThumbnails` helper before any UI touches it |
| 8 | **Fonts screen** | Sequential uploads only (§9.8) |
| 9 | **Pages screen** | Upload + create + list. Artwork displays directly from the returned URL |
| 10 | **Bubble mapper** | §1.5. Hardest screen — budget 2–3× your first estimate |
| 11 | **Pricing screen** | Remember the string-in / number-out asymmetry (§9.5) |
| 12 | **Pre-publish checklist + publish** | §9.1 |
| 13 | **Public catalogue + detail** | Straightforward. Preview carousel works — use `artworkWidth`/`artworkHeight` to avoid layout shift |

**Suggested first end-to-end milestone:** create one country → create one theme → create a comic with one thumbnail and one pricing rule → add one page with artwork → add one bubble → publish → see it on the public catalogue. Getting that thin slice working proves every layer before you build breadth.

---

**Something in here doesn't match what the API actually does?** Raise it with backend rather than working around it — a mismatch means either this document or the code is wrong, and both are worth fixing.
