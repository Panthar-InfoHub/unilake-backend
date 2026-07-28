# Hero Images API — Frontend Integration Guide

**Audience:** Unilake frontend team
**Last updated:** July 27, 2026
**Source of truth:** [src/routes/admin.ts](src/routes/admin.ts), [src/routes/public.ts](src/routes/public.ts), [src/controllers/heroImage.controller.ts](src/controllers/heroImage.controller.ts), [src/services/heroImage.service.ts](src/services/heroImage.service.ts), [src/validators/heroImage.schema.ts](src/validators/heroImage.schema.ts), [src/lib/r2.ts](src/lib/r2.ts)

> Read the announcement guide ([ANNOUNCEMENTS_API.md](ANNOUNCEMENTS_API.md)) first if you haven't — §3 (response envelope) and §4 (admin auth) there apply identically here and are only summarized below. **What's genuinely new in this module is the two-step direct-to-R2 file upload (§5).** That's the part that will cost you time if you skim it.

---

## 1. What a hero image is

The large banner images in the homepage hero carousel. That is the entire feature — an image URL and an on/off flag. There is **no** title, subtitle, caption, alt text, CTA link, button label, target page, or scheduling window on this model. If the design calls for text or a link over the banner, that copy must be baked into the image itself or hardcoded in the frontend; the API will not supply it.

A single hero image is:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID v4) | Server-generated. |
| `imageUrl` | `string` | **Fully-qualified public URL**, ready to drop into `<img src>`. Not a key, not a path — no need to prefix anything. |
| `isActive` | `boolean` | Only `true` rows appear on the public endpoint. **Defaults to `true` on create** — see the warning in §6.2. |
| `createdAt` | `string` (ISO 8601) | Also the sort key. |
| `updatedAt` | `string` (ISO 8601) | Auto-bumped on write. |

Schema: [prisma/schema.prisma:487-495](prisma/schema.prisma#L487-L495)

### Deliberate absences — do not go looking for these endpoints

| Missing | Reality |
|---|---|
| `sortOrder` / reorder endpoint | **Ordering is `createdAt` descending — newest first, always.** Unlike announcements, there is no manual ordering. To move a banner to the front of the carousel, the admin must delete it and re-upload. Make sure the admin UI communicates this. |
| `PATCH /hero-images/:id` | **There is no update endpoint at all.** You cannot swap the image or edit anything on an existing row. "Replace this banner" = delete + upload new. |
| Alt text | Not stored. Generate something from context (`Unilake hero banner 1`) or accept the a11y gap knowingly. |
| Link / CTA target | Not stored. Hardcode on the frontend. |

---

## 2. Base URLs

| Environment | Base URL |
|---|---|
| Local dev | `http://localhost:8080` |
| Deployed (Cloud Run) | `https://unilake-backend-590672762351.asia-south1.run.app` |

CORS currently allows **only** `http://localhost:3000` ([src/app.ts:32](src/app.ts#L32)). Give backend your deploy URL when you have one.

---

## 3. Response envelope (recap)

Success (except `204`): `{ "success": true, "data": <payload> }`
Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`
`DELETE` returns bare **`204` with an empty body** — never call `res.json()` on it.

Error codes you'll see here: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `INTERNAL_SERVER_ERROR` (500).

---

## 4. Admin access (recap)

Everything under `/api/admin/*` runs through `requireAdmin`: no valid Better Auth session → `401`; valid session but `role !== "ADMIN"` → `403`.

**No bearer token. Auth is an httpOnly cookie.** Every admin call needs `credentials: "include"` (fetch) or `withCredentials: true` (axios). Gate the admin UI on `role === "ADMIN"` from `GET /api/auth/get-session`.

| Endpoint | Guard |
|---|---|
| `GET /api/public/hero-images` | 🟢 **None** |
| `POST /api/admin/hero-images/upload-url` | 🔒 Admin |
| `POST /api/admin/hero-images` | 🔒 Admin |
| `GET /api/admin/hero-images` | 🔒 Admin |
| `PATCH /api/admin/hero-images/:id/status` | 🔒 Admin |
| `DELETE /api/admin/hero-images/:id` | 🔒 Admin |

---

## 5. ⭐ The upload flow — the important part

Images do **not** pass through the Unilake backend. The browser uploads the file **directly to Cloudflare R2** using a short-lived presigned URL. Three steps:

```
┌─────────┐  1. POST /admin/hero-images/upload-url   ┌─────────┐
│         │  { fileName, contentType }               │ Unilake │
│ Browser │ ───────────────────────────────────────► │ backend │
│         │ ◄─────────────────────────────────────── │         │
│         │       { uploadUrl, key }                 └─────────┘
│         │
│         │  2. PUT <uploadUrl>   (raw file bytes)   ┌─────────┐
│         │ ───────────────────────────────────────► │   R2    │
│         │ ◄─────────────────────────────────────── │ bucket  │
│         │              200 OK                      └─────────┘
│         │
│         │  3. POST /admin/hero-images              ┌─────────┐
│         │  { imageKey: key }                       │ Unilake │
│         │ ───────────────────────────────────────► │ backend │
│         │ ◄─────────────────────────────────────── │         │
└─────────┘   201 { id, imageUrl, isActive, ... }    └─────────┘
```

**Step 2 does not create a database row.** Until step 3 runs, the file sits in the bucket and no hero image exists. If the user closes the tab between 2 and 3, you get an orphaned file in R2 that nothing references (harmless, but it's dead storage).

### Step 5.1 — `POST /api/admin/hero-images/upload-url`

**Request body:**

```json
{
  "fileName": "homepage-banner-diwali.webp",
  "contentType": "image/webp"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `fileName` | `string` | ✅ | Min 1 char. Send `file.name` straight from the `<input type="file">`. The server sanitizes it (`[^a-zA-Z0-9.-]` → `_`) and prefixes a UUID, so collisions are impossible and you don't need to make it unique. Spaces and unicode are fine — they just get replaced. |
| `contentType` | `string` | ✅ | Must match `^image/(png\|jpeg\|jpg\|webp)$`. Send `file.type` from the File object. |

**Allowed MIME types — exactly four:** `image/png`, `image/jpeg`, `image/jpg`, `image/webp`.

> ⚠️ **Rejected: `image/gif`, `image/avif`, `image/svg+xml`, `image/heic`.** HEIC matters — photos straight off an iPhone are `image/heic` and will 400. If the admin panel might receive one, either convert client-side before upload or show a clear "PNG, JPEG or WEBP only" message.
>
> Note `image/jpg` is accepted by the regex, but browsers report `image/jpeg` for `.jpg` files. Just forward `file.type` and it will be correct.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/unilake-public/hero-images/6f2b1a90-...-homepage-banner-diwali.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&X-Amz-Expires=900&X-Amz-Signature=...",
    "key": "hero-images/6f2b1a90-4c77-4d1e-9f0a-2b8e5c1d7a33-homepage-banner-diwali.webp"
  }
}
```

- `uploadUrl` — presigned `PUT` target. **Valid for 15 minutes** ([heroImage.service.ts:7](src/services/heroImage.service.ts#L7)). Single-use in practice; never log it or persist it (the signature is a credential).
- `key` — hold onto this. It is the exact string you must send in step 3.

**Errors:**

| Status | Message |
|---|---|
| 400 | `"Validation failed - contentType: Only PNG, JPEG, and WEBP images are allowed"` |
| 400 | `"Validation failed - fileName: File name is required"` |
| 401 / 403 | See §4 |

---

### Step 5.2 — `PUT` the file to R2

This request goes to **Cloudflare, not to us.** Getting it wrong is the #1 source of lost time in this flow, so read every bullet:

```js
const res = await fetch(uploadUrl, {
  method: "PUT",                          // PUT — not POST
  headers: { "Content-Type": file.type }, // MUST equal the contentType you sent in step 1
  body: file,                             // raw File/Blob — NOT FormData
});
if (!res.ok) throw new Error("Upload to R2 failed");
```

**The four ways this goes wrong:**

1. **`Content-Type` mismatch → `403 SignatureDoesNotMatch`.** The content type is baked into the signature ([r2.ts:129](src/lib/r2.ts#L129)). If you asked for `image/webp` and PUT with `image/png` — or let the browser default it — R2 rejects the request. Use the *same variable* for both calls, don't retype the string.
2. **Wrapping the file in `FormData` → corrupt image.** A presigned PUT takes the raw bytes as the body. `FormData` adds multipart boundary junk that becomes part of the stored file. Pass the `File` object directly.
3. **Sending `credentials: "include"` or an `Authorization` header → `400`/`403`.** Do **not** reuse your authenticated API client for this call. The R2 request is authorized entirely by the query-string signature; cookies and auth headers can conflict with it. Use a bare `fetch`/`XMLHttpRequest`.
4. **Taking longer than 15 minutes** (user picks a file, wanders off, then submits) → `403`. See tip §8.2.

**Success is `200` with an empty body.** There is nothing to parse. R2 errors come back as **XML**, not JSON — if you need the detail, read `await res.text()`.

---

### Step 5.3 — `POST /api/admin/hero-images`

**Request body:**

```json
{
  "imageKey": "hero-images/6f2b1a90-4c77-4d1e-9f0a-2b8e5c1d7a33-homepage-banner-diwali.webp"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `imageKey` | `string` | ✅ | Min 1 char. Must be the **exact `key`** returned in step 5.1. |

> ⚠️ **The server does not verify that the key exists in R2.** It blindly concatenates it onto the public base URL and saves the row. Send a typo, a truncated key, or the full `uploadUrl` instead of the `key`, and you get a `201 Created` with a permanently broken image. Pass the `key` value through untouched — never rebuild it by hand, never substring it, never strip the `hero-images/` prefix.

Server behavior: `imageUrl = <R2 public base>/<imageKey>`, and `isActive` is set to **`true`** by the DB default.

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "c4e91f07-3b52-4a8d-95c1-7d0f6b2e4a19",
    "imageUrl": "https://cdn.unilake.example/hero-images/6f2b1a90-4c77-4d1e-9f0a-2b8e5c1d7a33-homepage-banner-diwali.webp",
    "isActive": true,
    "createdAt": "2026-07-27T10:22:41.660Z",
    "updatedAt": "2026-07-27T10:22:41.660Z"
  }
}
```

**Errors:** `400 VALIDATION_ERROR` (`"Validation failed - imageKey: Image key is required"`), `401`, `403`.

---

## 6. Endpoint reference

### 6.1 `GET /api/public/hero-images` — the carousel feed

Returns **only active** hero images, sorted **`createdAt` descending (newest first)**.

**Auth:** none. **Query params:** none — no pagination, no limit. **Body:** none.

**Response `200`:**

```json
{
  "success": true,
  "data": [
    {
      "id": "c4e91f07-3b52-4a8d-95c1-7d0f6b2e4a19",
      "imageUrl": "https://cdn.unilake.example/hero-images/6f2b1a90-...-diwali.webp",
      "isActive": true,
      "createdAt": "2026-07-27T10:22:41.660Z",
      "updatedAt": "2026-07-27T10:22:41.660Z"
    },
    {
      "id": "8a71d3b5-90ce-4c22-b7f4-1e5a9d0c3f77",
      "imageUrl": "https://cdn.unilake.example/hero-images/2c9f4e11-...-summer.png",
      "isActive": true,
      "createdAt": "2026-07-19T05:11:08.412Z",
      "updatedAt": "2026-07-19T05:11:08.412Z"
    }
  ]
}
```

**Empty state (`data: []`) is realistic and must be designed for.** No hero images = the carousel renders nothing. Decide now whether that means a static fallback banner or a collapsed section — do not ship a layout that leaves a blank full-bleed gap or an infinite skeleton.

**Errors:** none beyond a 500 if the DB is unreachable.

---

### 6.2 `GET /api/admin/hero-images` — list all

Every hero image, active and inactive, `createdAt` descending. No pagination, no filters — the whole table in one array. Filter client-side for an "active only" view.

Response shape is identical to §6.1 but includes rows with `"isActive": false`.

**Errors:** `401`, `403`.

> ⚠️ **`isActive` defaults to `true` — the opposite of announcements.** A hero image goes **live on the public homepage the instant step 5.3 completes.** There is no draft state and no way to pre-stage a banner. If the admin needs to prepare a banner without publishing it, the flow is: upload → then immediately toggle it off (§6.3). Build that as one action in the UI if the admins ask for staging, and make the "Upload" button copy say **"Upload & publish"** so nobody is surprised.

---

### 6.3 `PATCH /api/admin/hero-images/:id/status` — toggle active/inactive

**Path param:** `id`. **Request body: NONE.**

This is a **toggle, not a setter** — there is no `validateBody` on this route and the handler never reads `req.body`. Sending `{"isActive": false}` has no effect; the server flips the current value whatever it is.

```js
await fetch(`${BASE_URL}/api/admin/hero-images/${id}/status`, {
  method: "PATCH",
  credentials: "include",
  // no body, no Content-Type
});
```

Because it isn't idempotent, a double-click or a retry-on-timeout lands you back where you started. **Disable the switch while the request is in flight and render its state from the response**, not from optimistic local state.

**Response `200`:** the full row with `isActive` flipped.

```json
{
  "success": true,
  "data": {
    "id": "c4e91f07-3b52-4a8d-95c1-7d0f6b2e4a19",
    "imageUrl": "https://cdn.unilake.example/hero-images/6f2b1a90-...-diwali.webp",
    "isActive": false,
    "createdAt": "2026-07-27T10:22:41.660Z",
    "updatedAt": "2026-07-27T11:03:12.994Z"
  }
}
```

**Errors:** `404 NOT_FOUND` (`"Hero image not found"`), `401`, `403`.

---

### 6.4 `DELETE /api/admin/hero-images/:id` — delete

**Path param:** `id`. **Body:** none.

Hard delete of the DB row. No soft delete, no undo.

**Response `204 No Content` — empty body, no envelope.**

```js
const res = await fetch(`${BASE_URL}/api/admin/hero-images/${id}`, {
  method: "DELETE",
  credentials: "include",
});
if (res.status === 204) {
  // success — do NOT call res.json()
}
```

**Errors:** `404 NOT_FOUND` (`"Hero image not found"`), `401`, `403`. Error responses do carry a JSON body; only the 204 is empty.

> **Note:** deleting the row does **not** delete the file from R2 ([heroImage.service.ts:77-87](src/services/heroImage.service.ts#L77-L87)) — unlike CustomerReview and TeamMember, which do clean up. The image stays publicly reachable at its old URL forever. Practical consequences: (a) don't rely on delete to make an image inaccessible — if a banner must be taken down for legal or brand reasons, tell backend so the object gets removed manually; (b) any URL you cached will keep resolving after the row is gone, so drive the carousel off the API response, not off a stale local copy. Flagged to backend as a gap (§9).

---

## 7. Quick reference

| # | Method | Path | Auth | Body | Success |
|---|---|---|---|---|---|
| 1 | `GET` | `/api/public/hero-images` | none | — | `200` → array (active only) |
| 2 | `POST` | `/api/admin/hero-images/upload-url` | admin | `{ fileName, contentType }` | `200` → `{ uploadUrl, key }` |
| 3 | `PUT` | `<uploadUrl>` *(goes to R2, not us)* | signature | raw file bytes | `200` → empty |
| 4 | `POST` | `/api/admin/hero-images` | admin | `{ imageKey }` | `201` → object |
| 5 | `GET` | `/api/admin/hero-images` | admin | — | `200` → array (all) |
| 6 | `PATCH` | `/api/admin/hero-images/:id/status` | admin | **none** | `200` → object |
| 7 | `DELETE` | `/api/admin/hero-images/:id` | admin | — | `204` → **empty** |

---

## 8. Optimization tips

These aren't required to make it work — they're what separates a hero carousel that feels instant from one that jank-loads on every visit. Hero images are the single heaviest thing on the homepage and they sit in the LCP (Largest Contentful Paint) position, so this is the highest-leverage performance work on the site.

### 8.1 Compress before upload — the biggest win by far

The API imposes **no file size limit**, which means a 12 MB camera-original PNG will upload happily and then be served to every visitor on mobile data. Nothing downstream fixes this for you.

Do the work client-side in the admin panel before step 5.2:

- **Convert to WebP and resize to a max width of ~2000px** using a canvas or `browser-image-compression`. A 12 MB PNG typically becomes 150–350 KB WebP with no visible loss at banner scale.
- Since you're re-encoding anyway, `contentType` becomes `image/webp` — the allowed list already covers it.
- Show the admin the before/after size. It makes the value obvious and stops them fighting the compression step.
- Enforce a soft cap in the UI (reject > ~2 MB post-compression with a clear message) rather than waiting for the backend, which won't stop them.

### 8.2 Request the upload URL late, not early

The presigned URL expires **15 minutes** after issue. Don't fetch it when the file picker opens — fetch it when the admin clicks **Upload**, immediately before the PUT. This kills the "admin picked a file, took a phone call, came back, got a mystery 403" bug class entirely.

If you do hit a `403` on the PUT, the correct recovery is to silently re-request a fresh `uploadUrl` and retry once — not to show the admin an error.

### 8.3 Treat step 3 as the commit, and make it resilient

Steps 2 and 3 are not atomic. If the PUT succeeds and the `POST /hero-images` fails (network blip), the file is in R2 but no row exists.

- Keep `key` in component state and **retry step 3 alone** on failure — never restart the upload. The bytes are already there.
- Only clear the form / close the modal after step 3 returns `201`.
- Drive the progress UI off the PUT (see §8.5), but only call it "done" after step 3.

### 8.4 Optimize the render, not just the upload

The public carousel is your LCP element. In order of impact:

- **Preload the first image only:** `<link rel="preload" as="image" href={data[0].imageUrl} fetchpriority="high" />`. Everything else on the page competes with it otherwise.
- **`loading="eager"` + `fetchpriority="high"` on slide 1; `loading="lazy"` on slides 2+.** The default lazy-loads-everything approach actively delays the LCP.
- **Always set explicit `width`/`height` (or `aspect-ratio`) on the `<img>`.** Without it the carousel has zero height until the first byte arrives, and the whole page reflows — that's a CLS penalty on every single visit.
- **Standardize banner dimensions.** The API stores no dimensions and enforces no aspect ratio, so a admin uploading a 4:3 image into a 21:9 slot produces letterboxing or a crop. Agree one exact size with design (e.g. 2000×800), state it in the admin upload UI, and use `object-fit: cover` as a safety net.
- Since R2 serves these from a CDN-backed public bucket, the URLs are cache-friendly and immutable (every key carries a UUID) — a long browser cache is safe. A new upload is always a new URL, so cache-busting is never needed.

### 8.5 Real progress needs `XMLHttpRequest`

`fetch` cannot report upload progress. For a real percentage bar on step 5.2:

```js
const xhr = new XMLHttpRequest();
xhr.upload.onprogress = (e) => {
  if (e.lengthComputable) setPercent(Math.round((e.loaded / e.total) * 100));
};
xhr.open("PUT", uploadUrl);
xhr.setRequestHeader("Content-Type", file.type);
xhr.send(file);
```

For a large banner on a slow connection this is the difference between a usable admin panel and one people assume has frozen. If you'd rather stay on `fetch`, use an indeterminate spinner — don't fake a percentage.

### 8.6 Cache and revalidate sensibly

The public list changes maybe once a month. Cache it aggressively (SWR/React Query with a long `staleTime`, or ISR if you're on Next.js) — there's no reason to hit the API on every homepage render.

In the **admin** panel do the opposite: after any create, toggle, or delete, refetch `GET /api/admin/hero-images` rather than patching local state by hand. The list is small and unpaginated, so a refetch is cheap and it keeps two admins working simultaneously from drifting out of sync. The one thing you can safely apply locally is the toggle response, since it returns the updated row.

### 8.7 Show the admin what the public sees

Because ordering is fixed to newest-first and there's no reorder, admins will be surprised by carousel order. In the admin list, render the active images **in public order with position badges** (`Slide 1`, `Slide 2`, …) rather than as an undifferentiated grid. It turns an invisible rule into something obvious, and heads off "why is my new banner first?" tickets.

---

## 9. Open items raised with backend

Documented as current behavior above; these are known gaps, not things for frontend to work around silently:

1. **No R2 cleanup on delete** — deleted hero images leave orphaned public files. `CustomerReview` and `TeamMember` already do this cleanup; `HeroImage` does not.
2. **No update endpoint** — replacing a banner requires delete + re-upload.
3. **No `sortOrder`** — carousel order is locked to newest-first. If the admins want manual ordering, this needs the same `sortOrder` + reorder endpoint that announcements have.
4. **`imageKey` is not validated against R2** — a bad key silently creates a broken row.
5. **`isActive` defaults to `true`** with no way to create-as-draft, and the status route is a blind toggle rather than an idempotent setter.
6. **Debugging note:** if `imageUrl` ever comes back starting with `undefined/`, that's a missing `R2_PUBLIC_URL_BASE` env var on the server ([env.ts:50](src/config/env.ts#L50) — it's read but not in the required-vars check), not a frontend bug. Report it rather than trying to patch the URL client-side.

If any of 1–5 blocks the admin panel design, raise it — they're all small backend changes.
