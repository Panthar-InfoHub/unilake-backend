# How It Works, FAQ & Blog — Frontend Integration Guide

Three content modules added August 24, 2026. Written for the frontend team.

Pulled from route files, controllers, services, Zod validators and `schema.prisma` — not from intent docs. Where a doc and the code disagreed, the code won.

**Last updated:** August 24, 2026

---

## 1. What these three are

| Module | What it holds | Where the public sees it |
|---|---|---|
| **How It Works** | One video + poster, and an ordered list of numbered steps | Homepage explainer section |
| **FAQ** | Two **independent** question/answer lists, split by placement | Homepage **and** every comic detail page |
| **Blog** | Title, slug, HTML article body, cover image, excerpt, tags | Blog index + individual article pages |

Each is structurally different from the others, and from anything in `REVIEWS_TEAM_FEEDBACK_API.md`:

- **How It Works is a singleton.** One row, ever. There is no create, no delete, and no `:id` anywhere — a single `PATCH` creates it on first call and updates it thereafter.
- **FAQ is two lists in one table.** `placement: "HOME"` and `placement: "COMIC"` are completely unrelated sets. The COMIC set is **general to all comics** — the same list renders on every comic page. There is no per-comic FAQ.
- **Blog is the only module with a public detail route**, and the only one keyed by something other than an id (a slug).

### Deliberate absences — do not go looking for these endpoints

- **No `POST` or `DELETE` for How It Works.** It is a singleton; `PATCH` upserts it, and `isActive: false` hides it.
- **No `/status` toggle for How It Works.** `isActive` is a field in the normal `PATCH` body — which also makes it an idempotent setter rather than a blind flip. It is the one exception to §9.
- **No per-comic FAQs.** `Faq` has no relation to `Comic`. If the client later wants comic-specific questions, that is a migration plus new endpoints.
- **No `slug` field on the blog update endpoint.** The slug is generated at create and frozen forever. See §8.5.
- **No `publishedAt` on Blog.** The card date is `createdAt`. See §12.2.
- **No admin single-item `GET` for How It Works or FAQ.** Only Blog has one, because its `body` is too large to ship in a list.

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

**None of the endpoints in this document return a `message` field.** Don't render off it.

`DELETE` returns a bare **`204` with an empty body** — never call `res.json()` on it.

> ⚠️ **`data` can legitimately be `null`.** `GET /api/public/how-it-works` and `GET /api/admin/how-it-works` both return `{ "success": true, "data": null }` when the section has never been configured. That is a success, not an error. If your API client asserts `data` is non-null, this will break.

Error codes here: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_SERVER_ERROR` (500).

---

## 4. Admin access (recap)

Everything under `/api/admin/*` runs through `requireAdmin`: no valid Better Auth session → `401`; valid session but `role !== "ADMIN"` → `403`.

**No bearer token. Auth is an httpOnly cookie.** Every admin call needs `credentials: "include"` (fetch) or `withCredentials: true` (axios).

| Endpoint | Guard |
|---|---|
| `GET /api/public/how-it-works` | 🟢 **None** |
| `GET /api/public/faqs?placement=` | 🟢 **None** |
| `GET /api/public/blogs` | 🟢 **None** |
| `GET /api/public/blogs/:slug` | 🟢 **None** |
| `GET /api/admin/how-it-works` | 🔒 Admin |
| `POST /api/admin/how-it-works/upload-url` | 🔒 Admin |
| `PATCH /api/admin/how-it-works` | 🔒 Admin |
| `GET /api/admin/faqs?placement=` | 🔒 Admin |
| `POST /api/admin/faqs` | 🔒 Admin |
| `PATCH /api/admin/faqs/reorder` | 🔒 Admin |
| `PATCH /api/admin/faqs/:id` | 🔒 Admin |
| `PATCH /api/admin/faqs/:id/status` | 🔒 Admin |
| `DELETE /api/admin/faqs/:id` | 🔒 Admin |
| `GET /api/admin/blogs?isActive=` | 🔒 Admin |
| `GET /api/admin/blogs/:id` | 🔒 Admin |
| `POST /api/admin/blogs/upload-url` | 🔒 Admin |
| `POST /api/admin/blogs` | 🔒 Admin |
| `PATCH /api/admin/blogs/:id` | 🔒 Admin |
| `PATCH /api/admin/blogs/:id/status` | 🔒 Admin |
| `DELETE /api/admin/blogs/:id` | 🔒 Admin |

A malformed `:id` returns a clean **`404`**, not a `500` — the id columns are `TEXT`, so an unmatched lookup just returns null. You do not need to pre-validate ids.

---

## 5. The upload flow — How It Works and Blog

Same three-step presigned-R2 pattern as reviews and team members. If you have already built one of those uploaders, this is the same code with different values.

```
1. POST /admin/<module>/upload-url   { fileName, contentType }  ->  { uploadUrl, key }
2. PUT  <uploadUrl>                  raw File bytes             ->  200, empty body
3. PATCH/POST /admin/<module>        { <someKey>: key }         ->  row with the resolved URL
```

**Step 2 does not create a database row.** Abandon between 2 and 3 and you get an orphaned file in R2 — harmless, just dead storage.

### 5.1 The three upload endpoints in this document

| | How It Works (video) | How It Works (poster) | Blog (cover **and** body images) |
|---|---|---|---|
| Path | `POST /api/admin/how-it-works/upload-url` | same path | `POST /api/admin/blogs/upload-url` |
| Discriminator | `assetType: "video"` | `assetType: "poster"` | *none* |
| Accepted `contentType` | `^video/(mp4\|webm\|mov\|quicktime)$` | `^image/(png\|jpeg\|jpg\|webp)$` | `^image/(png\|jpeg\|jpg\|webp)$` |
| URL lifetime | **30 min** ([howItWorks.service.ts:13](src/services/howItWorks.service.ts#L13)) | **15 min** ([howItWorks.service.ts:14](src/services/howItWorks.service.ts#L14)) | **15 min** ([blog.service.ts:13](src/services/blog.service.ts#L13)) |
| Key prefix | `how-it-works/{uuid}-{name}` | same | `blogs/{uuid}-{name}` |
| Key field in step 3 | `videoKey` | `posterKey` | `coverImageKey` (or paste the URL into the body) |

All target the **public** R2 bucket. All sanitize `fileName` (`[^a-zA-Z0-9.-]` → `_`) and prefix a UUID, so you never need to make the filename unique.

### 5.2 How It Works: `assetType` is required and it matters

Unlike every other upload endpoint in this codebase, this one takes a third field:

```json
{
  "assetType": "video",
  "fileName": "how-it-works.mp4",
  "contentType": "video/mp4"
}
```

`assetType` is `"video" | "poster"` and it is validated as a **discriminated union** — the accepted `contentType` depends on it. Sending `{ assetType: "video", contentType: "image/png" }` is a `400`. Send the pair that belongs together.

### 5.3 Step 2 — `PUT` the file to R2

Identical to the reviews/team-members flow. The four ways it goes wrong, verbatim, because they cost the most time:

1. **`Content-Type` mismatch → `403 SignatureDoesNotMatch`.** The content type is baked into the signature ([r2.ts:144-148](src/lib/r2.ts#L144-L148)). Use the *same variable* for both calls.
2. **Wrapping the file in `FormData` → corrupt file.** Pass the raw `File` object as the body.
3. **Sending `credentials: "include"` or an `Authorization` header → `400`/`403`.** Use a bare `fetch`, not your authenticated API client.
4. **Letting the URL expire.** Request it at submit time, not at file-select time.

**Success is `200` with an empty body.** R2 errors come back as **XML**, not JSON.

### 5.4 ⚠️ Still no server-side file size limit

`getSignedUploadUrl` sets no `ContentLength` condition ([r2.ts:131-154](src/lib/r2.ts#L131-L154)). The How It Works **video** is the largest asset in these three modules — enforce a `file.size` ceiling before requesting the upload URL, or a 4K phone video will hang the upload with no useful error:

```js
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

if (file.size > MAX_VIDEO_BYTES) {
  toast.error("Video must be under 50 MB. Please compress it and try again.");
  return; // don't even request the upload URL
}
```

For real upload progress you need `XMLHttpRequest` — `fetch` has no upload progress event.

---

## 6. How It Works

A singleton row: one video, one poster, and an ordered array of steps. Matches the homepage design of a video on the left and numbered steps on the right.

### 6.1 ⭐ `steps` is a JSON column, not a table

This is the single most important thing to understand about this module.

```json
"steps": [
  { "heading": "Introduce Your Child",   "description": "Start by giving us a few details..." },
  { "heading": "AI-Powered Face Mapping", "description": "Our AI analyzes your child's photos..." }
]
```

Consequences:

- **Array position IS the step number.** The `1`, `2`, `3` badges in the design are `index + 1`. There is no `sortOrder`, no step id, and no reorder endpoint.
- **You always send the whole array.** There is no "add one step" or "delete step 3" endpoint. To change anything, `PATCH` the complete array. Same rule as `Comic.coverThumbnailUrls`.
- **There is no count limit.** The validator caps `heading` at 120 chars and `description` at 500 chars per step, but you can send as many steps as you like.
- **The shape is enforced by Zod only.** Prisma types this column as `JsonValue` and knows nothing about it. If you send `[{ "foo": "bar" }]` it is a `400`, but nothing at the database level would have stopped it.

### 6.2 ⭐ The readiness rule — this will look like a bug

`GET /api/public/how-it-works` returns `null` unless **all three** are true ([howItWorks.service.ts:63](src/services/howItWorks.service.ts#L63)):

1. `isActive` is `true`, **and**
2. `videoUrl` is set, **and**
3. `steps` has at least one entry

A section with steps saved but no video uploaded yet returns `null` publicly — even with `isActive: true`. The admin endpoint still returns it, so the admin can keep editing.

> 🔴 **Whoever tests this first will report it as a bug.** "I saved the section, it's active, and nothing shows on the homepage." The cause is almost always a missing video. Surface a readiness indicator in the admin UI — something like *"This section is not visible yet: upload a video"* — or you will field this question repeatedly.

### 6.3 `GET /api/public/how-it-works`

No auth, no query params.

```json
{
  "success": true,
  "data": {
    "id": "e2f1a904-...",
    "videoUrl": "https://pub-xxxx.r2.dev/how-it-works/6f2b-how.mp4",
    "posterUrl": "https://pub-xxxx.r2.dev/how-it-works/2b8e-poster.webp",
    "steps": [
      { "heading": "Introduce Your Child", "description": "Start by giving us a few details..." }
    ],
    "isActive": true,
    "createdAt": "2026-08-24T10:22:41.660Z",
    "updatedAt": "2026-08-24T10:22:41.660Z"
  }
}
```

**Returns `data: null`** when the section has never been configured, is inactive, or fails the readiness rule. Hide the whole section on `null` — do not render an empty shell.

**Rendering the video:**

```tsx
<video src={data.videoUrl} poster={data.posterUrl ?? undefined} preload="none" controls />
```

`posterUrl` is nullable. Without it the browser must download part of the video just to paint a frame, and often shows black — which is exactly why the poster field exists. Use `preload="none"`.

### 6.4 `GET /api/admin/how-it-works`

Same shape, but **no `isActive` filter and no readiness check**. Returns `data: null` only before the very first save. This is what the admin edit form loads.

### 6.5 `PATCH /api/admin/how-it-works` — the single save endpoint

Creates the row on the first call, updates it on every call after. There is no `:id`.

**Request body — all fields optional, at least one required:**

```json
{
  "videoKey": "how-it-works/6f2b1a90-...-how.mp4",
  "posterKey": "how-it-works/2b8e5c1d-...-poster.webp",
  "steps": [
    { "heading": "Introduce Your Child", "description": "Start by giving us a few details..." }
  ],
  "isActive": true
}
```

| Field | Type | Clearable with `null`? | Rules |
|---|---|---|---|
| `videoKey` | `string \| null` | ✅ Yes | Min 1 if a string. Exact `key` from §5.1. |
| `posterKey` | `string \| null` | ✅ Yes | Min 1 if a string. |
| `steps` | `array` | ❌ (send `[]` to empty it) | Each item needs `heading` (1–120) and `description` (1–500) |
| `isActive` | `boolean` | ❌ | Plain setter — not a toggle |

**The three-state contract applies to both asset keys**, same as team member images:

| You send | Meaning | Result |
|---|---|---|
| **field omitted** | leave it alone | unchanged, old R2 file untouched |
| **a key** | replace | new URL stored, **old R2 file deleted** |
| **`null`** | clear | column set to `NULL`, **old R2 file deleted** |

The backend guards on `oldUrl !== newUrl`, so re-submitting the **same** key is safe and deletes nothing. Still, only include a key when the admin actually picked a new file.

Sending `{}` returns a `400`. The exact message is `"Validation failed - : At least one field must be provided to update"` — the empty segment before the colon is real, because a schema-level `.refine()` has an empty path. Read `error.code`, don't string-match.

**Response `200`:** the full row, on both the create and the update path. There is no `201` — the caller cannot predict which branch ran, so a conditional status would just be noise.

#### Worked example — the save serializer

```ts
type HowItWorksForm = {
  steps: { heading: string; description: string }[];
  isActive: boolean;
};

function buildSavePayload(
  form: HowItWorksForm,
  newVideoKey: string | null | undefined,  // undefined = untouched
  newPosterKey: string | null | undefined,
) {
  const payload: Record<string, unknown> = {
    steps: form.steps,          // always the complete array
    isActive: form.isActive,
  };

  // Only include the asset keys when they actually changed.
  if (newVideoKey !== undefined) payload.videoKey = newVideoKey;
  if (newPosterKey !== undefined) payload.posterKey = newPosterKey;

  return payload;
}
```

---

## 7. FAQ

Two independent lists in one table, separated by `placement`. Both are global — the `COMIC` set renders identically on **every** comic detail page.

### 7.1 `GET /api/public/faqs?placement=` — 🔴 the param is REQUIRED

```
GET /api/public/faqs?placement=HOME    ← homepage: general questions about the website
GET /api/public/faqs?placement=COMIC   ← every comic page: general questions about comics
```

**Omitting `placement` is a `400`**, not a "return everything":

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Query error: placement must be HOME or COMIC" }
}
```

This is deliberate — a page that forgets the param fails loudly instead of quietly rendering the other set's questions.

**Response `200`** — active rows only, sorted by `sortOrder` ascending:

```json
{
  "success": true,
  "data": [
    {
      "id": "9d3f1b40-6c22-4e5a-b7f1-0a8c3e2d6b95",
      "placement": "HOME",
      "question": "How long does delivery take?",
      "answer": "Most orders ship within 5 working days.",
      "sortOrder": 0,
      "isActive": true,
      "createdAt": "2026-08-24T11:02:18.004Z",
      "updatedAt": "2026-08-24T11:02:18.004Z"
    }
  ]
}
```

> ⚠️ **`answer` is PLAIN TEXT, not HTML.** Render it as `{answer}` inside a `<p>`, never with `dangerouslySetInnerHTML`. It cannot contain links or formatting — if an admin pastes `<a href="...">` it will display as literal angle brackets. This is the opposite of `Blog.body`, which *is* HTML. Do not mix them up.

An empty array is valid. Hide the accordion rather than rendering an empty one.

### 7.2 `GET /api/admin/faqs?placement=` — list

Here `placement` is **optional**. Omit it to get both sets in one call (each row carries its own `placement`, so you can tab them client-side). Includes inactive rows.

### 7.3 `POST /api/admin/faqs` — create

```json
{
  "placement": "HOME",
  "question": "How long does delivery take?",
  "answer": "Most orders ship within 5 working days."
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `placement` | `"HOME" \| "COMIC"` | ✅ | |
| `question` | `string` | ✅ | Trimmed, min 1. **No max length** — see §12.1. |
| `answer` | `string` | ✅ | Trimmed, min 1. **No max length.** Plain text. |

`sortOrder` and `isActive` are **not accepted**. `sortOrder` is computed server-side as `max + 1` **within that placement**, so a new FAQ always lands at the bottom of its own list. `isActive` defaults to `true` and is owned by the `/status` route.

**Response `201`:** the full row.

### 7.4 `PATCH /api/admin/faqs/:id` — update

```json
{ "question": "Updated question?", "placement": "COMIC" }
```

All three fields are optional, at least one required. `{}` is a `400`.

#### ⭐ Changing `placement` moves the FAQ to the bottom of the destination list

If `placement` changes, the backend recomputes `sortOrder` as `max + 1` of the target set, so the entry lands predictably at the end.

**If `placement` is sent but unchanged, nothing happens** — the backend guards on `old !== new`. This matters because an edit form that resends every field on save would otherwise reshuffle the list on every keystroke-then-save. Same bug class as the team member image issue.

**Response `200`:** the full updated row. **`404`** if the id doesn't exist.

### 7.5 ⭐ `PATCH /api/admin/faqs/reorder` — strict, and the body is just IDs

```json
{ "orderedIds": ["id-3", "id-1", "id-2"] }
```

**There is no `placement` in the body.** The backend infers it from the rows themselves. But the validation is strict — three ways this `400`s:

| Failure | Message |
|---|---|
| Any ID doesn't exist | `"One or more FAQ IDs do not exist"` |
| IDs span both placements | `"All FAQs in a reorder must belong to the same placement"` |
| Not the complete list | `"Reorder must include every FAQ for HOME (expected 7, received 5)"` |

> 🔴 **The completeness check counts INACTIVE rows too.** If the HOME set has 5 active and 2 inactive FAQs, you must send all **7** ids. This is the mistake a drag-and-drop UI makes when it renders only active rows — build the reorder list from the full admin list, not a filtered view.

Also: `orderedIds` must contain no duplicates, and each must be a valid UUID.

**Response `200`:** the re-listed set for that placement, in the new order. `sortOrder` is rewritten to `0..n` by array position.

### 7.6 `PATCH /api/admin/faqs/:id/status` — toggle active

**No request body.** A blind flip — read §9 before wiring a Switch.

### 7.7 `DELETE /api/admin/faqs/:id`

**`204`, empty body.** **`404`** if missing. No R2, no reference guards. Surviving rows are **not** renumbered, so gaps in `sortOrder` (0, 1, 3, 4) are normal and harmless — sorting is by value, not contiguity.

---

## 8. Blog

The only module here with a public detail route, a slug, and an HTML body.

### 8.1 🔴 `body` is HTML — you MUST sanitize it before rendering

`Blog.body` is raw HTML produced by a rich-text editor and stored verbatim. The backend does **no sanitization** — the validator only checks `min(1)`.

```tsx
import DOMPurify from "dompurify";

<article
  className="prose"
  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(blog.body) }}
/>
```

**Sanitize on render, not just on write.** Sanitizing only on the way in means one bad row already in the database stays dangerous forever. Yes, only admins can write it — but "only trusted people can reach this" is exactly the assumption that fails when an admin account is compromised or someone pastes formatted content from a sketchy source.

**You will also need `@tailwindcss/typography`.** Tailwind's preflight resets `<h2>`, `<p>` and `<ul>` to identical bare text, and the editor's output is exactly those tags. Without the `prose` class the published article renders as an undifferentiated wall of text. That plugin is **not currently installed** in the frontend.

### 8.2 `GET /api/public/blogs` — the index

No auth, no query params. Published posts only (`isActive: true`), newest first.

> ⚠️ **`body` is NOT included in list responses.** Both `GET /api/public/blogs` and `GET /api/admin/blogs` use an explicit `select` that omits it ([blog.service.ts:18](src/services/blog.service.ts#L18)). Render cards from `excerpt`, not from a truncated body — you don't have the body here, and truncating HTML would cut mid-tag anyway.

```json
{
  "success": true,
  "data": [
    {
      "id": "c4e91f07-3b52-4a8d-95c1-7d0f6b2e4a19",
      "slug": "how-we-make-your-comic",
      "title": "How We Make Your Comic",
      "excerpt": "A look behind the scenes at our AI pipeline.",
      "coverImageUrl": "https://pub-xxxx.r2.dev/blogs/6f2b-cover.webp",
      "tags": ["behind-the-scenes", "ai"],
      "isActive": true,
      "createdAt": "2026-08-24T10:22:41.660Z",
      "updatedAt": "2026-08-24T10:22:41.660Z"
    }
  ]
}
```

`excerpt` and `coverImageUrl` are **nullable**. Guard both — render a fallback card without an image, and skip the excerpt line entirely rather than showing an empty paragraph.

### 8.3 `GET /api/public/blogs/:slug` — one article

**Looked up by slug, not id** — the slug is what's in the URL.

Returns the full row **including `body`**. **`404`** if the slug doesn't exist **or** the post is unpublished — the two are deliberately indistinguishable, so drafts don't leak their existence. Same reasoning as the public comic detail endpoint.

### 8.4 `GET /api/admin/blogs?isActive=` — list

`isActive` is optional: `?isActive=true` for published only, `?isActive=false` for drafts, omitted for everything. Any other value is a `400` (`"isActive must be true or false"`).

Same `body`-excluding shape as §8.2, but includes drafts.

### 8.5 ⭐ `POST /api/admin/blogs` — create, and the slug is generated here

```json
{
  "title": "How We Make Your Comic",
  "excerpt": "A look behind the scenes at our AI pipeline.",
  "body": "<h2>Meet Aarav</h2><p>Every book starts with <strong>one photo</strong>.</p>",
  "coverImageKey": "blogs/6f2b1a90-...-cover.webp",
  "tags": ["Behind The Scenes", "AI"]
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `title` | `string` | ✅ | Trimmed, 1–200 chars |
| `body` | `string` | ✅ | Min 1. HTML from the editor. |
| `excerpt` | `string` | ➖ | Trimmed, 1–300 chars **if present** |
| `coverImageKey` | `string` | ➖ | Min 1 **if present**. Exact `key` from §5.1. |
| `tags` | `string[]` | ➖ | Max 8 entries, each 1–30 chars |

**The slug is derived from `title` and returned in the response.** You do not send it and you cannot choose it.

- `"How We Make Your Comic"` → `how-we-make-your-comic`
- A collision appends a suffix: `how-we-make-your-comic-2`, `-3`, …
- **Everything outside `a-z0-9` is stripped, not transliterated.** `"Ünïcödé Tïtlé"` becomes `n-c-d-t-tl`, and a title in Devanagari strips to empty and falls back to `post`, `post-2`, … See §12.4.

**`tags` are lowercased and trimmed automatically.** `["Behind The Scenes", "AI"]` is stored as `["behind the scenes", "ai"]`.

> ⚠️ **Duplicate tags are NOT removed.** `["SEO", "seo"]` normalizes to `["seo", "seo"]` and is stored with the duplicate. Deduplicate in the tag input before sending.

**`isActive` is not accepted and defaults to `false`** — a new post is never live while it's being written. Publish it with `/status`.

**Omit optional fields — never send `""`.** `excerpt` and `coverImageKey` are `.optional()` but not nullable on create, and carry `.min(1)`. An empty string is a `400`. Strip empty keys before sending, same as the team member create form.

**Response `201`:** the full row including `slug` and `body`.

**`409 CONFLICT`** is possible in one narrow case: two admins creating posts with the same title at the same instant. Rare, and the fix is to retry.

### 8.6 `PATCH /api/admin/blogs/:id` — update

```json
{ "title": "A Better Title", "excerpt": null }
```

| Field | Type | Clearable with `null`? |
|---|---|---|
| `title` | `string` | ❌ No |
| `body` | `string` | ❌ No |
| `excerpt` | `string \| null` | ✅ Yes |
| `coverImageKey` | `string \| null` | ✅ Yes |
| `tags` | `string[]` | ❌ (send `[]` to empty it) |

> 🔴 **`slug` is not accepted here, and editing the title does NOT change the slug.** The slug is frozen at create so a shared link never 404s. Sending `{ "slug": "anything" }` does not error — Zod silently strips the unknown key and the slug stays as it was. If your admin UI shows the slug, show it read-only with an explanation, or someone will "edit" it and wonder why it didn't save.

`coverImageKey` follows the same three-state contract as §6.5 (omitted / key / `null`), with the same `oldUrl !== newUrl` guard.

**Response `200`:** the full updated row. **`404`** if missing.

### 8.7 `PATCH /api/admin/blogs/:id/status` — publish / unpublish

**No request body.** A blind flip — §9 applies. This is how a draft goes live.

### 8.8 `DELETE /api/admin/blogs/:id`

**`204`, empty body.** **`404`** if missing. The cover image is cleaned from R2 best-effort after the row is deleted.

> **Images pasted inside the article body are never cleaned up.** Diffing `<img>` tags out of an HTML string is too fragile to be worth it, so those files stay in R2 forever as dead storage. Accepted deliberately.

---

## 9. ⚠️ The status toggle — read before building any Switch

`PATCH /:id/status` on **FAQ** and **Blog** takes no body and flips the current value:

```ts
data: { isActive: !existing.isActive }
```

It is a **blind flip, not a setter.** Three consequences:

1. **Not idempotent.** Two clicks return to the original state; a double-click silently undoes itself.
2. **A stale list flips the wrong way.** If the row changed elsewhere since your last fetch, "publish" performs an unpublish.
3. **Read-modify-write**, so two simultaneous toggles can land on the same value.

```tsx
const [pending, setPending] = useState(false);

async function onToggle() {
  if (pending) return;              // 1. block double-fire
  setPending(true);
  try {
    const updated = await toggleStatus(row.id);
    setRow(updated);                // 2. trust the server, not !row.isActive
  } finally {
    setPending(false);
  }
}

<Switch checked={row.isActive} disabled={pending} onCheckedChange={onToggle} />
```

**How It Works is exempt** — its `isActive` is a normal field on `PATCH /api/admin/how-it-works`, so it is an idempotent setter and safe to fire optimistically.

---

## 10. Quick reference

| Method | Path | Guard | Body | Success |
|---|---|---|---|---|
| `GET` | `/api/public/how-it-works` | 🟢 | — | `200` row **or `null`** |
| `GET` | `/api/admin/how-it-works` | 🔒 | — | `200` row **or `null`** |
| `POST` | `/api/admin/how-it-works/upload-url` | 🔒 | `{ assetType, fileName, contentType }` | `200` `{ uploadUrl, key }` |
| `PATCH` | `/api/admin/how-it-works` | 🔒 | ≥1 field; upserts | `200` row |
| `GET` | `/api/public/faqs?placement=` | 🟢 | — **param required** | `200` array |
| `GET` | `/api/admin/faqs?placement=` | 🔒 | — param optional | `200` array |
| `POST` | `/api/admin/faqs` | 🔒 | `{ placement, question, answer }` | `201` row |
| `PATCH` | `/api/admin/faqs/reorder` | 🔒 | `{ orderedIds }` — complete set | `200` array |
| `PATCH` | `/api/admin/faqs/:id` | 🔒 | ≥1 of placement/question/answer | `200` row |
| `PATCH` | `/api/admin/faqs/:id/status` | 🔒 | *none* | `200` row |
| `DELETE` | `/api/admin/faqs/:id` | 🔒 | — | `204` empty |
| `GET` | `/api/public/blogs` | 🟢 | — | `200` array, **no `body`** |
| `GET` | `/api/public/blogs/:slug` | 🟢 | — | `200` row **with `body`** |
| `GET` | `/api/admin/blogs?isActive=` | 🔒 | — | `200` array, **no `body`** |
| `GET` | `/api/admin/blogs/:id` | 🔒 | — | `200` row **with `body`** |
| `POST` | `/api/admin/blogs/upload-url` | 🔒 | `{ fileName, contentType }` | `200` `{ uploadUrl, key }` |
| `POST` | `/api/admin/blogs` | 🔒 | `{ title, body, ...optional }` | `201` row |
| `PATCH` | `/api/admin/blogs/:id` | 🔒 | ≥1 field, `null` clears | `200` row |
| `PATCH` | `/api/admin/blogs/:id/status` | 🔒 | *none* | `200` row |
| `DELETE` | `/api/admin/blogs/:id` | 🔒 | — | `204` empty |

### Types

```ts
type ApiResponse<T> = { success: true; data: T };
type ApiError = { success: false; error: { code: string; message: string } };

export type HowItWorksStep = {
  heading: string;
  description: string;
};

export type HowItWorks = {
  id: string;
  videoUrl: string | null;
  posterUrl: string | null;
  steps: HowItWorksStep[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
// GET returns HowItWorks | null

export type FaqPlacement = "HOME" | "COMIC";

export type Faq = {
  id: string;
  placement: FaqPlacement;
  question: string;
  answer: string;      // PLAIN TEXT — never render as HTML
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// What list endpoints return — note the absent `body`.
export type BlogListItem = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// What the detail endpoints return.
export type Blog = BlogListItem & {
  body: string;        // HTML — sanitize before rendering
};
```

`createdAt` / `updatedAt` arrive as ISO 8601 strings, not `Date` objects.

---

## 11. Gotchas checklist

**Everywhere**

- ☐ Read `json.data`, never `json`. No endpoint here returns a `message`.
- ☐ `credentials: "include"` / `withCredentials: true` on every `/api/admin/*` call.
- ☐ `DELETE` returns bare `204` — don't parse a body.
- ☐ Admin lists include inactive rows. **Render them, don't filter them.**
- ☐ FAQ and Blog toggles are blind flips — disable while pending, trust the response (§9).

**How It Works**

- ☐ Handle `data: null` on both GETs — it is a success, not an error.
- ☐ Always send the **complete** `steps` array; there are no per-step endpoints.
- ☐ Step numbers are `index + 1`, never stored.
- ☐ `assetType` is required on the upload-url call and must match the `contentType`.
- ☐ Only send `videoKey` / `posterKey` when the file actually changed.
- ☐ Show a readiness warning when there's no video — otherwise the public section silently stays hidden (§6.2).

**FAQ**

- ☐ `?placement=` is **required** on the public GET. Omitting it is a `400`.
- ☐ `answer` is plain text. Never `dangerouslySetInnerHTML`.
- ☐ Reorder needs the **complete** id list for one placement, **including inactive rows**.
- ☐ Don't send `placement` on update unless it actually changed.
- ☐ `sortOrder` gaps are normal after a delete. Don't try to "fix" them.

**Blog**

- ☐ **Sanitize `body` with DOMPurify at render time.** Non-negotiable.
- ☐ Install `@tailwindcss/typography` and wrap the article in `prose`.
- ☐ List responses have **no `body`** — build cards from `excerpt`.
- ☐ The slug is read-only after create. Don't put it in an editable field.
- ☐ Intercept the editor's image handler and route it through the upload flow — otherwise images get base64-inlined into `body`.
- ☐ Deduplicate tags client-side; the backend doesn't.
- ☐ Omit blank optional fields on create; send `null` to clear on update.

---

## 12. Open items raised with backend

Known and accepted. Build around them.

### 12.1 No max length on FAQ text

`question` and `answer` validate presence but not size, consistent with the older CMS modules but not with `comic.title` (`.max(255)`) or `country.name` (`.max(100)`). Until bounds land, **the frontend is the only length limit that exists.** Set `maxLength` on both inputs and truncate long questions in the admin table, or one pasted essay breaks the accordion layout.

Blog is bounded — `title` 200, `excerpt` 300, tags 8 × 30 — but `body` is unbounded by design.

### 12.2 Blog has no `publishedAt`

The card date is `createdAt`. A post drafted on the 1st and published on the 15th shows **the 1st**. If the client cares about accurate publish dates, that's a migration plus a service change. Flagged and deliberately deferred.

### 12.3 No pagination anywhere

Every list is a bare `findMany` with no `take`/`skip`. FAQ and How It Works are naturally bounded. **Blog is not** — it grows with every post. Build the blog index so pagination can be added later without a rewrite: keep the query in a hook, don't assume the whole list is in memory.

`@@index([isActive, createdAt])` exists on `blogs` and backs the list query, but **does nothing for tag filtering** — array containment needs a GIN index, which doesn't exist. Irrelevant at current row counts.

### 12.4 Slugs strip non-Latin characters

The slugifier keeps only `a-z0-9`. Accented Latin degrades (`Ünïcödé` → `n-c-d`), and non-Latin scripts strip to empty and fall back to `post`, `post-2`, `post-3`. Given the audience, a Hindi-titled post is plausible — and would get a meaningless URL.

Fixable with Unicode normalization for Latin accents, or a transliteration library for Devanagari. Not implemented. **If the client plans non-English blog content, raise this before launch.**

### 12.5 The first database query after a cold start can fail

Observed during testing: the very first Prisma query in a freshly started process can fail with an empty `ErrorEvent` from the Neon serverless WebSocket adapter, surfacing as a `500` with an empty error message. Every subsequent query succeeds.

This is **not specific to these modules** — it affects whichever endpoint happens to be hit first. It matters on Render after a spin-up or redeploy, where a real user could eat it. If you see an unexplained `500` with an empty message immediately after a deploy, this is the likely cause, not your request. A retry succeeds.

---

## 13. Backend reference

| Piece | Location |
|---|---|
| Admin routes — How It Works | [src/routes/admin.ts:348-360](src/routes/admin.ts#L348-L360) |
| Admin routes — FAQ | [src/routes/admin.ts:361-374](src/routes/admin.ts#L361-L374) |
| Admin routes — Blog | [src/routes/admin.ts:375-390](src/routes/admin.ts#L375-L390) |
| Public routes | [src/routes/public.ts:63-73](src/routes/public.ts#L63-L73) |
| How It Works controller / service / validator | `src/{controllers,services,validators}/howItWorks.*` |
| FAQ controller / service / validator | `src/{controllers,services,validators}/faq.*` |
| Blog controller / service / validator | `src/{controllers,services,validators}/blog.*` |
| R2 helpers | `src/lib/r2.ts` |
| Models | `HowItWorks`, `Faq`, `Blog` in `prisma/schema.prisma` |
| Migration | `prisma/migrations/20260823212030_add_how_it_works_faq_blog/` |

### Related guides

- `REVIEWS_TEAM_FEEDBACK_API.md` — the same upload flow and toggle pattern, plus the three-state update contract these modules reuse
- `HERO_IMAGES_API.md` — more depth on upload optimization
- `ANNOUNCEMENTS_API.md` — the other module with `sortOrder` + reorder, for comparison with §7.5
