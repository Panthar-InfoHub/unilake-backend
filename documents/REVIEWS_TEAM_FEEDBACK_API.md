# Customer Reviews, Team Members & Feedback — Frontend Integration Guide

Three CMS modules that share one shape: a public read endpoint for the marketing site, and an admin-guarded set of writes for the panel. Written for the frontend team.

Pulled from route files, controllers, services, Zod validators and `schema.prisma` — not from intent docs. Where a doc and the code disagreed, the code won.

**Last updated:** August 24, 2026

---

## 1. What these three are

| Module | What it holds | Where the public sees it |
|---|---|---|
| **Customer Reviews** | A customer's name, a short description, and a **video testimonial** | Homepage testimonial section |
| **Team Members** | Name, role, optional bio, optional photo, optional social links | "Our Team" section |
| **Feedback** | A contact-form submission: name, email, phone, message, triage status | Nowhere — public **writes**, admin **reads** |

Feedback runs in the opposite direction to the other two. Reviews and team members are admin-authored and publicly read. Feedback is publicly submitted and admin-read.

### Deliberate absences — do not go looking for these endpoints

These do not exist, and are not oversights:

- **No update endpoint for Customer Reviews.** A review is a video and two strings that describe it; there is nothing meaningful to edit without re-uploading. Editing = delete + recreate. Build the UI as add/remove, with no "Edit" button.
- **No content-edit endpoint for Feedback.** Admins triage status or delete. They can never alter what someone submitted.
- **No single-item `GET`** on any of the three (`GET /customer-reviews/:id` etc.). Open your edit/detail modal from the row you already have in the list.
- **No reorder endpoint and no `sortOrder` column** on reviews or team members. See §9.3.
- **No `GET /api/admin/team-members/active`.** It existed, was a byte-for-byte duplicate of the public endpoint, and is now commented out at [admin.ts:310](src/routes/admin.ts#L310). Use `GET /api/admin/team-members`.

---

## 2. Base URLs

| Environment | Base URL |
|---|---|
| Local dev | `http://localhost:8080` |
| Production | `https://api.unilakekids.com` |

CORS allows `https://www.unilakekids.com`, `https://unilakekids.com`, `http://localhost:3000`, and Vercel preview URLs matching `https://unilake-frontend-*.vercel.app` ([src/app.ts:23-53](src/app.ts#L23-L53)).

> ⚠️ **Login does not work on Vercel preview URLs.** The session cookie is scoped to `.unilakekids.com`. Public endpoints work from a preview deploy; every `/api/admin/*` call will `401`. Test the admin panel on `localhost:3000` or the real domain.

---

## 3. Response envelope (recap)

Success (except `204`): `{ "success": true, "data": <payload> }`
Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`

**None of the endpoints in this document return a `message` field.** All three modules call `sendSuccess(res, code, data)` with three arguments, so the optional `message` is absent. Don't render off it.

`DELETE` returns a bare **`204` with an empty body** — never call `res.json()` on it.

Error codes you'll see here: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `INTERNAL_SERVER_ERROR` (500).

---

## 4. Admin access (recap)

Everything under `/api/admin/*` runs through `requireAdmin`: no valid Better Auth session → `401`; valid session but `role !== "ADMIN"` → `403`.

**No bearer token. Auth is an httpOnly cookie.** Every admin call needs `credentials: "include"` (fetch) or `withCredentials: true` (axios). Gate the admin UI on `role === "ADMIN"` from the Better Auth session.

| Endpoint | Guard |
|---|---|
| `GET /api/public/customer-reviews` | 🟢 **None** |
| `GET /api/public/team-members` | 🟢 **None** |
| `POST /api/public/feedbacks` | 🟢 **None** |
| `POST /api/admin/customer-reviews/upload-url` | 🔒 Admin |
| `POST /api/admin/customer-reviews` | 🔒 Admin |
| `GET /api/admin/customer-reviews` | 🔒 Admin |
| `PATCH /api/admin/customer-reviews/:id/status` | 🔒 Admin |
| `DELETE /api/admin/customer-reviews/:id` | 🔒 Admin |
| `POST /api/admin/team-members/upload-url` | 🔒 Admin |
| `POST /api/admin/team-members` | 🔒 Admin |
| `GET /api/admin/team-members` | 🔒 Admin |
| `PATCH /api/admin/team-members/:id` | 🔒 Admin |
| `PATCH /api/admin/team-members/:id/status` | 🔒 Admin |
| `DELETE /api/admin/team-members/:id` | 🔒 Admin |
| `GET /api/admin/feedbacks` | 🔒 Admin |
| `PATCH /api/admin/feedbacks/:id/status` | 🔒 Admin |
| `DELETE /api/admin/feedbacks/:id` | 🔒 Admin |

A malformed `:id` (not a UUID, random junk) returns a clean **`404`**, not a `500` — the id columns are `TEXT`, so an unmatched lookup just returns null. You do not need to pre-validate ids.

---

## 5. ⭐ The upload flow — shared by Reviews and Team Members

Files do **not** pass through the Unilake backend. The browser uploads **directly to Cloudflare R2** using a short-lived presigned URL. Three steps:

```
┌─────────┐  1. POST /admin/<module>/upload-url      ┌─────────┐
│         │  { fileName, contentType }               │ Unilake │
│ Browser │ ───────────────────────────────────────► │ backend │
│         │ ◄─────────────────────────────────────── │         │
│         │       { uploadUrl, key }                 └─────────┘
│         │
│         │  2. PUT <uploadUrl>   (raw file bytes)   ┌─────────┐
│         │ ───────────────────────────────────────► │   R2    │
│         │ ◄─────────────────────────────────────── │ public  │
│         │              200 OK                      └─────────┘
│         │
│         │  3. POST /admin/<module>                 ┌─────────┐
│         │  { videoKey | imageKey: key }            │ Unilake │
│         │ ───────────────────────────────────────► │ backend │
│         │ ◄─────────────────────────────────────── │         │
└─────────┘   201 { id, ...Url, isActive, ... }      └─────────┘
```

**Step 2 does not create a database row.** Until step 3 runs, the file sits in the bucket and no record exists. Close the tab between 2 and 3 and you get an orphaned file in R2 that nothing references (harmless, but dead storage).

### 5.1 The two modules differ only in these four values

| | Customer Reviews | Team Members |
|---|---|---|
| Upload-URL path | `POST /api/admin/customer-reviews/upload-url` | `POST /api/admin/team-members/upload-url` |
| Accepted `contentType` | `^video/(mp4\|webm\|mov\|quicktime)$` | `^image/(png\|jpeg\|jpg\|webp)$` |
| Presigned URL lifetime | **30 minutes** ([customerReview.service.ts:9](src/services/customerReview.service.ts#L9)) | **15 minutes** ([teamMember.service.ts:8](src/services/teamMember.service.ts#L8)) |
| Key field in step 3 | `videoKey` (**required**) | `imageKey` (**optional**) |

Both target the **public** R2 bucket. Both sanitize `fileName` (`[^a-zA-Z0-9.-]` → `_`) and prefix a UUID, so collisions are impossible and you never need to make the name unique yourself.

### 5.2 Step 1 — request the URL

**Request body** (identical shape for both modules):

```json
{
  "fileName": "priya-testimonial.mp4",
  "contentType": "video/mp4"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `fileName` | `string` | ✅ | Min 1 char. Send `file.name` straight from the `<input type="file">`. Spaces and unicode are fine — they get replaced server-side. |
| `contentType` | `string` | ✅ | Must match the module's regex above. Send `file.type` from the File object. |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/unilake-public/customer-reviews/6f2b1a90-...-priya-testimonial.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=1800&X-Amz-Signature=...",
    "key": "customer-reviews/6f2b1a90-4c77-4d1e-9f0a-2b8e5c1d7a33-priya-testimonial.mp4"
  }
}
```

- `uploadUrl` — presigned `PUT` target. Never log it or persist it; the signature is a credential.
- `key` — hold onto this. It is the exact string you must send in step 3.

**Video MIME notes.** iPhone `.mov` files report as `video/quicktime`, which is accepted. `video/x-matroska` (`.mkv`), `video/avi` and `video/ogg` are **rejected** with a `400`. The regex also has no allowance for a codec parameter (`video/mp4; codecs="avc1"`), so forward `file.type` untouched rather than constructing the header by hand.

**Image MIME notes.** `image/heic` is **rejected** — photos straight off an iPhone will `400`. Convert client-side or show a clear "PNG, JPEG or WEBP only" message. `image/gif`, `image/avif` and `image/svg+xml` are also rejected.

### 5.3 Step 2 — `PUT` the file to R2

This request goes to **Cloudflare, not to us.** Getting it wrong is the #1 source of lost time in this flow:

```js
const res = await fetch(uploadUrl, {
  method: "PUT",                          // PUT — not POST
  headers: { "Content-Type": file.type }, // MUST equal the contentType from step 1
  body: file,                             // raw File/Blob — NOT FormData
});
if (!res.ok) throw new Error("Upload to R2 failed");
```

**The four ways this goes wrong:**

1. **`Content-Type` mismatch → `403 SignatureDoesNotMatch`.** The content type is baked into the signature ([r2.ts:144-148](src/lib/r2.ts#L144-L148)). Use the *same variable* for both calls; don't retype the string.
2. **Wrapping the file in `FormData` → corrupt file.** A presigned PUT takes raw bytes as the body. `FormData` adds multipart boundary junk that becomes part of the stored file. Pass the `File` object directly.
3. **Sending `credentials: "include"` or an `Authorization` header → `400`/`403`.** Do **not** reuse your authenticated API client for this call. R2 authorizes entirely by the query-string signature; cookies and auth headers conflict with it. Use a bare `fetch`/`XMLHttpRequest`.
4. **Letting the URL expire** (user picks a file, wanders off, then submits). Request the upload URL at submit time, not at file-select time.

**Success is `200` with an empty body.** There is nothing to parse. R2 errors come back as **XML**, not JSON — read `await res.text()` if you need the detail.

### 5.4 ⚠️ There is no server-side file size limit

`getSignedUploadUrl` sets no `ContentLength` condition ([r2.ts:131-154](src/lib/r2.ts#L131-L154)), so R2 will accept a file of any size. This matters most for **review videos**, which are the largest assets in the system.

The agreed approach is a text warning in the admin UI plus a trusted admin set. **Pair it with a hard `file.size` check before requesting the upload URL** — the realistic failure isn't a malicious admin, it's someone dropping in a 4K phone video and the upload hanging with no useful error:

```js
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // pick your number

if (file.size > MAX_VIDEO_BYTES) {
  toast.error("Video must be under 50 MB. Please compress it and try again.");
  return; // don't even request the upload URL
}
```

For real upload progress on a large video you need `XMLHttpRequest` — `fetch` has no upload progress event.

---

## 6. Customer Reviews

### 6.1 `GET /api/public/customer-reviews` — the testimonial feed

No auth, no query params. Returns `isActive: true` rows only, newest first.

```json
{
  "success": true,
  "data": [
    {
      "id": "c4e91f07-3b52-4a8d-95c1-7d0f6b2e4a19",
      "customerName": "Priya Menon",
      "description": "My daughter couldn't believe she was in the book.",
      "videoUrl": "https://pub-xxxx.r2.dev/customer-reviews/6f2b1a90-...-priya-testimonial.mp4",
      "isActive": true,
      "createdAt": "2026-08-14T10:22:41.660Z",
      "updatedAt": "2026-08-14T10:22:41.660Z"
    }
  ]
}
```

`videoUrl` is a direct public URL — drop it into `<video src>`, no signing or auth needed. `isActive` is always `true` here (it's the filter), so ignore it.

An empty array is a valid response. Handle it — hide the whole section rather than rendering an empty carousel.

**Rendering tip:** use `preload="none"` and a `poster` image. These are full-size uploads with no transcoding or thumbnail generation on the backend, so a page with five `<video preload="auto">` tags will pull tens of megabytes on load.

### 6.2 `GET /api/admin/customer-reviews` — list all

Same shape, but returns **every** row including `isActive: false`. Newest first. No pagination.

This is the endpoint the admin table reads. Show inactive rows greyed out with the toggle off — never filter them out client-side, or an admin who deactivates a review loses the ability to reactivate it.

### 6.3 `POST /api/admin/customer-reviews` — create

**Request body:**

```json
{
  "customerName": "Priya Menon",
  "description": "My daughter couldn't believe she was in the book.",
  "videoKey": "customer-reviews/6f2b1a90-4c77-4d1e-9f0a-2b8e5c1d7a33-priya-testimonial.mp4"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `customerName` | `string` | ✅ | Trimmed, min 1 char. No max length — see §11.2. |
| `description` | `string` | ✅ | Trimmed, min 1 char. No max length. |
| `videoKey` | `string` | ✅ | Min 1 char. Must be the **exact `key`** from §5.2. |

> ⚠️ **The server does not verify the key exists in R2.** It concatenates it onto the public base URL and saves the row. A typo, a truncated key, or the full `uploadUrl` instead of the `key` gives you a `201 Created` with a permanently broken video. Pass the `key` through untouched — never rebuild it, never substring it, never strip the `customer-reviews/` prefix.

**Response `201`:** the full row (same shape as §6.1). `isActive` is `true` by DB default.

**Errors:** `400 VALIDATION_ERROR`, `401`, `403`.

### 6.4 `PATCH /api/admin/customer-reviews/:id/status` — toggle active

**No request body.** Read §9 before wiring this to a Switch — it is a blind flip, not a setter.

**Response `200`:** the updated row. **`404`** if the id doesn't exist.

### 6.5 `DELETE /api/admin/customer-reviews/:id` — delete

**Response `204`, empty body.** **`404`** if the id doesn't exist.

The DB row is deleted **first**, then the R2 video is deleted best-effort inside a try/catch. A failed R2 delete leaves an orphaned file but still returns `204` — the row is gone either way. This is permanent and there is no undo; confirm in a dialog.

---

## 7. Team Members

### 7.1 `GET /api/public/team-members` — the "Our Team" feed

No auth, no query params. `isActive: true` only, newest first.

```json
{
  "success": true,
  "data": [
    {
      "id": "a71c8d33-9e04-4b6f-8c21-5f9a0e7d3b48",
      "name": "Rahul Sharma",
      "role": "Co-founder & Illustrator",
      "description": "Fifteen years drawing for children's publishing.",
      "imageUrl": "https://pub-xxxx.r2.dev/team-members/2b8e5c1d-...-rahul.webp",
      "linkedinUrl": "https://linkedin.com/in/rahulsharma",
      "instagramUrl": null,
      "twitterUrl": null,
      "isActive": true,
      "createdAt": "2026-08-11T09:14:02.110Z",
      "updatedAt": "2026-08-11T09:14:02.110Z"
    }
  ]
}
```

**Five fields are nullable and frequently null:** `description`, `imageUrl`, `linkedinUrl`, `instagramUrl`, `twitterUrl`. Type them `string | null` and guard every render — a member with no photo and no socials is a completely valid record. Render a fallback avatar (initials work well) rather than a broken `<img>`.

`name` and `role` are `NOT NULL` and always present.

### 7.2 `GET /api/admin/team-members` — list all

Same shape, every row including `isActive: false`. Newest first. No pagination.

### 7.3 `POST /api/admin/team-members` — create

**Request body:**

```json
{
  "name": "Rahul Sharma",
  "role": "Co-founder & Illustrator",
  "description": "Fifteen years drawing for children's publishing.",
  "imageKey": "team-members/2b8e5c1d-7a33-4c77-9f0a-6f2b1a904d1e-rahul.webp",
  "linkedinUrl": "https://linkedin.com/in/rahulsharma"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | ✅ | Trimmed, min 1 char |
| `role` | `string` | ✅ | Trimmed, min 1 char |
| `description` | `string` | ➖ | Trimmed, min 1 char **if present** |
| `imageKey` | `string` | ➖ | Min 1 char **if present**. Exact `key` from §5.2. |
| `linkedinUrl` | `string` | ➖ | Must be a valid URL **if present** |
| `instagramUrl` | `string` | ➖ | Must be a valid URL **if present** |
| `twitterUrl` | `string` | ➖ | Must be a valid URL **if present** |

> 🔴 **Omit optional fields — never send `""`.** On create, the optional fields are `.optional()` but **not** nullable, and they carry `.min(1)` / `.url()`. An empty string fails validation and the whole request `400`s.
>
> React Hook Form emits `""` for every untouched text input, so a form that submits its raw values will fail the moment the admin leaves the Instagram field blank. **Strip empty keys before sending:**
>
> ```ts
> const payload = Object.fromEntries(
>   Object.entries(formValues).filter(([, v]) => v !== "" && v != null)
> );
> ```
>
> `null` is also rejected on create. Omission is the only way to say "no value".

**Response `201`:** the full row. `isActive` is `true` by DB default.

### 7.4 `PATCH /api/admin/team-members/:id` — update ⭐

This is the only true update endpoint across all three modules, and its contract is the most important thing in this document.

**Request body — all fields optional, at least one required:**

```json
{
  "role": "Co-founder & Creative Director",
  "instagramUrl": null
}
```

| Field | Type | Clearable with `null`? | Rules |
|---|---|---|---|
| `name` | `string` | ❌ **No** | `NOT NULL` column. Trimmed, min 1. |
| `role` | `string` | ❌ **No** | `NOT NULL` column. Trimmed, min 1. |
| `description` | `string \| null` | ✅ Yes | Trimmed, min 1 if a string |
| `imageKey` | `string \| null` | ✅ Yes | Min 1 if a string |
| `linkedinUrl` | `string \| null` | ✅ Yes | Valid URL if a string |
| `instagramUrl` | `string \| null` | ✅ Yes | Valid URL if a string |
| `twitterUrl` | `string \| null` | ✅ Yes | Valid URL if a string |

#### The three-state contract — memorize this

| You send | Meaning | Result |
|---|---|---|
| **field omitted** | "leave it alone" | unchanged |
| **`null`** | "clear it" | column set to `NULL` |
| **`""`** | *nothing — this is an error* | `400 VALIDATION_ERROR` |

An empty string is never the way to clear a field. Your edit form must map blank inputs to `null` on update (and omit them entirely on create — the two forms need different serializers).

Sending `{}` returns a `400`. Note the exact message is `"Validation failed - : At least one field must be provided to update"` — the empty segment before the colon is real. `validateBody` builds messages as `` `${issue.path.join(".")}: ${issue.message}` ``, and a schema-level `.refine()` has an empty path. Don't string-match on it; read `error.code === "VALIDATION_ERROR"` instead.

#### 🔴 Only send `imageKey` when the file actually changed

`imageKey` on this endpoint means one of three things:

| You send | Result |
|---|---|
| omitted | photo unchanged, old file untouched |
| a **new** key | photo replaced, **old R2 file deleted** |
| `null` | photo removed, **old R2 file deleted** |

The backend guards on `oldUrl !== newUrl`, so re-submitting the **same** key is now safe and deletes nothing ([teamMember.service.ts:95-105](src/services/teamMember.service.ts#L95-L105)). Even so, only include `imageKey` when the admin picked a new file — it keeps intent explicit and avoids a pointless round trip.

> **Historical note:** before August 24, 2026 this guard was missing, and re-submitting an unchanged `imageKey` silently deleted the live photo from R2 while leaving the DB row pointing at it — a broken image with no error anywhere. Fixed. Mentioned so nobody reintroduces the "just send every field on save" pattern.

**Response `200`:** the full updated row. **`404`** if the id doesn't exist.

#### Worked example — an edit form serializer

```ts
type TeamMemberForm = {
  name: string;
  role: string;
  description: string;
  linkedinUrl: string;
  instagramUrl: string;
  twitterUrl: string;
};

function buildUpdatePayload(
  form: TeamMemberForm,
  newImageKey: string | null | undefined, // undefined = untouched
) {
  const clearable = [
    "description", "linkedinUrl", "instagramUrl", "twitterUrl",
  ] as const;

  const payload: Record<string, string | null> = {
    name: form.name,
    role: form.role,
  };

  // "" means the admin emptied the field → clear it with null.
  for (const key of clearable) {
    payload[key] = form[key].trim() === "" ? null : form[key];
  }

  // Only include imageKey when it actually changed.
  if (newImageKey !== undefined) {
    payload.imageKey = newImageKey; // a key, or null to remove the photo
  }

  return payload;
}
```

### 7.5 `PATCH /api/admin/team-members/:id/status` — toggle active

**No request body.** See §9. **Response `200`:** the updated row. **`404`** if missing.

### 7.6 `DELETE /api/admin/team-members/:id` — delete

**Response `204`, empty body.** **`404`** if missing. DB row deleted first, then the R2 photo best-effort. Permanent — confirm in a dialog.

---

## 8. Feedback

### 8.1 `POST /api/public/feedbacks` — submit the contact form

No auth. This is the only public **write** endpoint in this document.

**Request body:**

```json
{
  "name": "Ananya Rao",
  "email": "ananya@example.com",
  "phone": "+919876543210",
  "message": "Can I order a hardcover for a 3-year-old?"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | ✅ | Trimmed, min 1 char. **No max length** — see §11.2. |
| `email` | `string` | ✅ | Must be a valid email |
| `phone` | `string` | ✅ | Trimmed, min 1 char. **No format validation** — `"x"` is currently accepted. Validate format on the frontend. |
| `message` | `string` | ✅ | Trimmed, min 1 char. **No max length.** |

**Response `201`:** the created row, including `id` and `status: "OPEN"`.

```json
{
  "success": true,
  "data": {
    "id": "9d3f1b40-6c22-4e5a-b7f1-0a8c3e2d6b95",
    "name": "Ananya Rao",
    "email": "ananya@example.com",
    "phone": "+919876543210",
    "message": "Can I order a hardcover for a 3-year-old?",
    "status": "OPEN",
    "createdAt": "2026-08-24T11:02:18.004Z",
    "updatedAt": "2026-08-24T11:02:18.004Z"
  }
}
```

You almost certainly don't need the response body — just show a thank-you state on `201`.

> ⚠️ **Nothing rate-limits this endpoint and there is no captcha.** Add a honeypot field and a client-side submit lock at minimum. Enforce your own `maxLength` on the textarea (the request is capped at ~100 KB by `express.json()`'s default, which is not a helpful limit for a contact form).

### 8.2 `GET /api/admin/feedbacks` — list, optionally filtered

**Query params:**

| Param | Type | Required | Values |
|---|---|---|---|
| `status` | `string` | ➖ | `OPEN` \| `VIEWED` \| `RESOLVED` \| `DISMISSED` |

Omit `status` to get everything. An invalid value returns `400 VALIDATION_ERROR` with `"Query error: Invalid status. Must be OPEN, VIEWED, RESOLVED, or DISMISSED."`

Newest first. **No pagination, no search, no date filter.** See §11.1.

```json
{
  "success": true,
  "data": [
    {
      "id": "9d3f1b40-6c22-4e5a-b7f1-0a8c3e2d6b95",
      "name": "Ananya Rao",
      "email": "ananya@example.com",
      "phone": "+919876543210",
      "message": "Can I order a hardcover for a 3-year-old?",
      "status": "OPEN",
      "createdAt": "2026-08-24T11:02:18.004Z",
      "updatedAt": "2026-08-24T11:02:18.004Z"
    }
  ]
}
```

This payload contains **customer PII** (email, phone). It's admin-guarded, but don't log it, don't put it in analytics, and don't cache it anywhere shared.

### 8.3 `PATCH /api/admin/feedbacks/:id/status` — triage

Unlike the other two modules' status routes, this one **takes a body** and is a proper setter, not a toggle.

**Request body:**

```json
{ "status": "RESOLVED" }
```

| Field | Type | Required | Values |
|---|---|---|---|
| `status` | `string` | ✅ | `OPEN` \| `VIEWED` \| `RESOLVED` \| `DISMISSED` |

Any value is reachable from any other — there is no enforced workflow, so `RESOLVED → OPEN` is allowed. Anything outside the four returns `400 "Validation failed - status: Status must be OPEN, VIEWED, RESOLVED, or DISMISSED"`.

**Response `200`:** the updated row. **`404`** if missing.

Because it's idempotent, this one is safe to fire optimistically. A dropdown per row works well.

### 8.4 `DELETE /api/admin/feedbacks/:id` — delete

**Response `204`, empty body.** **`404`** if missing. No R2 involvement. Permanent — confirm in a dialog, and prefer `DISMISSED` over deletion so the record survives.

---

## 9. ⚠️ The status toggle — read before building any Switch

`PATCH /:id/status` on **Customer Reviews** and **Team Members** takes no body and flips the current value:

```ts
data: { isActive: !existing.isActive }
```

It is a **blind flip, not a setter.** Three consequences:

1. **It is not idempotent.** Two clicks return to the original state. A double-click on a Switch silently undoes itself.
2. **A stale list flips the wrong way.** If the row changed elsewhere (another tab, another admin) since your last fetch, clicking "activate" performs a deactivate.
3. **It's a read-modify-write**, so two simultaneous toggles can both land on the same value.

**What your UI must do:**

```tsx
const [pending, setPending] = useState(false);

async function onToggle() {
  if (pending) return;          // 1. block double-fire
  setPending(true);
  try {
    const updated = await toggleStatus(row.id);
    setRow(updated);            // 2. trust the server, not !row.isActive
  } finally {
    setPending(false);
  }
}

<Switch checked={row.isActive} disabled={pending} onCheckedChange={onToggle} />
```

- **Disable the control while the request is in flight.**
- **Set the new state from the response body**, which is the full updated row — never from an optimistic `!current`.
- If you want optimistic UI anyway, still reconcile against the response and roll back on error.

`PATCH /feedbacks/:id/status` is exempt — it takes an explicit value and is idempotent.

---

## 10. Quick reference

| Method | Path | Guard | Body | Success |
|---|---|---|---|---|
| `GET` | `/api/public/customer-reviews` | 🟢 | — | `200` array |
| `GET` | `/api/admin/customer-reviews` | 🔒 | — | `200` array |
| `POST` | `/api/admin/customer-reviews/upload-url` | 🔒 | `{ fileName, contentType }` | `200` `{ uploadUrl, key }` |
| `POST` | `/api/admin/customer-reviews` | 🔒 | `{ customerName, description, videoKey }` | `201` row |
| `PATCH` | `/api/admin/customer-reviews/:id/status` | 🔒 | *none* | `200` row |
| `DELETE` | `/api/admin/customer-reviews/:id` | 🔒 | — | `204` empty |
| `GET` | `/api/public/team-members` | 🟢 | — | `200` array |
| `GET` | `/api/admin/team-members` | 🔒 | — | `200` array |
| `POST` | `/api/admin/team-members/upload-url` | 🔒 | `{ fileName, contentType }` | `200` `{ uploadUrl, key }` |
| `POST` | `/api/admin/team-members` | 🔒 | `{ name, role, ...optional }` | `201` row |
| `PATCH` | `/api/admin/team-members/:id` | 🔒 | ≥1 field, `null` clears | `200` row |
| `PATCH` | `/api/admin/team-members/:id/status` | 🔒 | *none* | `200` row |
| `DELETE` | `/api/admin/team-members/:id` | 🔒 | — | `204` empty |
| `POST` | `/api/public/feedbacks` | 🟢 | `{ name, email, phone, message }` | `201` row |
| `GET` | `/api/admin/feedbacks?status=` | 🔒 | — | `200` array |
| `PATCH` | `/api/admin/feedbacks/:id/status` | 🔒 | `{ status }` | `200` row |
| `DELETE` | `/api/admin/feedbacks/:id` | 🔒 | — | `204` empty |

### Types

```ts
type ApiResponse<T> = { success: true; data: T };
type ApiError = { success: false; error: { code: string; message: string } };

export type CustomerReview = {
  id: string;
  customerName: string;
  description: string;
  videoUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  imageUrl: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackStatus = "OPEN" | "VIEWED" | "RESOLVED" | "DISMISSED";

export type Feedback = {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
};
```

`createdAt` / `updatedAt` arrive as ISO 8601 strings, not `Date` objects.

---

## 11. Gotchas checklist

**Everywhere**

- ☐ Read `json.data`, never `json`. No endpoint here returns a `message`.
- ☐ `credentials: "include"` / `withCredentials: true` on every `/api/admin/*` call.
- ☐ `DELETE` returns bare `204` — don't parse a body.
- ☐ Admin lists return inactive rows too. **Render them, don't filter them** — filtering makes deactivated records unreachable forever.
- ☐ Empty arrays are valid. Hide the public section rather than rendering an empty shell.
- ☐ No single-item `GET`. Open modals from the row you already hold.
- ☐ Toggle endpoints are blind flips — disable while pending, trust the response (§9).

**Uploads**

- ☐ `PUT` the raw `File`, not `FormData`, with the exact same `Content-Type`.
- ☐ Bare `fetch` for the R2 `PUT` — no cookies, no auth headers.
- ☐ Pass the returned `key` through untouched into step 3.
- ☐ Request the upload URL at submit time, not at file-select time.
- ☐ Enforce your own file size limit — the server has none (§5.4).
- ☐ `image/heic` and `video/x-matroska` are rejected. Handle the `400` with a readable message.

**Team member forms**

- ☐ **Create:** omit blank optional fields. Never send `""` or `null`.
- ☐ **Update:** send `null` to clear. Never send `""`.
- ☐ **Update:** only include `imageKey` when the file actually changed.
- ☐ `name` and `role` can never be cleared — `null` on either is a `400`.
- ☐ `{}` is a `400`. Disable Save when nothing changed.

**Feedback**

- ☐ Add a honeypot + submit lock to the public form; nothing rate-limits it.
- ☐ Enforce `maxLength` on the message textarea yourself.
- ☐ Validate phone format on the frontend — the backend only checks it's non-empty.
- ☐ Treat the admin list as PII. No logging, no analytics, no shared cache.
- ☐ Prefer `DISMISSED` over `DELETE`.

---

## 12. Open items raised with backend

These are known and accepted, not bugs to report. Build around them.

### 12.1 No pagination or indexes on any of the three

All three admin lists are bare `findMany` ordered `createdAt: "desc"` with no `take`/`skip`, and there are no indexes on `team_members`, `customer_reviews` or `feedbacks` beyond the primary key.

Reviews and team members are curated and small — genuinely fine. **Feedback is the one that grows unbounded**, from an unauthenticated public endpoint. Build the feedback table so pagination can be added later without a rewrite: keep the query in a hook, don't assume the whole list is in memory, and lean on the `?status=` filter as the primary way to narrow it.

### 12.2 No max length on any text field

`customerName`, `description`, and all four feedback fields validate presence but not size. This breaks the codebase's own convention (`comic.title` is `.max(255)`, `country.name` is `.max(100)`, `savedAddress.line2` is `.max(200)`).

`express.json()`'s 100 KB default bounds any single request, so it isn't a memory risk — but until `.max()` bounds land, **the frontend is the only length limit that exists.** Set `maxLength` on every input and truncate long values in table cells.

### 12.3 Display order is fixed and not controllable

Both public feeds are hard-sorted newest-first. There is no `sortOrder` column and no reorder endpoint — unlike `AnnouncementBar`, which has both.

If the client asks to pin a founder to the top of "Our Team" or feature a specific review, **there is no API for it.** Adding one means a migration plus a new endpoint per module. Worth confirming the requirement before the UI is built, because retrofitting drag-and-drop later touches both modules.

### 12.4 Public feeds return the full row

`GET /api/public/customer-reviews` and `/team-members` return every Prisma column, including `isActive` (always `true`) and `updatedAt`. Nothing sensitive lives on these models so it's harmless — just inconsistent with `GET /api/public/countries`, which uses an explicit `select` specifically so `isActive` never leaks. Don't rely on these extra fields; they may be trimmed later.

### 12.5 No transcoding or thumbnails for review videos

The uploaded file is served as-is. No poster frame is generated, no lower-bitrate variant exists. Supply your own `poster` image and use `preload="none"`.

---

## 13. Backend reference

| Piece | Location |
|---|---|
| Admin routes | [src/routes/admin.ts:276-319](src/routes/admin.ts#L276-L319) |
| Public routes | [src/routes/public.ts:50-63](src/routes/public.ts#L50-L63) |
| Customer review controller | `src/controllers/customerReview.controller.ts` |
| Customer review service | `src/services/customerReview.service.ts` |
| Customer review validator | `src/validators/customerReview.schema.ts` |
| Team member controller | `src/controllers/teamMember.controller.ts` |
| Team member service | `src/services/teamMember.service.ts` |
| Team member validator | `src/validators/teamMember.schema.ts` |
| Feedback controller | `src/controllers/feedback.controller.ts` |
| Feedback service | `src/services/feedback.service.ts` |
| Feedback validator | `src/validators/feedback.schema.ts` |
| R2 helpers | `src/lib/r2.ts` |
| Models | `CustomerReview`, `TeamMember`, `Feedback` in `prisma/schema.prisma` |

### Related guides

- `HERO_IMAGES_API.md` — same upload flow, same toggle pattern, more depth on upload optimization
- `ANNOUNCEMENTS_API.md` — the one CMS module that *does* have reorder, if you need a reference for §12.3
- `COUNTRIES_API.md` — the explicit-`select` public endpoint referenced in §12.4
