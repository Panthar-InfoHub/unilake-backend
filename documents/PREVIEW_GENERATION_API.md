# Preview Generation — Frontend Integration Guide

**Audience:** Unilake frontend team
**Last updated:** August 8, 2026
**Scope:** everything needed to build the customer-facing personalization flow — from "user clicks a comic" through to "user is looking at their personalized free preview pages."

**Source of truth:** [src/routes/public.ts](src/routes/public.ts), [src/controllers/session.controller.ts](src/controllers/session.controller.ts), [src/services/session.service.ts](src/services/session.service.ts), [src/validators/session.schema.ts](src/validators/session.schema.ts), [src/websocket/wsServer.ts](src/websocket/wsServer.ts), [src/websocket/event.ts](src/websocket/event.ts), [src/jobs/workers/generationWorker.ts](src/jobs/workers/generationWorker.ts).

Every endpoint, request body, response shape, status code and error message below was read directly out of those files. Where older docs and the code disagreed, the code won.

---

# TABLE OF CONTENTS

| Part | Contents |
|---|---|
| **0** | Read this first — scope, what lives in other docs, base URLs, the envelope |
| **1** | The mental model — what a session is, and the status machine |
| **2** | How to build it — architecture, the two-channel sync rule, state ownership |
| **3** | STEP 1 — Create the session |
| **4** | STEP 2 — Collect the child's details |
| **5** | STEP 3 — The photo (MediaPipe, prep, upload, confirm) ⭐ the big one |
| **6** | STEP 4 — Connect the WebSocket |
| **7** | STEP 5 — Trigger generation |
| **8** | STEP 6 — Consume events and render the preview |
| **9** | STEP 7 — Regenerate a single page |
| **10** | `GET /sessions/:id` — the complete snapshot reference |
| **11** | Status reference — session statuses and page statuses |
| **12** | Complete endpoint index |
| **13** | ⚠️ Cautions & catches |
| **14** | Do not build these |
| **15** | Known limitations (accepted by design) |
| **16** | Suggested build order |

---

# PART 0 — READ THIS FIRST

## 0.1 What this document covers, and what it doesn't

**Covered here — the whole personalization flow:**

```
create session → child details → photo (validate, upload, confirm)
   → connect WebSocket → generate → watch pages arrive → regenerate
```

**Not covered here — already documented elsewhere. Reference those, don't re-ask:**

| What | Where |
|---|---|
| Browsing the catalogue, `GET /api/public/comics` | [FRONTEND_COMIC_INTEGRATION.md](FRONTEND_COMIC_INTEGRATION.md) §5.1 |
| Comic detail page + free preview carousel, `GET /api/public/comics/:comicId` | [FRONTEND_COMIC_INTEGRATION.md](FRONTEND_COMIC_INTEGRATION.md) §5.2 |
| Country picker, `GET /api/public/countries` | [COUNTRIES_API.md](COUNTRIES_API.md) |
| Response envelope + full error-code table | [ANNOUNCEMENTS_API.md](ANNOUNCEMENTS_API.md) §3 |
| The generic direct-to-R2 upload dance and its four failure modes | [HERO_IMAGES_API.md](HERO_IMAGES_API.md) §5.2 |
| Announcement bar, hero images | [ANNOUNCEMENTS_API.md](ANNOUNCEMENTS_API.md), [HERO_IMAGES_API.md](HERO_IMAGES_API.md) |
| The entire admin panel | [FRONTEND_COMIC_INTEGRATION.md](FRONTEND_COMIC_INTEGRATION.md) |

> ⚠️ [FRONTEND_COMIC_INTEGRATION.md](FRONTEND_COMIC_INTEGRATION.md) §5.3 says session endpoints are *"out of scope and not yet wired — don't build against them from this document."* **That statement is now superseded by this document.** They are wired, tested, and specified below.

**Not built yet at all — do not design around these:**

Checkout, payment (Razorpay), paid-page generation (pages 11–24), variant confirmation, PDF compilation, order tracking, shipping. The flow in this document ends at `PREVIEW_READY`. What happens after the user has seen their preview is the next milestone.

## 0.2 Base URLs

| Environment | Base URL |
|---|---|
| Local dev | `http://localhost:8080` |
| Deployed (Cloud Run) | `https://unilake-backend-590672762351.asia-south1.run.app` |

> 🔴 **CORS currently allows `http://localhost:3000` only** — configured in two separate places on the backend ([app.ts:35](src/app.ts#L35) and Better Auth's `trustedOrigins` in [auth.ts:55](src/lib/auth.ts#L55)). Developing on any other port fails in the browser before the request is sent. When you have a deploy URL, tell backend — **both** places need updating, and updating only one produces a confusing half-working state.

## 0.3 The envelope (recap)

Success: `{ "success": true, "data": <payload>, "message"?: "..." }`
Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`

**The payload is always under `data`.** Full error-code table is in [ANNOUNCEMENTS_API.md](ANNOUNCEMENTS_API.md) §3. The codes you will actually hit in this flow:

| HTTP | `code` | When, in this flow |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad body, or trying to generate before the session has all required fields |
| 404 | `NOT_FOUND` | Session ID doesn't exist, comic isn't published, page number doesn't exist |
| 409 | `CONFLICT` | Doing something the session's current status doesn't allow, or hitting the variant cap |
| 500 | `INTERNAL_SERVER_ERROR` | Bug — or a malformed session ID (see §13.1) |

**Every endpoint in this document is on `/api/public/*` and needs no auth.** No cookie, no `credentials: "include"`, no header. The one exception is `attach-user` (§13.9), which is out of scope for this milestone.

---

# PART 1 — THE MENTAL MODEL

## 1.1 What an OrderSession is

An **OrderSession** is one attempt by one parent to personalize one comic. It is created *early* and filled in *progressively* — it is not a form you submit at the end.

```
POST /sessions  { comicId }        ← a real database row exists from this moment
      │
      ├── PATCH  childName, age, pronounKey       (any order, any number of times)
      ├── POST   photo/upload-url → PUT → confirm
      │
      └── POST   generate          ← the point of no return
```

Two consequences worth internalizing:

1. **The session ID is your handle on everything.** Put it in the URL. If the user closes the tab at any point, `GET /sessions/:id` rehydrates the entire state in one call — including any images that finished generating while they were away.
2. **Nothing is validated as "complete" until you call `/generate`.** You can PATCH fields in any order, skip some, come back to them. The completeness check happens once, at generation time.

It has **no login attached** in this milestone. The session is anonymous. `userId` stays `null` unless the user happens to already be logged in when the session is created.

## 1.2 Sessions expire after 24 hours

`expiresAt` is set to creation time + 24 hours. `GET /sessions/:id` returns a computed `isExpired` boolean.

- The **WebSocket refuses** to connect to an expired session (HTTP 410 at upgrade).
- The **REST endpoints do not check expiry at all** — a PATCH or a GET on a 25-hour-old session still succeeds.

So `isExpired` is advisory, and enforcing it in the UI is your call. Recommended: if `isExpired` is `true`, show a "this session has expired, start again" state rather than letting the user continue into a flow whose WebSocket will silently never connect.

## 1.3 The session status machine

Only four statuses are reachable in this milestone:

```
   CREATED
      │  photo/confirm
      ▼
PHOTO_UPLOADED
      │  generate
      ▼
GENERATING_PREVIEW
      │  (all preview pages finish)
      ▼
  PREVIEW_READY        ← this milestone ends here
```

`AWAITING_PAYMENT`, `PAID`, `GENERATING_PAID`, `PAID_PAGES_READY`, `CONFIRMED`, `COMPILING_PDF`, `DISPATCHED`, `COMPLETED`, `FAILED` all exist in the database enum but **nothing in the current codebase sets them.** Add a defensive `default` branch to any exhaustive `switch` on status so an unexpected value doesn't blank your UI, but don't build screens for them.

## 1.4 What actually happens when you hit "Generate"

Useful to understand, because it explains the timing and the event stream:

1. Backend finds every page of the comic flagged `isPreviewPage: true`. **This is a per-page flag chosen by the admin — it is not "the first N pages."** A comic's free pages could be 1, 4 and 9.
2. It creates one `PageVersion` row per preview page and pushes one job per row onto a queue.
3. Workers pick jobs up. For each page:
   - The child's name and pronouns are stamped into the speech bubbles with the comic's real fonts.
   - **If the page has a face on it** (`hasFace: true`), the stamped image is sent to a GPU service which swaps the child's face into the artwork. This is the slow part.
   - **If it doesn't**, the stamped image is already finished.
4. Each finished page fires a `page:ready` WebSocket event immediately — pages arrive **one at a time, out of order**, not as a batch.
5. When every preview page is done, one `session:preview-ready` event fires.

**Design for minutes, not seconds, and design for out-of-order arrival.** Face pages involve a GPU round-trip; non-face pages finish almost instantly. A preview will typically dribble in: two pages instantly, then a long pause, then the rest one by one. Exact timings depend on GPU capacity that is still being sized, so don't hardcode an expected duration or a progress percentage based on elapsed time — drive progress off pages completed out of pages expected.

---

# PART 2 — HOW TO BUILD THIS

## 2.1 🔴 The single most important rule: two channels, one source of truth

You have two ways of learning what's happening, and they are **not** interchangeable:

| Channel | What it is | Trust it for |
|---|---|---|
| `GET /sessions/:id` | Complete current state | **Truth.** Initial load, every reconnect, every return-to-tab |
| WebSocket | Deltas as they happen | **Speed.** Live updates while the user is watching |

**WebSocket events are not queued and not replayed.** If the socket is closed, disconnected, backgrounded by a mobile browser, or simply not open yet, events fired in that window are gone forever. There is no catch-up mechanism.

The rule that follows from this:

```
On mount            → GET
On WS reconnect     → GET
On tab regaining focus → GET
On every WS event   → patch local state
```

Build this from day one. Retrofitting it after you've built a WebSocket-only UI means rewriting your state layer.

```ts
// The pattern, condensed
useEffect(() => {
  refetchSnapshot();                     // GET — reconcile
  const ws = connect(sessionId, token);
  ws.onmessage = (e) => applyDelta(JSON.parse(e.data));
  ws.onclose = () => { scheduleReconnect(); };
  return () => ws.close();
}, [sessionId]);

useEffect(() => {
  const onFocus = () => refetchSnapshot(); // returning to the tab
  window.addEventListener("focus", onFocus);
  return () => window.removeEventListener("focus", onFocus);
}, []);
```

## 2.2 Put the session ID in the URL

```
/create/:comicId                  ← before the session exists
/personalize/:sessionId/details
/personalize/:sessionId/photo
/personalize/:sessionId/preview
```

Same reasoning as the admin wizard: the session is a real database row from the moment step 1 succeeds. A session ID in the URL makes the whole flow resumable and shareable for free, and `GET /sessions/:id` tells you exactly which step to drop the user back into.

**Also persist it in `localStorage`** keyed by comic, so a user who closes the tab entirely and comes back to the site can be offered "continue where you left off." The 24-hour expiry is your natural cleanup window.

## 2.3 State ownership

| Data | Lives in |
|---|---|
| Child's name / age / pronoun form, before submit | Local form state (react-hook-form) |
| The selected photo `File`, before upload | Component state |
| A local `URL.createObjectURL()` preview of that photo | Component state — **see §13.4, you can never read it back from the server** |
| `sessionId`, `wsRoomToken` | URL + localStorage |
| Everything else — status, pages, variants, images | Server state (TanStack Query), seeded by GET, patched by WS |

## 2.4 Recommended stack

Same as the admin guide: **TanStack Query** for server state, **react-hook-form + zod** for the details form. For the WebSocket, a plain `WebSocket` with a small reconnect wrapper is enough — you do not need a library. Do not put generation state in Redux/Zustand; the GET response *is* your state store.

---

# PART 3 — STEP 1: CREATE THE SESSION

### `POST /api/public/sessions`

Call this the moment the user commits to personalizing a comic — the "Personalize this book" button on the comic detail page. Not later.

**Request body:**

```json
{
  "comicId": "e4b9a7c1-3b2e-4d1f-8a7c-1e2f3a4b5c6d"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `comicId` | `string` | ✅ | Must be a valid **UUID** of a comic whose status is `PUBLISHED` |

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "7a1f9c22-8b04-4e3a-91d7-2c6e5f0a4b18",
    "comicId": "e4b9a7c1-3b2e-4d1f-8a7c-1e2f3a4b5c6d",
    "userId": null,
    "childName": null,
    "pronounKey": null,
    "notificationEmail": null,
    "coverType": null,
    "age": null,
    "status": "CREATED",
    "rawPhotoUrls": [],
    "bestPhotoUrl": null,
    "photoScoreJson": null,
    "shippingName": null,
    "shippingLine1": null,
    "shippingLine2": null,
    "shippingCity": null,
    "shippingState": null,
    "shippingZip": null,
    "shippingCountry": null,
    "shippingPhone": null,
    "wsRoomToken": "3f2b19d4-6c7e-4a91-8d05-b1e7c4a2f930",
    "createdAt": "2026-08-08T09:14:22.113Z",
    "updatedAt": "2026-08-08T09:14:22.113Z",
    "expiresAt": "2026-08-09T09:14:22.113Z"
  }
}
```

**➡️ Save two things immediately: `data.id` (your `sessionId`) and `data.wsRoomToken`.**

`wsRoomToken` is the credential for the WebSocket connection. It is also returned by `GET /sessions/:id`, so you can always recover it — but grabbing it here saves a round trip.

**Errors:**

| Status | `code` | Message | Cause |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `"Validation failed - comicId: ..."` | Missing or non-UUID `comicId` |
| 404 | `NOT_FOUND` | `"Comic not found"` | ID doesn't exist **or** the comic isn't `PUBLISHED` |

> The 404 is deliberately ambiguous between "no such comic" and "comic is a draft." Render the same not-found state for both.

**A note on `userId`:** this endpoint quietly checks for a login cookie and attaches `userId` if one is present. In this milestone nobody is logged in, so it will be `null`. Ignore the field.

---

# PART 4 — STEP 2: THE CHILD'S DETAILS

### `PATCH /api/public/sessions/:sessionId`

A partial update. Send any subset of fields, as many times as you like, in any order. There is **no status check** — this works at any point in the session's life.

**Request body** (only the fields relevant to this milestone are shown; the shipping fields exist but belong to checkout):

```json
{
  "childName": "Aarav",
  "age": 7,
  "pronounKey": "HE"
}
```

| Field | Type | Required for generation | Rules |
|---|---|---|---|
| `childName` | `string` | ✅ | 1–50 characters |
| `age` | `number` | ✅ | Integer, **0–18 inclusive** |
| `pronounKey` | `string` | ✅ | Exactly `HE` \| `SHE` \| `THEY` |
| `notificationEmail` | `string` | ❌ | Valid email. Where the "your book is ready" mail goes. Independent of any account email |
| `coverType` | `string` | ❌ | `HARDCOVER` \| `SOFTCOVER`. Belongs to checkout — collect it later |
| `shippingName` | `string` | ❌ | 1–100 chars — checkout |
| `shippingLine1` | `string` | ❌ | 1–200 chars — checkout |
| `shippingLine2` | `string` | ❌ | max 200 chars — checkout |
| `shippingCity` | `string` | ❌ | 1–100 chars — checkout |
| `shippingState` | `string` | ❌ | 1–100 chars — checkout |
| `shippingZip` | `string` | ❌ | 1–20 chars — checkout |
| `shippingCountry` | `string` | ❌ | Exactly 2 characters — ISO alpha-2 from [COUNTRIES_API.md](COUNTRIES_API.md) — checkout |
| `shippingPhone` | `string` | ❌ | 5–20 chars — checkout |

**At least one field must be present.** `{}` returns a 400.

**Response `200`:** the full updated session row — same shape as the create response in §3.

**Errors:**

| Status | `code` | Message |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `"Validation failed - : At least one field must be provided"` |
| 400 | `VALIDATION_ERROR` | `"Validation failed - age: Too big: expected number to be <=18"` |
| 400 | `VALIDATION_ERROR` | `"Validation failed - pronounKey: Invalid option: expected one of \"HE\"|\"SHE\"|\"THEY\""` |
| 404 | `NOT_FOUND` | `"OrderSession not found"` |

### 🔴 What `pronounKey` actually does — explain this to the user

This is not a demographic checkbox. It directly rewrites the dialogue printed in the book. The admin writes speech bubbles as templates:

```
"Look, {name}! {pronoun_subject} found the star!"
```

and the backend substitutes:

| Token | `HE` | `SHE` | `THEY` |
|---|---|---|---|
| `{name}` | *the childName you sent* | | |
| `{pronoun_subject}` | he | she | they |
| `{pronoun_object}` | him | her | them |
| `{pronoun_possessive}` | his | her | their |

Getting this wrong means a printed book that misgenders the child on every page. Make the control clear ("Aarav will be referred to as **he/him**"), and consider echoing a sample sentence back so the parent can see the effect.

**`childName` goes into printed artwork.** It is stamped into speech bubbles with auto-shrinking text. A very long name in a small bubble will shrink until it fits, or overflow if it can't. 1–50 characters is the server limit; encourage a short first name, and consider warning above ~15 characters.

---

# PART 5 — STEP 3: THE PHOTO ⭐

This is the part with the most moving pieces, and the part where the backend trusts you completely. Read all of it.

## 5.0 The shape of it

```
1. User picks a file
2. YOU normalize it        (HEIC→JPEG, downscale, re-encode)   ← §5.1
3. YOU validate it         (MediaPipe face detection)          ← §5.2
4. POST photo/upload-url   → { uploadUrl, key }                ← §5.3
5. PUT the bytes to R2     (direct to Cloudflare, not to us)   ← §5.4
6. POST photo/confirm      { key }  → status becomes PHOTO_UPLOADED  ← §5.5
```

> 🔴 **Steps 2 and 3 are entirely yours. The backend performs zero validation on the photo.** It never opens the file, never checks it contains a face, never checks the format matches what you declared, never checks the size. `photo/confirm` takes a key string and trusts it. A photo that fails your checks and gets confirmed anyway will be sent to the face-swap and will produce a broken, printed, paid-for book. **You are the only gate.**

## 5.1 Normalize the file before anything else

**Required, in this order, before you validate or upload:**

| # | Do this | Why |
|---|---|---|
| 1 | **Convert HEIC/HEIF → JPEG** | iPhones shoot HEIC by default. The upload endpoint accepts `jpg`, `jpeg`, `png`, `webp` only — HEIC has no path through this API at all. This is not optional on mobile |
| 2 | **Downscale so the long edge is ~1600px** | Camera originals are 3000–4000px and 3–8 MB. Nothing downstream resizes for you, and there is no server-side size cap to catch it |
| 3 | **Re-encode as JPEG at ~0.9 quality, aim for under ~2 MB** | Keeps the upload fast on mobile data |
| 4 | **Run MediaPipe on the *result*, not the original** | You must validate exactly the bytes you are about to upload. Validating the original and uploading a re-encode means the check didn't test what the GPU will see |

Since you're re-encoding anyway, always send `fileExtension: "jpg"` in step 4.

```ts
async function normalizePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);   // handles HEIC in Safari;
                                                  // use heic2any as a fallback elsewhere
  const MAX_EDGE = 1600;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob!), "image/jpeg", 0.9)
  );
}
```

`createImageBitmap` does not decode HEIC in Chrome or Firefox. Test on a real iPhone early and add `heic2any` (or an equivalent) if you need broader coverage — this will otherwise look like "the upload button does nothing" for a large share of your mobile users.

## 5.2 The MediaPipe check

### What is mandatory

**Exactly one detectable face. That is the hard gate.**

If MediaPipe returns zero faces, or more than one, **you must not upload and must not call confirm.** Show an error and make the user pick a different photo. Zero faces means the face-swap has nothing to work with; multiple faces means it's ambiguous which child the book is about.

### What is advisory

Everything else is a **warning the user can dismiss and proceed past.** Show them clearly — they meaningfully affect output quality — but do not block:

| Check | Suggested threshold | Message to show |
|---|---|---|
| Face too small | face width **or** height < 15% of the image | "Try a closer photo — the face is quite small" |
| Face off-centre | face centre more than 25% away from image centre, on either axis | "Try centring your child's face in the photo" |
| Possible sunglasses | **both** eye regions dark (mean brightness < 50) **and** flat (variance < 150) | "Sunglasses can affect the result — a photo without them works better" |

These thresholds come from the original backend validation ([src/scripts/validate_photo.py](src/scripts/validate_photo.py), now retired) and are a sane starting point. Tune them against real photos — they were never validated against browser-model output.

> There is **no expression/emotion check.** The old backend one used DeepFace, which has no MediaPipe.js equivalent. It's deliberately dropped, not forgotten.

### Implementation

Use `@mediapipe/tasks-vision`'s `FaceDetector` with the BlazeFace short-range model — the same model family the retired backend used.

```bash
npm install @mediapipe/tasks-vision
```

```ts
import { FilesetResolver, FaceDetector } from "@mediapipe/tasks-vision";

let detector: FaceDetector | null = null;

async function getDetector() {
  if (detector) return detector;
  const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "/mediapipe/blaze_face_short_range.tflite" },
    runningMode: "IMAGE",
  });
  return detector;
}

export type PhotoCheck = {
  passed: boolean;              // false = BLOCK. Only ever false for the face count.
  blockReason?: "no_face" | "multiple_faces";
  warnings: string[];           // advisory — show, but allow the user through
};

export async function checkPhoto(blob: Blob): Promise<PhotoCheck> {
  const bitmap = await createImageBitmap(blob);
  const det = await getDetector();
  const { detections } = det.detect(bitmap);

  // --- THE HARD GATE ---
  if (detections.length === 0) {
    return { passed: false, blockReason: "no_face", warnings: [] };
  }
  if (detections.length > 1) {
    return { passed: false, blockReason: "multiple_faces", warnings: [] };
  }

  // --- ADVISORY ONLY ---
  const warnings: string[] = [];
  const box = detections[0].boundingBox!;

  const widthRatio = box.width / bitmap.width;
  const heightRatio = box.height / bitmap.height;
  if (widthRatio < 0.15 || heightRatio < 0.15) {
    warnings.push("The face looks small — a closer photo usually works better.");
  }

  const centreX = (box.originX + box.width / 2) / bitmap.width;
  const centreY = (box.originY + box.height / 2) / bitmap.height;
  if (Math.abs(centreX - 0.5) > 0.25 || Math.abs(centreY - 0.5) > 0.25) {
    warnings.push("Try centring your child's face in the photo.");
  }

  return { passed: true, warnings };
}
```

Host the `.wasm` bundle and the `.tflite` model yourself under `/public` rather than loading them from a CDN — it's one less third-party dependency in a flow that already has several failure modes, and it keeps working offline in dev.

The model loads once and is reusable; initialize it lazily when the user reaches the photo step so it isn't downloaded by people who never get there.

### The gate, expressed as a rule

```
if (!check.passed)  →  STOP. Do not request an upload URL.
                       Do not PUT. Do not call confirm.
                       Show the error, let them choose another photo.

if (check.warnings.length)  →  Show the warnings.
                               Offer "Use this photo anyway" and
                               "Choose a different photo".

Only after the user is through that gate: proceed to §5.3.
```

## 5.3 `POST /api/public/sessions/:sessionId/photo/upload-url`

**Request body:**

```json
{
  "fileExtension": "jpg"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `fileExtension` | `string` | ✅ | Exactly `jpg` \| `jpeg` \| `png` \| `webp` |

> ⚠️ **You send an extension, not a MIME type** — unlike every other upload endpoint in this API, which take `contentType`. The backend derives the MIME type from it. This matters enormously for the next step (§5.4).

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://<account>.r2.cloudflarestorage.com/unilake-private/sessions/7a1f9c22-.../photo-1754642062113.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=...",
    "key": "sessions/7a1f9c22-8b04-4e3a-91d7-2c6e5f0a4b18/photo-1754642062113.jpg"
  }
}
```

- `uploadUrl` — presigned PUT target. **Valid for 5 minutes only** — the shortest expiry in the entire API. Request it immediately before the PUT, never when the file picker opens.
- `key` — hold onto it exactly as given. It's what you send to `confirm`.
- Bucket: **private.** See §13.4 for what that means for you.

**Errors:**

| Status | `code` | Message |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `"Validation failed - fileExtension: Invalid file extension. Must be strictly jpg, jpeg, png, or webp."` |
| 404 | `NOT_FOUND` | `"OrderSession not found"` |
| 409 | `CONFLICT` | `"Photo upload is only allowed before generation starts. Current status: GENERATING_PREVIEW"` |

The 409 fires for any status other than `CREATED` or `PHOTO_UPLOADED`. In practice: once the user hits Generate, the photo is locked.

## 5.4 PUT the bytes to R2

This request goes to **Cloudflare, not to us.** The generic mechanics and the four classic failure modes are documented in [HERO_IMAGES_API.md](HERO_IMAGES_API.md) §5.2 — read that if you haven't. Two things are specific to *this* endpoint:

### 🔴 The Content-Type trap, specific to photos

Because you sent an *extension* and the backend derived the MIME type, you must send the **derived** type on the PUT — not something you construct from the extension yourself:

| You sent `fileExtension` | You MUST PUT with `Content-Type` |
|---|---|
| `jpg` | `image/jpeg` ← **note: not `image/jpg`** |
| `jpeg` | `image/jpeg` |
| `png` | `image/png` |
| `webp` | `image/webp` |

`image/jpg` is not a real MIME type and will produce a `403 SignatureDoesNotMatch` from Cloudflare with an XML body that says nothing useful. This is the single most likely thing to cost you an afternoon here.

```ts
const EXT_TO_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

await fetch(uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": EXT_TO_MIME[fileExtension] },
  body: blob,          // raw Blob/File — NOT FormData
  // deliberately NO credentials, NO Authorization header
});
```

### 🔴 Private-bucket CORS is unverified — test this on day one

The photo goes to the **private** R2 bucket. Every other browser upload in this system goes to the *public* bucket, whose CORS has been exercised. **A direct browser PUT to the private bucket has never been tested against a real browser.**

If your PUT fails with a CORS preflight error rather than a signature error, that is not a bug in your code — the private bucket needs a CORS policy adding. **Report it to backend immediately** rather than working around it. Test this with a single throwaway upload before you build any of the surrounding UI.

**Success is `200` with an empty body.** Nothing to parse. R2 errors come back as XML — `await res.text()` if you need the detail.

## 5.5 `POST /api/public/sessions/:sessionId/photo/confirm`

This is the commit. Until it runs, the file is sitting in a bucket and the session doesn't know it exists.

**Request body:**

```json
{
  "key": "sessions/7a1f9c22-8b04-4e3a-91d7-2c6e5f0a4b18/photo-1754642062113.jpg"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `key` | `string` | ✅ | Min 1 char. The **exact `key`** from §5.3, untouched |

> ⚠️ **The server does not verify the key exists in R2.** Send a typo, a truncated string, or the full `uploadUrl` by mistake, and you get a cheerful `200` — and generation will fail later with a confusing error. Pass the value through verbatim; never rebuild it, never substring it.

**Response `200` — note the extra nesting:**

```json
{
  "success": true,
  "data": {
    "session": {
      "id": "7a1f9c22-8b04-4e3a-91d7-2c6e5f0a4b18",
      "status": "PHOTO_UPLOADED",
      "bestPhotoUrl": "sessions/7a1f9c22-.../photo-1754642062113.jpg",
      "rawPhotoUrls": ["sessions/7a1f9c22-.../photo-1754642062113.jpg"],
      "childName": "Aarav",
      "...": "all other session fields"
    }
  }
}
```

🔴 **The payload is `data.session`, not `data`.** This is the only endpoint in the flow that wraps its result in an extra object. Everything else returns the row directly under `data`. Unwrap accordingly or you'll be reading `undefined`.

**Errors:**

| Status | `code` | Message |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `"Validation failed - key: Upload key cannot be empty."` |
| 404 | `NOT_FOUND` | `"OrderSession not found"` |
| 409 | `CONFLICT` | `"Photo confirm is only allowed before generation starts. Current status: GENERATING_PREVIEW"` |

## 5.6 Replacing the photo

**Fully supported before generation starts.** Both `upload-url` and `confirm` accept the statuses `CREATED` and `PHOTO_UPLOADED`, so the user can swap their photo as many times as they like right up until they hit Generate.

Just run §5.1 → §5.5 again from the top. Each upload gets a unique key (the filename carries a timestamp), so nothing is overwritten, and `confirm` replaces `bestPhotoUrl` with the new key.

After Generate, both endpoints return 409. There is no way to change the photo once generation has begun — the user would have to start a new session.

---

# PART 6 — STEP 4: CONNECT THE WEBSOCKET

**Connect before you call `/generate`, not after.** Generation begins the instant that request returns, and non-face pages can finish in a second or two. A socket opened afterwards will miss them.

## 6.1 The URL

```
ws://localhost:8080/?sessionId=<sessionId>&token=<wsRoomToken>
```

Both parameters are query-string, both are mandatory. In production this is `wss://` — derive it from your API base URL rather than hardcoding:

```ts
const wsUrl = API_BASE_URL.replace(/^http/, "ws") +
  `/?sessionId=${sessionId}&token=${wsRoomToken}`;
```

`wsRoomToken` comes from the create response (§3) or from `GET /sessions/:id`.

## 6.2 🔴 Connection failures are silent

The backend rejects bad handshakes during the raw HTTP upgrade, before the WebSocket exists:

| Reason | Backend sends |
|---|---|
| Missing `sessionId` or `token` | `400 Bad Request` |
| Session doesn't exist | `404 Not Found` |
| Token doesn't match | `401 Unauthorized` |
| Session past `expiresAt` | `410 Gone` |

**The browser `WebSocket` API cannot show you any of these.** You get an `error` event with no detail and a `close` event with a generic code. There is no way to distinguish "wrong token" from "server is down" from the client.

Practical consequence: **do not build error UI that guesses why.** If the socket won't open, fall back to polling `GET /sessions/:id` every ~10 seconds and show the user a generic "reconnecting" state. The GET always works and contains everything — the WebSocket is an optimization, not a dependency.

## 6.3 What to expect on the wire

- The server sends **nothing** on connect — no acknowledgement, no initial state. Silence is normal.
- The server never pings, and ignores anything you send. It is a one-way broadcast channel.
- Every message is JSON with a `type` field.
- Multiple tabs on the same session all receive the same events.

## 6.4 Reconnect strategy

```ts
function connect(sessionId: string, token: string, onEvent: (e: any) => void) {
  let attempt = 0;
  let ws: WebSocket;
  let stopped = false;

  const open = () => {
    ws = new WebSocket(wsUrlFor(sessionId, token));

    ws.onopen = () => { attempt = 0; };
    ws.onmessage = (e) => onEvent(JSON.parse(e.data));

    ws.onclose = () => {
      if (stopped) return;
      // 🔴 ALWAYS re-GET on reconnect — events fired while we were
      //    disconnected are gone forever and are never replayed.
      refetchSnapshot();
      const delay = Math.min(1000 * 2 ** attempt++, 30_000);
      setTimeout(open, delay);
    };
  };

  open();
  return () => { stopped = true; ws?.close(); };
}
```

Stop reconnecting once the session reaches `PREVIEW_READY` and the user isn't regenerating — there's nothing left to stream.

---

# PART 7 — STEP 5: TRIGGER GENERATION

### `POST /api/public/sessions/:sessionId/generate`

**No request body.** Everything comes from the session.

```ts
await fetch(`${API_BASE_URL}/api/public/sessions/${sessionId}/generate`, {
  method: "POST",
});
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "status": "GENERATING_PREVIEW",
    "jobsEnqueued": 5
  }
}
```

`jobsEnqueued` is how many pages are being generated. **Use it as the denominator of your progress indicator** — "2 of 5 pages ready" — rather than the comic's `freePreviewPages` number, which can disagree with reality (§13.7).

**Errors:**

| Status | `code` | Message | Meaning |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | `"Session is missing required fields: childName, age, pronounKey, photo"` | Only the missing ones are listed. Map them back to your form steps |
| 400 | `VALIDATION_ERROR` | *(a Zod UUID message)* | `sessionId` in the URL isn't a UUID |
| 404 | `NOT_FOUND` | `"OrderSession not found"` | |
| 409 | `CONFLICT` | `"Cannot trigger generation — session status is already 'GENERATING_PREVIEW'"` | Already generating, or already done |

### 🔴 Make this button un-double-clickable

The 409 on re-entry protects the data, but it means a user who double-taps sees an error toast for what looked like a normal action. Disable the button on click, keep it disabled while the request is in flight, and navigate away from the trigger screen on success.

### The completeness check, mirrored client-side

The backend requires all four of these before it will generate:

| Requirement | Where it comes from |
|---|---|
| `childName` | §4 PATCH |
| `age` | §4 PATCH |
| `pronounKey` | §4 PATCH |
| a confirmed photo | §5 confirm |

Check all four client-side before enabling the Generate button. The server message is a good fallback, but a disabled button with "add your child's name to continue" is much better UX than a 400.

> ⚠️ **`jobsEnqueued: 0` is possible.** If the comic's admin never flagged any page as a preview page, the session still flips to `GENERATING_PREVIEW` but nothing will ever generate and `session:preview-ready` will never fire. This is an admin data problem, not a frontend one — but handle it: if `jobsEnqueued === 0`, show an error and tell the user to contact support rather than spinning forever.

---

# PART 8 — STEP 6: CONSUME EVENTS AND RENDER THE PREVIEW

## 8.1 The three events

These shapes are **locked** — backend is committed to them.

### `page:ready` — one page finished

```json
{
  "type": "page:ready",
  "pageNumber": 4,
  "variantIndex": 0,
  "imageUrl": "https://pub-xxxx.r2.dev/sessions/7a1f9c22-.../final/9c3e1b7a-....png",
  "pageVersionId": "9c3e1b7a-2d84-4f19-b6c0-5a1e8d7f2c30"
}
```

`imageUrl` is a **fully-qualified public URL** — drop it straight into an `<img src>`. No signing, no auth, no transformation.

`variantIndex` tells you which attempt this is: `0` is the original, `1`+ come from regeneration (§9).

### `page:error` — one page failed

```json
{
  "type": "page:error",
  "pageNumber": 4,
  "variantIndex": 0,
  "errorMessage": "RunPod job failed: CUDA out of memory"
}
```

> 🔴 **`page:error` does not mean the page has permanently failed.** The backend retries each page up to 3 times with exponential backoff. It emits `page:error` on *every* failed attempt — so you may well receive `page:error` for a page and then, 30 seconds later, receive `page:ready` for that same page and variant.
>
> Treat `page:error` as **"still trying, something went wrong"**, not as final. Show a retrying state, not a dead end. The only way to know a page has truly failed is that it is still `FAILED` in the `GET /sessions/:id` snapshot after generation has settled.
>
> `errorMessage` is raw backend text truncated to 500 characters. **Never show it to a parent** — it says things like "RunPod job failed". Log it, show a friendly message.

### `session:preview-ready` — everything is done

```json
{ "type": "session:preview-ready" }
```

No payload. Fires exactly once, when every preview page has succeeded. This is your cue to move the user to the finished preview view.

**Always re-GET when this arrives** rather than trusting your accumulated local state — it's the one moment where being certain is worth a round trip.

## 8.2 Applying events to state

```ts
function applyDelta(evt: any, draft: SessionSnapshot) {
  switch (evt.type) {
    case "page:ready": {
      const page = draft.pages.find((p) => p.pageNumber === evt.pageNumber);
      if (!page) return;
      const existing = page.variants.find(
        (v) => v.pageVersionId === evt.pageVersionId
      );
      if (existing) {
        existing.status = "SD_READY";
        existing.finalImageUrl = evt.imageUrl;
        existing.errorMessage = null;
      } else {
        page.variants.push({
          pageVersionId: evt.pageVersionId,
          variantIndex: evt.variantIndex,
          status: "SD_READY",
          finalImageUrl: evt.imageUrl,
          isSelected: false,
          errorMessage: null,
        });
      }
      return;
    }
    case "page:error": {
      // Mark as "retrying" — NOT as permanently failed. See §8.1.
      const page = draft.pages.find((p) => p.pageNumber === evt.pageNumber);
      const v = page?.variants.find((v) => v.variantIndex === evt.variantIndex);
      if (v) { v.status = "FAILED"; v.errorMessage = evt.errorMessage; }
      return;
    }
    case "session:preview-ready":
      draft.status = "PREVIEW_READY";
      refetchSnapshot();     // reconcile — cheap insurance at the finish line
      return;
    default:
      return;                // unknown type — ignore, don't crash
  }
}
```

Note the `page:ready` branch handles a variant it has never seen. That happens on regeneration, and it happens when a `page:ready` arrives before your GET has returned. Don't assume the variant already exists.

## 8.3 Rendering the book

`GET /sessions/:id` gives you **every page of the comic**, not just the free ones — deliberately, so you can render the complete book with locked pages behind a paywall overlay.

```ts
snapshot.pages.map((page) => {
  const ready = page.variants.find((v) => v.status === "SD_READY");

  if (!page.isPreviewPage) {
    return <LockedPage pageNumber={page.pageNumber} />;   // paywall overlay
  }
  if (ready) {
    return <img src={ready.finalImageUrl!} alt={`Page ${page.pageNumber}`} />;
  }
  return <GeneratingPage pageNumber={page.pageNumber} />;  // still working
});
```

**Three states per page, and you need all three:** locked (not a preview page), generating (preview page, no `SD_READY` variant yet), ready (has one).

**Layout tip:** you know each page's real dimensions from the comic detail endpoint ([FRONTEND_COMIC_INTEGRATION.md](FRONTEND_COMIC_INTEGRATION.md) §5.2 returns `artworkWidth`/`artworkHeight` for preview pages). Use them to reserve an aspect-ratio box *before* images arrive, so pages landing one by one don't shove the layout around. Without this, a 12-page book will visibly jump every time a page completes.

**Progress:** count pages with an `SD_READY` variant against `jobsEnqueued` from §7. Don't estimate time remaining — page durations vary by an order of magnitude depending on whether a page has a face on it.

---

# PART 9 — STEP 7: REGENERATE A SINGLE PAGE

Lets the user say "I don't like how this page turned out" and get another attempt. Each attempt is a **variant** — the old one is kept, not replaced.

### `POST /api/public/sessions/:sessionId/pages/:pageNumber/regenerate`

**No request body.** Note the path takes a **`pageNumber`** (1, 2, 3…), not a `pageId` — the only endpoint in this flow that identifies a page by its number.

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "queued": true,
    "pageNumber": 4,
    "variantIndex": 1,
    "hasPaid": false
  }
}
```

The new variant then flows through the normal pipeline and arrives as a `page:ready` event with that `variantIndex`.

**Errors:**

| Status | `code` | Message |
|---|---|---|
| 404 | `NOT_FOUND` | `"OrderSession not found"` |
| 404 | `NOT_FOUND` | `"Page 99 does not exist for this comic"` |
| 409 | `CONFLICT` | `"Cannot regenerate — session is not in an active generation stage (current status: PHOTO_UPLOADED)"` |
| 409 | `CONFLICT` | `"Maximum regenerations (3) already reached for page 4"` |

### 🔴 The variant cap counts the original

**Before payment the cap is 3 total variants per page** — that is the original plus **two** regenerations. The third regeneration attempt returns 409.

```
variantIndex 0  ← the original generation
variantIndex 1  ← regeneration #1
variantIndex 2  ← regeneration #2
                ← a further attempt → 409
```

Compute `page.variants.length` from the snapshot and show the user their remaining attempts ("2 tries left"), then disable the button at zero. Letting them click into a 409 is a poor experience for something entirely predictable.

The cap rises to 8 after payment, and pre-payment variants count toward it — but payment doesn't exist yet, so `hasPaid` will always be `false` in this milestone.

### When regenerate is allowed

Only while the session is in an active generation stage — in this milestone that means `GENERATING_PREVIEW` or `PREVIEW_READY`. You cannot regenerate before the first generation has been triggered.

### Choosing between variants

`GET /sessions/:id` returns every variant of every page with an `isSelected` flag. **Nothing currently sets `isSelected`** — the endpoint that lets a user pick their favourite variant is part of the checkout milestone and doesn't exist yet.

For now: show all `SD_READY` variants for a page, let the user browse them, and keep their choice in local state. When the confirm endpoint lands you'll submit those choices. Don't build against `isSelected` — it will always be `false`.

---

# PART 10 — `GET /sessions/:id` — THE COMPLETE SNAPSHOT

### `GET /api/public/sessions/:sessionId`

The single most important endpoint in this flow. One call returns everything: session state, the child's details, the comic, every page, every variant. Call it on mount, on every WebSocket reconnect, and whenever the tab regains focus.

**No auth, no query params.**

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "id": "7a1f9c22-8b04-4e3a-91d7-2c6e5f0a4b18",
    "comicId": "e4b9a7c1-3b2e-4d1f-8a7c-1e2f3a4b5c6d",
    "userId": null,
    "childName": "Aarav",
    "pronounKey": "HE",
    "age": 7,
    "notificationEmail": null,
    "coverType": null,
    "status": "GENERATING_PREVIEW",
    "bestPhotoUrl": "sessions/7a1f9c22-.../photo-1754642062113.jpg",
    "shippingName": null,
    "shippingLine1": null,
    "shippingLine2": null,
    "shippingCity": null,
    "shippingState": null,
    "shippingZip": null,
    "shippingCountry": null,
    "shippingPhone": null,
    "wsRoomToken": "3f2b19d4-6c7e-4a91-8d05-b1e7c4a2f930",
    "createdAt": "2026-08-08T09:14:22.113Z",
    "updatedAt": "2026-08-08T09:21:47.882Z",
    "expiresAt": "2026-08-09T09:14:22.113Z",
    "isExpired": false,
    "comic": {
      "id": "e4b9a7c1-3b2e-4d1f-8a7c-1e2f3a4b5c6d",
      "title": "Captain Aarav and the Lost Star",
      "freePreviewPages": 5,
      "coverThumbnailUrls": ["https://pub-xxxx.r2.dev/comics/temp/9f2c...-cover.png"]
    },
    "pages": [
      {
        "pageId": "a9d2e5f8-1c73-4b20-9e5d-3f8a1b6c4d92",
        "pageNumber": 1,
        "isPreviewPage": true,
        "hasFace": true,
        "variants": [
          {
            "pageVersionId": "9c3e1b7a-2d84-4f19-b6c0-5a1e8d7f2c30",
            "variantIndex": 0,
            "status": "SD_READY",
            "finalImageUrl": "https://pub-xxxx.r2.dev/sessions/7a1f9c22-.../final/9c3e1b7a-....png",
            "isSelected": false,
            "errorMessage": null
          },
          {
            "pageVersionId": "1b7f4a20-9e63-4d85-a1c7-8f2e0b5d3a64",
            "variantIndex": 1,
            "status": "GENERATING_SD",
            "finalImageUrl": null,
            "isSelected": false,
            "errorMessage": null
          }
        ]
      },
      {
        "pageId": "b7e3f1a4-8d92-4c56-b0f3-7a2e9d1c5b48",
        "pageNumber": 2,
        "isPreviewPage": false,
        "hasFace": false,
        "variants": []
      }
    ]
  }
}
```

**Field reference:**

| Field | Type | Notes |
|---|---|---|
| `status` | string | See §11.1 |
| `bestPhotoUrl` | string \| null | 🔴 **A private R2 key, not a URL.** You cannot render it. See §13.4 |
| `wsRoomToken` | string | The WebSocket credential |
| `isExpired` | boolean | Computed server-side from `expiresAt` |
| `comic.freePreviewPages` | number | 🔴 Unreliable — see §13.7. Use `pages.filter(p => p.isPreviewPage).length` instead |
| `pages[]` | array | **Every page of the comic**, ascending by `pageNumber` |
| `pages[].isPreviewPage` | boolean | `true` = free, will be generated. `false` = locked, needs payment |
| `pages[].hasFace` | boolean | Whether the child's face appears here. Informational — a "this page features your child" badge, if you want one |
| `pages[].variants[]` | array | Ascending by `variantIndex`. **Empty for pages that haven't been generated** — which is every non-preview page in this milestone |
| `variants[].status` | string | See §11.2 |
| `variants[].finalImageUrl` | string \| null | Full public URL. Non-null only when `status` is `SD_READY` |
| `variants[].isSelected` | boolean | Always `false` today — see §9 |
| `variants[].errorMessage` | string \| null | Raw backend text. Never display verbatim |

**Deliberately excluded** and never coming: internal pipeline fields (`seed`, `textStampedUrl`, `comfyJobId`, `steps`, `cfg`, `pagePrompt`) and sensitive ones (`rawPhotoUrls`, `photoScoreJson`).

**Errors:** `404 NOT_FOUND` — `"OrderSession not found"`.

**TypeScript:**

```ts
export type SessionStatus =
  | "CREATED" | "PHOTO_UPLOADED" | "GENERATING_PREVIEW" | "PREVIEW_READY"
  // present in the DB enum, unreachable in this milestone:
  | "AWAITING_PAYMENT" | "PAID" | "GENERATING_PAID" | "PAID_PAGES_READY"
  | "CONFIRMED" | "COMPILING_PDF" | "DISPATCHED" | "COMPLETED" | "FAILED";

export type PageVersionStatus =
  | "QUEUED" | "TEXT_STAMPING" | "TEXT_STAMPED"
  | "GENERATING_SD" | "SD_READY" | "FAILED";

export type Variant = {
  pageVersionId: string;
  variantIndex: number;
  status: PageVersionStatus;
  finalImageUrl: string | null;
  isSelected: boolean;
  errorMessage: string | null;
};

export type SessionPage = {
  pageId: string;
  pageNumber: number;
  isPreviewPage: boolean;
  hasFace: boolean;
  variants: Variant[];
};

export type SessionSnapshot = {
  id: string;
  comicId: string;
  userId: string | null;
  childName: string | null;
  pronounKey: "HE" | "SHE" | "THEY" | null;
  age: number | null;
  notificationEmail: string | null;
  coverType: "HARDCOVER" | "SOFTCOVER" | null;
  status: SessionStatus;
  bestPhotoUrl: string | null;      // private key — NOT renderable
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZip: string | null;
  shippingCountry: string | null;
  shippingPhone: string | null;
  wsRoomToken: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  isExpired: boolean;
  comic: {
    id: string;
    title: string;
    freePreviewPages: number;
    coverThumbnailUrls: string[];
  };
  pages: SessionPage[];
};
```

---

# PART 11 — STATUS REFERENCE

## 11.1 Session statuses

| Status | Meaning | What the user should see |
|---|---|---|
| `CREATED` | Session exists, no photo confirmed | The details / photo steps |
| `PHOTO_UPLOADED` | Photo confirmed. Ready to generate once details are filled | The review / "Generate" screen |
| `GENERATING_PREVIEW` | Pages are being generated | The live preview screen with progress |
| `PREVIEW_READY` | Every preview page finished | The finished preview, regenerate controls, paywall on locked pages |

Everything else in the enum is unreachable today. Handle unknown values gracefully.

## 11.2 Page variant statuses

| Status | Meaning |
|---|---|
| `QUEUED` | Waiting for a worker |
| `TEXT_STAMPING` | Name and pronouns being rendered into the speech bubbles |
| `TEXT_STAMPED` | Text done |
| `GENERATING_SD` | At the GPU service for face-swap. **Face pages only** — this is the slow stage |
| `SD_READY` | ✅ Done. `finalImageUrl` is populated |
| `FAILED` | This attempt failed. **May still be retried automatically** — see §8.1 |

Two paths through the pipeline:

```
Face page      (hasFace: true):
  QUEUED → TEXT_STAMPING → TEXT_STAMPED → GENERATING_SD → SD_READY

Non-face page  (hasFace: false):
  QUEUED → TEXT_STAMPING → TEXT_STAMPED → SD_READY
```

Non-face pages skip the GPU entirely and complete in seconds. Face pages take substantially longer. **This is why pages arrive out of order** — a non-face page 7 will routinely beat a face page 1.

You could surface these as micro-copy ("adding Aarav's name…", "creating Aarav's portrait…") for a nicer wait, but you'd need to poll the GET to see them — the WebSocket only fires on completion, not on intermediate stage changes.

---

# PART 12 — COMPLETE ENDPOINT INDEX

Everything in this document. Base URL: `http://localhost:8080` locally. **None require auth.**

| # | Method | Path | Body | Success | §  |
|---|---|---|---|---|---|
| 1 | `POST` | `/api/public/sessions` | `{ comicId }` | `201` → full session | §3 |
| 2 | `PATCH` | `/api/public/sessions/:sessionId` | partial session | `200` → full session | §4 |
| 3 | `GET` | `/api/public/sessions/:sessionId` | — | `200` → snapshot | §10 |
| 4 | `POST` | `/api/public/sessions/:sessionId/photo/upload-url` | `{ fileExtension }` | `200` → `{ uploadUrl, key }` | §5.3 |
| 5 | `PUT` | `<uploadUrl>` *(goes to R2, not us)* | raw bytes | `200` → empty | §5.4 |
| 6 | `POST` | `/api/public/sessions/:sessionId/photo/confirm` | `{ key }` | `200` → `{ session }` ⚠️ nested | §5.5 |
| 7 | `POST` | `/api/public/sessions/:sessionId/generate` | **none** | `200` → `{ status, jobsEnqueued }` | §7 |
| 8 | `POST` | `/api/public/sessions/:sessionId/pages/:pageNumber/regenerate` | **none** | `200` → `{ queued, pageNumber, variantIndex, hasPaid }` | §9 |
| 9 | `WS` | `/?sessionId=&token=` | — | 3 event types | §6, §8 |
| 10 | `PATCH` | `/api/public/sessions/:sessionId/attach-user` | none | `200` → session | §13.9 — **out of scope** |

**Referenced from other documents, needed to complete the journey:**

| Method | Path | Where |
|---|---|---|
| `GET` | `/api/public/comics` | [FRONTEND_COMIC_INTEGRATION.md](FRONTEND_COMIC_INTEGRATION.md) §5.1 |
| `GET` | `/api/public/comics/:comicId` | [FRONTEND_COMIC_INTEGRATION.md](FRONTEND_COMIC_INTEGRATION.md) §5.2 |
| `GET` | `/api/public/countries` | [COUNTRIES_API.md](COUNTRIES_API.md) |

---

# PART 13 — ⚠️ CAUTIONS & CATCHES

## 13.1 🔴 A malformed session ID returns 500, not 404

`sessionId` is only UUID-validated on `/generate` and `/regenerate`. On PATCH, GET, and the photo endpoints, a non-UUID string goes straight to the database and surfaces as a **500**.

Always use an ID you received from the create response. Never let one be typed or constructed. If you read one from `localStorage` or the URL, validate it looks like a UUID before using it.

## 13.2 🔴 `photo/confirm` nests its response under `data.session`

Every other endpoint puts the payload directly under `data`. This one is `data.session`. See §5.5.

## 13.3 🔴 `page:error` is not final

The backend retries up to 3 times and emits the event on each failed attempt. A `page:ready` for the same page can follow. See §8.1.

## 13.4 🔴 You can never display the child's photo back from the server

`bestPhotoUrl` is a **key in the private R2 bucket** — `sessions/.../photo-123.jpg`, not a URL. It cannot be rendered, and there is no signed-download endpoint to exchange it for one.

If the UI needs to show the parent the photo they chose (on a review screen, for example), you must keep it client-side:

```ts
const localPreview = URL.createObjectURL(normalizedBlob);
// ...render it, and revokeObjectURL on unmount
```

This survives navigation within your SPA but **not a page refresh**. After a refresh you can show that a photo was uploaded (`bestPhotoUrl !== null`) but not what it looks like. Design the review screen accordingly, or re-prompt.

## 13.5 🔴 The Content-Type on the photo PUT must be `image/jpeg`, never `image/jpg`

See §5.4. This is the most likely single point of lost time in the whole flow.

## 13.6 🔴 Private-bucket CORS has never been browser-tested

See §5.4. Test a throwaway upload before building anything around it, and report a preflight failure to backend rather than working around it.

## 13.7 🟠 `comic.freePreviewPages` can disagree with reality

It's a number the admin types, stored separately from the per-page `isPreviewPage` flags that actually control what gets generated. Nothing forces them to match.

**Never use it for anything user-facing.** For "N free pages" copy, use `pages.filter(p => p.isPreviewPage).length`. For progress, use `jobsEnqueued` from the generate response.

## 13.8 🟠 Connect the WebSocket before calling generate

Non-face pages can complete in a second or two. A socket opened after the generate call will miss their events, and you'll only learn about those pages on your next GET.

## 13.9 🟠 `attach-user` exists but is out of scope

`PATCH /api/public/sessions/:sessionId/attach-user` links an anonymous session to a logged-in account. It's the **only** endpoint in the session tree that requires authentication, and it will become mandatory before payment — the customer must be logged in to check out.

It is **not part of this milestone.** Preview generation works entirely anonymously. Don't wire up Better Auth, social login, or this endpoint yet; it comes with the checkout work, along with its own rules (idempotent for the same user, 409 for a different one).

## 13.10 🟠 There is no cancel, and no way back

Once `/generate` succeeds there is no endpoint to cancel, reset, or revert the session. The photo locks, the details effectively lock, and the only escape is starting a new session from scratch.

Put a clear confirmation step in front of the Generate button — review the name, the pronouns, the photo — because it genuinely is a one-way door.

## 13.11 🟡 Multiple tabs are not coordinated

Two tabs on the same session both receive every event and both render fine. But two tabs both clicking "Regenerate" will consume two of the three variant slots. Rare, and not worth engineering around, but worth knowing when a bug report says "it used my tries."

## 13.12 🟡 No rate limiting exists

Nothing stops a client hammering these endpoints. Don't rely on the server to protect you from your own retry loop — bound your polling and back off your reconnects.

---

# PART 14 — DO NOT BUILD THESE

## 14.1 ⛔ Variant selection / "use this one" submission
`isSelected` is returned but nothing sets it. The confirm endpoint is part of checkout. Track the user's choice in local state; don't invent an API call for it.

## 14.2 ⛔ Checkout, payment, address collection
Not built. The shipping fields on PATCH accept data but nothing consumes it yet.

## 14.3 ⛔ Paid page generation
Pages with `isPreviewPage: false` will never generate in this milestone. Render them locked.

## 14.4 ⛔ PDF download
Not built.

## 14.5 ⛔ Login / account linking
See §13.9.

## 14.6 ⛔ A photo-validation API call
There isn't one and there never will be. Validation is entirely client-side (§5.2). `POST /photo/confirm` is not a validation endpoint — it is a "I have already validated this, save it" endpoint.

## 14.7 ⛔ Cancel / restart-generation controls
See §13.10.

---

# PART 15 — KNOWN LIMITATIONS (accepted by design)

Settled decisions, not gaps awaiting a fix. Plan around them.

**15.1 One photo per session.** `rawPhotoUrls` is an array but only ever holds one entry. There is no multi-photo upload and no "pick the best of three" flow.

**15.2 The photo cannot be changed after generation starts.** Both photo endpoints 409 once the session leaves `PHOTO_UPLOADED`.

**15.3 WebSocket events are never replayed.** The GET is the only recovery mechanism. This is why §2.1 is non-negotiable.

**15.4 No intermediate progress within a page.** The socket fires on completion and on failure only. A page sitting in `GENERATING_SD` for a long time emits nothing — that's normal, not a stall.

**15.5 Pages arrive out of order.** A consequence of face and non-face pages taking wildly different times. Don't build a UI that assumes sequential completion.

**15.6 Sessions expire after 24 hours, but only the WebSocket enforces it.** See §1.2.

**15.7 Backend performs no photo validation whatsoever.** By design — it moved to the frontend. See §5.2.

---

# PART 16 — SUGGESTED BUILD ORDER

Nothing is blocked. This order surfaces the risky parts earliest.

| # | Task | Notes |
|---|---|---|
| 0 | **Throwaway photo upload test** | 🔴 **Do this first, before any UI.** Create a session by hand, get an upload URL, PUT a file from a browser. This proves private-bucket CORS (§13.6) and the Content-Type rule (§5.5) — the two things most likely to block you, and both outside your control to fix |
| 1 | **API layer + types** | Response unwrapping, error normalization, the types from §10. Remember `photo/confirm` nests under `data.session` |
| 2 | **Create session + details form** | §3 and §4. Small, and gets a real `sessionId` into your URL early |
| 3 | **Photo normalization** | §5.1. Test on a real iPhone — HEIC will bite you |
| 4 | **MediaPipe check** | §5.2. Build the gate and the warning UI. Budget more than you think for tuning against real photos |
| 5 | **Full upload chain** | §5.3–5.5, wired to the UI |
| 6 | **`GET /sessions/:id` + resumable routing** | §10. Drop the user into the right step from the snapshot alone. Do this **before** the WebSocket — it's your fallback and your source of truth |
| 7 | **WebSocket + reconnect + re-GET** | §6, §8. The reconnect-triggers-GET rule must be in from the start |
| 8 | **Generate + live preview screen** | §7, §8.3. Three page states, aspect-ratio boxes reserved up front |
| 9 | **Regenerate + variant browsing** | §9. Show remaining attempts; never let them click into a 409 |
| 10 | **Polish** | Expired sessions, `jobsEnqueued: 0`, friendly error copy for `page:error`, the confirmation step before Generate |

**Suggested first end-to-end milestone:** create a session → set name/age/pronoun → upload a photo that passes the face check → generate → watch at least one `page:ready` land in the UI. That thin slice exercises every layer — REST, direct-to-R2 upload, client validation, WebSocket — and everything after it is breadth.

---

# APPENDIX — THE WHOLE FLOW ON ONE PAGE

```
 ┌─ user picks a comic ─────────────────────────────────────────┐
 │  GET /api/public/comics/:comicId   (other doc)               │
 └──────────────────────────────────────────────────────────────┘
                          │
                          ▼
   POST /api/public/sessions  { comicId }
   → 201 { id, wsRoomToken, status: "CREATED", ... }
   ➡ save sessionId + wsRoomToken, put sessionId in the URL
                          │
                          ▼
   PATCH /api/public/sessions/:id  { childName, age, pronounKey }
   → 200 full session
                          │
                          ▼
   ┌─ THE PHOTO ────────────────────────────────────────────────┐
   │  1. normalize   HEIC→JPEG, long edge ~1600px, <2MB         │
   │  2. MediaPipe   exactly 1 face = HARD GATE                 │
   │                 size/centre/sunglasses = warnings only     │
   │  3. POST .../photo/upload-url { fileExtension: "jpg" }     │
   │     → 200 { uploadUrl, key }        (5 min expiry!)        │
   │  4. PUT uploadUrl                                          │
   │     Content-Type: image/jpeg  ← NOT image/jpg              │
   │     body: raw Blob            ← NOT FormData               │
   │  5. POST .../photo/confirm { key }                         │
   │     → 200 { session } ← nested under data.session!         │
   │     status becomes PHOTO_UPLOADED                          │
   └────────────────────────────────────────────────────────────┘
                          │
                          ▼
   OPEN WEBSOCKET  ws://.../?sessionId=&token=
   ⚠ before generate, not after
                          │
                          ▼
   POST /api/public/sessions/:id/generate      (no body)
   → 200 { status: "GENERATING_PREVIEW", jobsEnqueued: N }
                          │
                          ▼
   ┌─ EVENTS STREAM IN, OUT OF ORDER ───────────────────────────┐
   │  page:ready   { pageNumber, variantIndex, imageUrl, ... }  │
   │  page:error   { pageNumber, variantIndex, errorMessage }   │
   │               ⚠ NOT final — retries up to 3x               │
   │  session:preview-ready  { }   ← fires once, at the end     │
   │                                                            │
   │  ON RECONNECT / REFOCUS → GET /sessions/:id                │
   │  events are NEVER replayed                                 │
   └────────────────────────────────────────────────────────────┘
                          │
                          ▼
   status: PREVIEW_READY
   render all pages:  isPreviewPage ? image : paywall overlay
   optional: POST .../pages/:pageNumber/regenerate  (max 3 total)
                          │
                          ▼
              ═══ END OF THIS MILESTONE ═══
        checkout / payment / paid pages / PDF = not built
```

---

**Something here doesn't match what the API actually does?** Raise it with backend rather than working around it — a mismatch means either this document or the code is wrong, and both are worth fixing.
