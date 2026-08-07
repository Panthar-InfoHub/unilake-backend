# Session Walkthrough — July 29, 2026

**Complete record of everything done in this session:** every decision with its reasoning, every file touched, and a line-by-line explanation of all code written.

**Read this instead of re-reading the code.** If something here doesn't match the code, the code changed after this was written — trust the code and update this.

---

# TABLE OF CONTENTS

| § | Section |
|---|---|
| 1 | What this session was about (the narrative) |
| 2 | The blocker list — how it was produced and what happened to each |
| 3 | Every decision made, with reasoning |
| 4 | Database changes (schema + migration) |
| 5 | Code walkthrough — `src/lib/r2.ts` |
| 6 | Code walkthrough — `src/lib/image.ts` (new file) |
| 7 | Code walkthrough — `src/config/generation.ts` |
| 8 | Code walkthrough — `src/services/page.service.ts` (the big one) |
| 9 | Code walkthrough — `src/services/comic.service.ts` |
| 10 | Code walkthrough — `src/validators/bubble.schema.ts` |
| 11 | Code walkthrough — `src/services/bubble.service.ts` |
| 12 | Code walkthrough — `src/validators/comic.schema.ts` |
| 13 | Files deliberately NOT changed, and why |
| 14 | The documentation written |
| 15 | Mistakes made and corrected during the session |
| 16 | What must be tested before trusting any of this |
| 17 | Concepts glossary |

---

# 1. WHAT THIS SESSION WAS ABOUT

## The starting point

The frontend team was about to begin building two things:
1. The **admin comic-upload wizard** — where an admin uploads a comic, its pages, its speech bubbles, and publishes it
2. The **customer-facing catalogue** — where a parent browses comics and views one in detail

You asked for a complete integration guide so the frontend team would never have to guess.

## What actually happened

Writing that guide required reading every route, controller, service and validator in the comic path. **That reading surfaced bugs.** Not theoretical ones — two of them made entire screens impossible to build.

So the session became three things in sequence:

```
1. Write the guide           →  reading the code exposed 14 problems
2. Fix the blocking problems →  3 rounds of code changes
3. Rewrite the guide         →  now that the code was different
```

Then, near the end, you raised one more thing (deleting a single thumbnail), which turned into a fourth small round of changes.

## The four rounds of code change

| Round | What | Files touched |
|---|---|---|
| **A** | Page artwork + masks: private bucket → public bucket | `r2.ts`, `page.service.ts`, `comic.service.ts` |
| **B** | Bubble coordinates: pixels → normalized 0–1 fractions | `schema.prisma`, migration, `image.ts` (new), `generation.ts`, `page.service.ts`, `bubble.schema.ts`, `bubble.service.ts`, `comic.service.ts` |
| **C** | Single-thumbnail deletion | `comic.service.ts`, `comic.schema.ts` |
| **D** | Documentation | `FRONTEND_COMIC_INTEGRATION.md` + the 4 project docs |

## Final state

- `npx tsc --noEmit` → clean
- 23 migrations applied, no schema drift
- `sharp@0.35.3` added as a dependency
- 1 new source file, 7 modified source files, 1 new migration
- **Zero HTTP calls have been made against any of it.** It compiles; it has not been run.

---

# 2. THE BLOCKER LIST

While writing the integration guide I compiled 14 problems found in the code. Here is each one, what it was, and what happened to it.

| # | Problem | Outcome |
|---|---|---|
| 1 | Preview page artwork not displayable to customers | ✅ **Fixed** (Round A) |
| 2 | Admin couldn't re-open a comic to edit bubbles | ✅ **Fixed** (Round A) for artwork; fonts accepted as-is |
| 3 | Bubble coordinates had no reference resolution | ✅ **Fixed** (Round B) |
| 4 | Publish gate checks almost nothing | 🟡 **Decided:** trust the admin, frontend owns the checklist |
| 5 | `freePreviewPages` and `isPreviewPage` don't talk to each other | 🟡 **Decided:** frontend warns |
| 6 | Comic can't be un-themed; pages can't be renumbered | 🟡 **Decided:** permanent, accepted |
| 7 | Upload keys could collide (same millisecond) | ✅ **Fixed incidentally** in Round A for pages; fonts still open |
| 8 | Fonts can't be shared across comics; cross-comic font unchecked on create | 🟡 **Decided:** per-comic is correct; frontend must source the picker correctly |
| 9 | Price reads as string, writes as number | ⬜ Deferred, documented |
| 10 | CORS hardcoded to localhost:3000 | ⬜ Deferred, documented |
| 11 | No pagination anywhere | ⬜ Deferred, documented |
| 12 | Replaced files orphaned in R2 | ✅ **Partly fixed** (pages + thumbnails now clean up) |
| 13 | Two different validation-error message formats | ⬜ Deferred, documented |
| 14 | Countries use PUT while everything else uses PATCH | ⬜ Deferred, documented |

**Blockers 1 and 2 were the real ones.** Everything else was either a decision or a papercut.

## Why 1 and 2 were genuinely blocking

Both had the same root cause, and it's worth understanding properly because it explains Round A entirely.

When a page's artwork was uploaded, three things happened:

1. The backend generated a presigned upload URL pointing at the **private** R2 bucket
2. The browser PUT the file there
3. The backend stored the **key** — a string like `comics/abc/pages/artwork/1753689200000.png`

A key is not a web address. It's more like a shelf number in a locked warehouse. There is no door the browser can open.

Then `GET /api/public/comics/:comicId` handed that shelf number to the frontend in a field literally named `artworkUrl`. The frontend put it in an `<img src>` and got nothing.

**Consequence 1:** the "preview a few pages before you buy" section of the product page could not be built at all.

**Consequence 2 (worse):** the admin bubble mapper needs to *display the artwork* so the admin can drag rectangles over the speech bubbles. During the first upload the browser still has the file in memory, so it works. But the moment the admin refreshes or comes back tomorrow, there's no way to fetch that image back. Given a comic has 24 pages each with multiple bubbles, expecting an admin to finish in one uninterrupted sitting is unrealistic.

Compare with thumbnails, which worked fine — they went to the **public** bucket and ran through `getPublicUrl()` before being saved. Page artwork skipped both steps.

---

# 3. EVERY DECISION MADE, WITH REASONING

## 3.1 Move page artwork and masks to the public bucket

**The options were:**

| Option | Approach | Trade-off |
|---|---|---|
| **A** | Upload to public bucket, store full URL | Simple. Anyone with the link can view the artwork |
| **B** | Keep private, add a signed-download endpoint returning temporary links | Keeps artwork private. More code, and the frontend must refresh expiring links |

**Chosen: A.**

**Reasoning:** you are *already giving preview pages away for free* to attract buyers. Building and maintaining a signed-URL layer — with expiry-refresh logic on the frontend — to protect artwork you publish anyway is effort spent for nothing. What's actually exposed is blank-bubble artwork with no child's face and no personalised text. That's raw material, not the sellable product.

**Accepted risk, stated explicitly:** every page of every comic becomes readable by anyone holding the URL. Keys aren't guessable (UUID + timestamp), so nobody stumbles onto them. But once a URL leaks — a shared screenshot, a browser extension, a scraped session — it works forever and can't be revoked short of deleting the file. You accepted this; it's worth one line in an email to the client since it's their IP.

**What stayed private:** fonts, child photos, LoRA files. The split is now per-asset, not per-feature.

## 3.2 Store the full URL, not the key

Every other public asset in the codebase already did this:

| Model | Client sends | Database stores |
|---|---|---|
| `Comic.coverThumbnailUrls` | `thumbnailKeys` | full URL |
| `Country.flagUrl` | `flagKey` | full URL |
| `HeroImage.imageUrl` | `imageKey` | full URL |
| `TeamMember.imageUrl` | `imageKey` | full URL |
| `CustomerReview.videoUrl` | `videoKey` | full URL |
| **`Page.artworkUrl`** | `artworkUrl` | **key** ← the odd one out |

**Reasoning:** the field is already *named* `artworkUrl`. Make it actually be one. The frontend gets something it can drop straight into `<img src>` with zero work.

## 3.3 Keep the request field names as `artworkUrl` / `maskUrl`

I proposed renaming them to `artworkKey` / `maskKey`, since that's what they carry and it matches `thumbnailKeys`, `flagKey`, `imageKey` everywhere else.

**You chose not to rename.** That's fine — no frontend existed yet so either was cheap, and the cost of keeping it is purely cosmetic confusion.

**But this raised a real ambiguity I had to resolve with you:** if the field is still called `artworkUrl`, does the frontend send a *key* or a *URL*?

| Reading | Flow |
|---|---|
| **A** | Frontend sends the key; backend converts (like every other feature) |
| **B** | Frontend builds the full URL itself and sends it complete |

**Chosen: A.** Three reasons:
1. It matches all five sibling features
2. Reading B would force the frontend to know `R2_PUBLIC_URL_BASE`. If that ever changes (custom domain, CDN swap), you'd redeploy the *frontend* to fix *backend* storage
3. Reading B means the backend writes a client-supplied URL straight into the database — a malformed or hostile value lands in the DB and gets served to users

## 3.4 Masks go public too

Masks are black-and-white head-region shapes. They leak nothing about the story, and the admin dashboard wants to display them for QC (checking the mask lines up with the face). Splitting artwork and masks across buckets would mean two code paths for no benefit.

## 3.5 Bubble coordinates: normalized 0–1 fractions

**The problem:** the bubble mapper saves four numbers — `x`, `y`, `width`, `height`. But nothing recorded **what size image the admin was looking at**.

Picture it: real artwork is 2048px wide. On the admin's laptop it displays at 800px to fit the screen. They drag a box at `x=120`. Is that 120 on the real image, or 120 on the shrunk screen version? Those are completely different spots. Later Sharp has to place text on the full 2048px image — guess wrong and every speech bubble's text lands in the wrong place across the entire book.

**The options:**

| Option | Approach | Trade-off |
|---|---|---|
| **A** | Normalized 0–1 fractions. `x=0.35` means "35% across" | No dimension columns needed for positioning. **Correct even if artwork is re-uploaded at a different resolution.** Zero schema change to the columns themselves |
| **B** | Absolute pixels + new `artworkWidth`/`artworkHeight` columns to scale against | Needs a migration and a rule for what happens on artwork replacement. **Every bubble breaks if artwork resolution changes** |

**Chosen: A.**

**Reasoning:** resolution-independence is the whole game. Under option B, an admin re-uploading a page at higher resolution silently invalidates every bubble on it. Under A, the fractions stay correct. Fractions also mean the frontend never needs `naturalWidth` — it just divides by the displayed size.

**Worked example:**
```
Artwork is 2048 × 1536
Bubble sits at pixel (700, 460), size 560 × 180

STORED AS:
  x:      0.3418   (700 / 2048)
  y:      0.2994   (460 / 1536)
  width:  0.2734   (560 / 2048)
  height: 0.1172   (180 / 1536)

Swap artwork for a 4096px version later?
  → fractions are STILL CORRECT. Nothing to fix.
```

## 3.6 Store artwork dimensions anyway — but only for validation

Fractions don't need dimensions to *position* anything. So why add `artworkWidth`/`artworkHeight` at all? Three uses:

1. The **aspect-ratio warning** (§3.7) needs the *old* dimensions to compare against the new
2. The **mask-match check** (§3.9) compares against them
3. The **admin UI** can display "2048 × 1536" so the artist knows what they uploaded, and the frontend can convert `fontSize` back to pixels for a friendly input

## 3.7 Dimensions are probed by the backend with Sharp — never sent by the client

| Option | Trade-off |
|---|---|
| **Backend probes with Sharp** | Authoritative. Cannot be wrong or faked. Costs one R2 fetch per page save |
| **Frontend sends `naturalWidth`/`naturalHeight`** | Free and instant. But the backend trusts a number it cannot verify |

**Chosen: backend probes.** A wrong or stale client-supplied value silently corrupts every bubble on the page, and nothing would ever detect it. The cost is a few hundred milliseconds on page create — a price worth paying for a value that's load-bearing for print output.

This is also why the guide tells the frontend: **`artworkWidth` and `artworkHeight` are read-only.** Sending them does nothing (Zod strips unknown keys).

## 3.8 Artwork replaced at a different size: warn, don't block

| Option | Trade-off |
|---|---|
| **Warn only if aspect ratio changed** | A different resolution at the same aspect ratio is harmless with normalized coords. Only a changed *shape* actually distorts placement |
| Always warn on any size change | Safer but noisier. Admins learn to click through warnings, which defeats the purpose |
| Do nothing | Simplest, but a squashed page ships silently |

**Chosen: warn only on aspect-ratio change.**

```
Old: 2048 × 1536  (4:3)

New: 4096 × 3072  (4:3)  → silent. Fractions still correct.
New: 2048 × 2048  (1:1)  → WARN: "Aspect ratio changed…re-check bubble positions."
```

**Never blocks the save.** The admin might be mid-fix and blocking would trap them.

## 3.9 Mask must match artwork dimensions exactly — reject on mismatch

| Option | Trade-off |
|---|---|
| **Reject (400)** | Catches at upload instead of after a GPU run |
| Warn but save | Keeps admins unblocked if a mask is temporarily off-size |
| No check | Discovered only when a generated page comes back with the face in the wrong spot |

**Chosen: reject.**

**Reasoning:** ComfyUI overlays the mask and the artwork **pixel-for-pixel**. A mismatch means the child's face lands in the wrong place on *every printed copy of that page*. It's invisible until you look at output, and by then you've burned GPU time. One extra Sharp probe per save is nothing against that.

## 3.10 Bubble bounds are rejected if out of range

With normalized coordinates this is nearly free — pure arithmetic, no database lookup, no artwork needed:

```
ACCEPTED:   x: 0.34, width: 0.27  → 0.61   ✓
            x: 0.0,  width: 1.0   → 1.00   ✓ (full bleed)

REJECTED:   x: 0.85, width: 0.30  → 1.15   past the right edge
            x: -0.05                       negative
            width: 1.4                     wider than the page
```

**A float tolerance was necessary.** The frontend computes these by division. A rectangle dragged flush to the right edge can come out as `1.0000000000000002` and get rejected for no real reason. Hence `BUBBLE_BOUND_EPSILON`.

## 3.11 `fontSize` becomes a fraction too — caught mid-review

This one nearly shipped wrong.

After deciding coordinates would be normalized, `Bubble.fontSize` was still `Int @default(24)` — **absolute pixels**. That gives you resolution-independent geometry with resolution-dependent text, which is exactly the class of bug the normalization was fixing.

`fontSize: 24` on a 2048px-wide artwork is readable body text. The same `24` on a 4096px artwork is half the relative size — the text no longer fills the bubble the admin drew it in. And you'd specifically decided that re-uploading artwork at a different resolution should be *safe*.

**Chosen: normalize it too**, as a fraction of artwork **HEIGHT**.

**Why height and not width:** font size is a vertical measurement everywhere else in typography (CSS `font-size`, points in print). Also, line wrapping inside a bubble depends on *width* — if font size also keyed off width, both variables move together when aspect ratio changes and the text reflows unpredictably.

```
fontSize 0.02  ×  artworkHeight 1536  ≈  31px
```

## 3.12 Single-thumbnail deletion needed no new endpoint

You raised: "deleting a single thumbnail from the bunch isn't available."

**It already was.** The full-array PATCH does it — send the array minus the one you want gone, the backend diffs and deletes it from R2. Three lines of frontend code.

**The real friction was elsewhere:** the API is asymmetric. You *send* keys but *get back* URLs. So to re-send the ones you're keeping, the frontend had to reverse the conversion — which means knowing `R2_PUBLIC_URL_BASE` and keeping it in sync with the backend forever.

**Why that's genuinely dangerous, not just annoying:** if those values drift, the reverse function doesn't throw. It returns the URL unchanged. Then `getPublicUrl()` runs on it and stores:

```
https://pub-xxxx.r2.dev/https://pub-xxxx.r2.dev/comics/temp/abc.png
```

A doubled URL. Every affected thumbnail silently 404s, and the diff logic thinks nothing was removed so the real files linger. Nothing errors.

**Chosen fix:** make the backend accept **either** a key or a URL. ~5 lines. The frontend now sends back exactly what it received.

**Rejected: a dedicated `DELETE /thumbnails/:index` endpoint.** It would be a second path doing the same job, it contradicts an existing recorded decision, and index-based deletion is race-prone when two admins have the page open.

## 3.13 The normalize helper stays local — your call, and it was the better one

I recommended reusing `r2.getKeyFromPublicUrl()`. **You chose a local helper in `comic.service.ts`**, consistent with how heroImage/teamMember/customerReview already inline the base-stripping.

**On reflection your call was better, for a reason beyond consistency:** the two functions have genuinely different contracts.

| | `getKeyFromPublicUrl` (r2.ts) | `normalizeThumbnailInput` (comic.service) |
|---|---|---|
| Input | Always a public URL | **Either** a URL or a bare key |
| Contract | "extract the key from this URL" | "give me a key, whatever form you got" |
| Caller | SD worker, internal, trusted | HTTP request body, **untrusted** |

Sharing an implementation would have given the SD worker's helper "accepts anything" semantics it doesn't want. Keeping them separate is the more correct design.

**Cost accepted:** one more copy of the base-stripping logic in a codebase that already has six. Mitigated by a comment pointing at the other one so it doesn't read as an oversight.

## 3.14 Decisions on blockers 4–8 (product calls, no code)

| Blocker | Your decision | What it means |
|---|---|---|
| 4 — publish validates almost nothing | **Trust the admin** | Backend keeps its 2 checks (≥1 thumbnail, ≥1 price). The other 9 checks are permanently the frontend's job |
| 5 — `freePreviewPages` vs `isPreviewPage` | **Frontend warns** | Backend never checks they agree |
| 6 — no un-theming, no page renumbering | **Permanent** | Documented as accepted limitations, not gaps |
| 7 — upload key collisions | **Skip** | Already fixed for pages during Round A. Fonts still open |
| 8 — fonts per-comic | **Confirmed as designed** | Same typeface in 3 comics = 3 uploads |

## 3.15 Fonts stay private

You decided font selection is **by name only** — the admin picks "ComicSans-Bold" from a dropdown, no visual preview.

**Consequence, stated and accepted:** the admin cannot visually confirm dialogue fits its bubble at the real typeface's metrics. Combined with decision 4 (no publish validation), text overflow won't surface until a printed proof. It's the failure mode to watch for in the first real comic.

---

# 4. DATABASE CHANGES

## 4.1 `prisma/schema.prisma` — `Page` model

**Added two columns:**

```prisma
  pageNumber Int // 1–24
  artworkUrl String? // HD PNG, empty bubbles, R2 public URL
  maskUrl    String? // PNG marking head area, R2 public URL

  // Real pixel size of artworkUrl, probed server-side with Sharp at upload time.
  // Null until artwork is attached. Used to (a) reject a mask whose size doesn't
  // match, (b) warn when a replaced artwork changes aspect ratio, (c) show the
  // size in the admin UI. NOT needed to position bubbles — those are normalized.
  artworkWidth  Int?
  artworkHeight Int?
```

**Why nullable:** artwork is optional at page-create time, so a page can legitimately exist with no dimensions yet.

**Why `Int` not `Float`:** pixel dimensions are always whole numbers.

**Why mask dimensions aren't stored:** the mask is validated against the artwork at write time and rejected on mismatch, so a stored copy would only ever duplicate `artworkWidth`/`artworkHeight`. Nothing would read it.

**Comment fix:** `R2 path` → `R2 public URL`, since the meaning changed.

## 4.2 `prisma/schema.prisma` — `Bubble` model

**The column types did NOT change.** `x/y/width/height` are still `Float`. Only their *meaning* changed. That's precisely why the comment matters — nothing in the type system, the database, or the API response distinguishes `0.34` from `340`:

```prisma
  // Normalized 0–1 fractions of the artwork's dimensions — NOT pixels.
  // x/y is the top-left corner. Constraints (enforced in Zod + bubble.service):
  //   0 <= x, y            x + width <= 1        y + height <= 1
  // Resolution-independent by design: artwork can be re-uploaded at any size
  // without invalidating existing bubbles.
  x      Float
  y      Float
  width  Float
  height Float
```

**`fontSize` did change type:**

```prisma
fontSize Float @default(0.02)     // was: Int @default(24)
```

## 4.3 The migration

`prisma/migrations/20260728144148_add_page_dimensions_and_normalized_bubble/migration.sql`

```sql
-- AlterTable
ALTER TABLE "bubbles" ALTER COLUMN "fontSize" SET DEFAULT 0.02,
ALTER COLUMN "fontSize" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "artworkHeight" INTEGER,
ADD COLUMN     "artworkWidth" INTEGER;
```

Three structural changes. Additive on `pages`, a type+default change on `bubbles`. Safe because the database had **zero bubble rows** — verified before applying.

**Note the default shifted meaning:** the old `24` on a 1536px page was `0.0156`. The new `0.02` is ~28% larger. Arguably better, but it's a real change, not a like-for-like port.

---

# 5. CODE WALKTHROUGH — `src/lib/r2.ts`

Two functions added. Nothing existing was modified.

## 5.1 `getKeyFromPublicUrl` — added, deliberately unused

```ts
export const getKeyFromPublicUrl = (url: string): string => {
  const cleanBase = config.r2.publicUrlBase.replace(/\/$/, "");

  return url.replace(`${cleanBase}/`, "");
};
```

**Line by line:**

| Line | What it does | Why |
|---|---|---|
| `const cleanBase = ...replace(/\/$/, "")` | Strips a trailing slash from the configured base URL | `R2_PUBLIC_URL_BASE` might be set with or without a trailing slash. Normalizing here means the caller never has to care. Mirrors what `getPublicUrl` does |
| `return url.replace(\`${cleanBase}/\`, "")` | Removes `https://pub-xxx.r2.dev/` from the front, leaving the key | This is the exact inverse of `getPublicUrl()` |

**This function has zero callers.** That is intentional and documented in its JSDoc.

**Why it exists:** the SD worker (not yet written) will read `Page.artworkUrl`, which is now a full URL, but needs the raw **key** to download the file from R2. Without this it would have to re-derive the key inline.

**Why it's flagged "do NOT delete as dead code":** a future cleanup sweep would remove an unused export without knowing why it's there.

## 5.2 `downloadFileToBuffer` — added, used by the dimension probe

```ts
export const downloadFileToBuffer = async (
  bucket: "public" | "private",
  key: string
): Promise<Buffer> => {
  const targetBucketName =
    bucket === "public" ? config.r2.publicBucket : config.r2.privateBucket;

  logger.debug(
    { bucket: targetBucketName, key },
    "Downloading object from Cloudflare R2 into memory"
  );

  const response = await r2Client.send(
    new GetObjectCommand({ Bucket: targetBucketName, Key: key })
  );

  const bodyBytes = await response.Body!.transformToByteArray();

  return Buffer.from(bodyBytes);
};
```

**Line by line:**

| Line | What it does | Why |
|---|---|---|
| `bucket: "public" \| "private"` | Takes a logical bucket name, not a raw string | Matches every other function in this file. **Note:** the pre-existing `downloadFileToLocalPath` takes a raw bucket *name* string and is the odd one out — don't copy it |
| `const targetBucketName = bucket === "public" ? ... : ...` | Resolves the logical name to the real bucket from config | Same pattern as `uploadFile`, `getSignedUploadUrl`, `deleteFile` |
| `logger.debug({...}, "...")` | Logs with the data object **first** | Pino's signature is `logger.x(dataObject, message)`. Reversing them is a known past bug in this codebase |
| `r2Client.send(new GetObjectCommand(...))` | Fetches the object | Standard AWS SDK v3 |
| `response.Body!.transformToByteArray()` | Reads the stream into a byte array | The `!` asserts non-null. If R2 returns a 200 there is always a body; a missing object throws before this line |
| `Buffer.from(bodyBytes)` | Converts to a Node `Buffer` | Sharp needs a Buffer |

**Why a Buffer version was needed instead of using `downloadFileToLocalPath`:** the existing function writes to disk. To read an image's dimensions you only need its bytes transiently — a temp file write, read, and cleanup cycle is pointless overhead.

**A known inefficiency, accepted:** this downloads the *entire* file just to read a header. An HD PNG might be 5–8 MB. `GetObjectCommand` supports a `Range` header, and the first ~64 KB would cover every format's header — turning a 24-page upload from ~200 MB of downloads into ~1.5 MB. Skipped for simplicity; noted as an available optimization.

---

# 6. CODE WALKTHROUGH — `src/lib/image.ts` (NEW FILE)

Entire file:

```ts
import sharp from "sharp";
import { ValidationError } from "../utils/errors.js";
import { logger } from "./logger.js";

export type ImageDimensions = {
  width: number;
  height: number;
};

export const probeImageDimensions = async (
  buffer: Buffer,
  label = "image"
): Promise<ImageDimensions> => {
  let metadata;

  try {
    metadata = await sharp(buffer).metadata();
  } catch (error) {
    logger.warn({ error, label }, "Sharp failed to read image metadata");
    throw new ValidationError(
      `The uploaded ${label} could not be read as an image. Upload a valid PNG, JPEG or WEBP file.`
    );
  }

  // Sharp resolves without throwing for some malformed files, but leaves
  // width/height undefined — treat that as unreadable rather than trusting it.
  if (!metadata.width || !metadata.height) {
    logger.warn({ label, metadata }, "Image metadata missing dimensions");
    throw new ValidationError(
      `Could not determine the dimensions of the uploaded ${label}. The file may be corrupt.`
    );
  }

  return { width: metadata.width, height: metadata.height };
};
```

**Why this file exists at all:** it keeps the Sharp import in one place. The SD worker will import from here too for the text-stamping compositing, so it's shared infrastructure, not a single-use wrapper.

**Line by line:**

| Piece | What | Why |
|---|---|---|
| `export type ImageDimensions` | A named `{width, height}` type | Used as a return type across `page.service.ts`. Naming it avoids repeating the inline shape five times |
| `label = "image"` | Optional human-readable name, defaults to `"image"` | Makes errors say *"the uploaded **mask** could not be read"* instead of the generic version. The admin can act on the specific one |
| `try { metadata = await sharp(buffer).metadata() }` | Reads the header | Sharp throws for a non-image (e.g. a PDF renamed to `.png`) |
| `catch → logger.warn + throw ValidationError` | Converts a Sharp throw into a **400** | Without this it escapes as an uncaught 500. `ValidationError` maps to 400 via the error handler |
| `if (!metadata.width \|\| !metadata.height)` | **Second, separate failure mode** | Sharp *resolves successfully* for some malformed files but leaves width/height `undefined`. Trusting that would write `null` dimensions and silently break the mask check downstream |
| `return { width, height }` | Narrowed to `number` | After the guard, TypeScript knows both are defined |

**The two failure modes are the point of this file.** A naive `sharp(buf).metadata()` call handles neither.

---

# 7. CODE WALKTHROUGH — `src/config/generation.ts`

Four constants appended:

```ts
// Bubble geometry is stored as normalized 0–1 fractions of the artwork, never
// pixels. Frontend derives them by division, so a rectangle dragged flush to an
// edge can land on 1.0000000000000002 — this tolerance keeps that valid.
export const BUBBLE_BOUND_EPSILON = 0.0001;

// Bubble.fontSize is likewise a fraction — of the artwork's HEIGHT.
// Rendered size = fontSize * artworkHeight. Default 0.02 ≈ 31px on a
// 1536px-tall page. MAX_FONT_SIZE of 0.25 is already absurdly large (~384px).
export const DEFAULT_FONT_SIZE = 0.02;
export const MIN_FONT_SIZE = 0.005;
export const MAX_FONT_SIZE = 0.25;
```

| Constant | Value | Why this value |
|---|---|---|
| `BUBBLE_BOUND_EPSILON` | `0.0001` | Large enough to absorb float division noise, far too small to let a genuinely out-of-bounds bubble through. `0.0001` of a 2048px artwork is 0.2px |
| `DEFAULT_FONT_SIZE` | `0.02` | **Must match the Prisma `@default(0.02)` exactly.** If they diverge, a bubble created through Zod's default and one created by the DB default would differ |
| `MIN_FONT_SIZE` | `0.005` | ~8px on a 1536px page — below this is unreadable in print |
| `MAX_FONT_SIZE` | `0.25` | ~384px — already absurd. An upper bound exists to catch someone sending pixels by mistake |

**Why these live in `generation.ts` and not inline in the validator:** `DECISIONS.md` has a standing rule — *"Magic numbers in Zod validator bounds for generation-tunable fields must live as named constants in `src/config/generation.ts` and be imported."* That rule was written when `steps`/`cfg` were added, and the same reasoning applies: the SD worker will import the same constants for defensive checks.

---

# 8. CODE WALKTHROUGH — `src/services/page.service.ts`

The most heavily changed file. Both rounds A and B landed here.

## 8.1 Imports

```ts
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import {
  deleteFile,
  downloadFileToBuffer,
  getPublicUrl,
  getSignedUploadUrl,
} from "../lib/r2.js";
import { probeImageDimensions, type ImageDimensions } from "../lib/image.js";
import { config } from "../config/env.js";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../utils/errors.js";
```

| Added | Needed by |
|---|---|
| `randomUUID` | The collision-proof key (§8.4) |
| `deleteFile` | R2 cleanup on update and delete |
| `downloadFileToBuffer` | The dimension probe |
| `getPublicUrl` | Key → URL conversion |
| `probeImageDimensions`, `ImageDimensions` | Sharp wrapper |
| `config` | The inline base-URL stripping. **This file did not import `config` before** — the easiest thing to miss when implementing |
| `ValidationError` | Mask mismatch and unreadable-file errors. This file previously imported only `NotFoundError` and `ConflictError` |

## 8.2 Module constant — `ASPECT_RATIO_TOLERANCE`

```ts
const ASPECT_RATIO_TOLERANCE = 0.01;
```

**Why a tolerance is mandatory:** `2048/1536` and `4096/3072` are both 1.333… but **not bit-identical** in floating point. Comparing with `===` would report an aspect-ratio change on every proportional resize and produce a warning every time — exactly the noise decision 3.8 was trying to avoid.

## 8.3 Local helper — `keyFromPublicUrl`

```ts
const keyFromPublicUrl = (url: string): string => {
  const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");
  return url.replace(`${publicBase}/`, "");
};
```

Used in exactly one place: `updatePage`, when re-verifying an existing mask whose URL is stored but whose *key* is needed to download it.

**Why not `r2.getKeyFromPublicUrl`:** same reasoning as §3.13 — that one is reserved for the SD worker. This follows the existing per-service inline convention.

## 8.4 `getPageArtworkUploadUrl` — two changes

```ts
  const contentType = contentTypeMap[fileExtension];
  const folder = fileType === "masks" ? "masks" : "artwork";
  // randomUUID prevents two upload-url requests in the same millisecond from
  // generating the same key and silently overwriting each other's file.
  const key =
    `comics/${comicId}/pages/${folder}/${randomUUID()}-${Date.now()}.${fileExtension}`;

  const uploadUrl = await getSignedUploadUrl(
    "public",              // ← was "private"
    key,
    contentType!,
    PAGE_ASSET_UPLOAD_EXPIRY_SECONDS
  );

  return { uploadUrl, key };
```

**Change 1 — `"private"` → `"public"`.** One word. **This is the root-cause fix for blockers 1 and 2.** Everything else in Round A follows from it.

**Change 2 — `randomUUID()` added to the key.** Previously the key was `.../${Date.now()}.png` — clock only, nothing random. Two upload-url requests landing in the same millisecond produce **the same key**, and the second upload silently overwrites the first. Page 7's artwork ends up on page 12.

This was blocker 7, which you'd said to skip — but it was a one-line addition on a line already being edited, so it got fixed anyway.

**Unchanged:** still returns `{ uploadUrl, key }`. The frontend's step-1 experience is identical.

## 8.5 Module helper — `probePageAsset`

```ts
async function probePageAsset(
  key: string,
  label: "artwork" | "mask"
): Promise<ImageDimensions> {
  let buffer: Buffer;

  try {
    buffer = await downloadFileToBuffer("public", key);
  } catch (error) {
    logger.warn({ error, key, label }, "Failed to download page asset from R2");
    throw new ValidationError(
      `The ${label} could not be read from storage. Confirm the file upload completed before saving the page.`
    );
  }

  return probeImageDimensions(buffer, label);
}
```

**What it does:** downloads a page asset from the public bucket and reads its pixel dimensions.

**Why the try/catch is the important part:** an R2 download failure here almost always means **the client called POST/PATCH before its upload finished**. That's a client sequencing mistake, not a server fault. Without this catch it would surface as an opaque 500. With it, the admin gets a 400 telling them exactly what to check.

Note the error is thrown *outside* the catch's own try — `probeImageDimensions` throws its own `ValidationError` for a non-image, which passes straight through.

## 8.6 Module helper — `assertMaskMatchesArtwork`

```ts
function assertMaskMatchesArtwork(
  mask: ImageDimensions,
  artwork: ImageDimensions
): void {
  if (mask.width === artwork.width && mask.height === artwork.height) return;

  throw new ValidationError(
    `Mask dimensions (${mask.width}x${mask.height}) must match artwork dimensions (${artwork.width}x${artwork.height}).`
  );
}
```

**Early return on the happy path** — the common case exits immediately.

**Exact equality is correct here**, unlike aspect ratios. These are integers straight from Sharp; there is no float imprecision to absorb. A mask that's off by one pixel *is* wrong.

**The error message names both sizes.** An admin cannot fix a mismatch without knowing what to resize to. This is why the interpolation exists rather than a generic message.

## 8.7 Module helper — `aspectRatioChanged`

```ts
function aspectRatioChanged(
  before: ImageDimensions,
  after: ImageDimensions
): boolean {
  const beforeRatio = before.width / before.height;
  const afterRatio = after.width / after.height;

  return Math.abs(beforeRatio - afterRatio) > ASPECT_RATIO_TOLERANCE;
}
```

`Math.abs` because the change can go either direction — wider or taller both matter.

## 8.8 `createPage` — key→URL conversion

```ts
  // Frontend sends the R2 key returned by getPageArtworkUploadUrl; we store the
  // resolved public URL so it is directly renderable by admin + public clients.
  if (input.artworkUrl !== undefined)
    data.artworkUrl = getPublicUrl(input.artworkUrl);
  if (input.maskUrl !== undefined) data.maskUrl = getPublicUrl(input.maskUrl);
```

**Previously these lines were `data.artworkUrl = input.artworkUrl`** — copying the key straight through.

**This is the missing step that made everything else pointless.** Moving the file to the public bucket achieves nothing if the database still stores a bare key; the frontend still gets an unusable string. This line turns `comics/abc/pages/artwork/9f2c-175.png` into `https://pub-xxxx.r2.dev/comics/abc/pages/artwork/9f2c-175.png`.

**Both `!== undefined` guards preserved** — artwork and mask stay optional at create time.

## 8.9 `createPage` — dimension probe and mask validation

```ts
  // Artwork dimensions are derived server-side, never accepted from the client.
  let artworkDimensions: ImageDimensions | null = null;

  if (input.artworkUrl !== undefined) {
    artworkDimensions = await probePageAsset(input.artworkUrl, "artwork");
    data.artworkWidth = artworkDimensions.width;
    data.artworkHeight = artworkDimensions.height;
  }

  // ComfyUI overlays mask and artwork pixel-for-pixel, so a size mismatch puts
  // the face in the wrong place on every copy. Reject it at upload time.
  // A mask supplied without artwork can't be checked yet — it gets validated in
  // updatePage() when artwork is eventually attached.
  if (input.maskUrl !== undefined && artworkDimensions) {
    const maskDimensions = await probePageAsset(input.maskUrl, "mask");
    assertMaskMatchesArtwork(maskDimensions, artworkDimensions);
  }
```

**Note the `&& artworkDimensions` guard.** A mask supplied *without* artwork can't be compared to anything. Rather than rejecting it, the page saves and the mask is validated later — see §8.11 step 4, which catches exactly this when artwork eventually arrives.

**Note the ordering:** all probing happens **before** `prisma.page.create`. A mask mismatch aborts with a 400 and nothing is written.

## 8.10 `createPage` — return shape

```ts
    return { ...page, warnings: [] as string[] };
```

**Why an empty array rather than omitting the field:** so create and update return the **same shape**. The frontend has one response contract, not two. `as string[]` because TypeScript would otherwise infer `never[]`.

## 8.11 `updatePage` — the hardest logic in the session

This is the piece most likely to be implemented wrong, so it's worth reading carefully.

### The trap

```
Page has artwork A (2048×1536) and mask M (2048×1536) — validated, all fine.
Admin PATCHes ONLY `artworkUrl` to B (4096×3072).
Mask M is now mismatched — but M was never in the request payload.
```

A naive implementation only validates fields present in the request. It would accept this and leave the page in a broken state that no future request would catch.

**The rule: validation runs against the page's RESULTING state, not the incoming fields.**

### Step 1 — key→URL, and queue the replaced file for deletion

```ts
  if (input.artworkUrl !== undefined) {
    const newArtworkUrl = getPublicUrl(input.artworkUrl);
    data.artworkUrl = newArtworkUrl;

    if (page.artworkUrl && page.artworkUrl !== newArtworkUrl) {
      oldR2KeysToDelete.push(page.artworkUrl.replace(`${publicBase}/`, ""));
    }
  }
```

**The `page.artworkUrl !== newArtworkUrl` guard is essential.** If an admin re-submits the *same* key, an unguarded delete would wipe the file the page still points at. The `page.artworkUrl &&` part skips pages that never had artwork.

Same block repeated for `maskUrl`.

### Step 2 — has the artwork actually changed?

```ts
  const warnings: string[] = [];
  const artworkChanged =
    input.artworkUrl !== undefined && data.artworkUrl !== page.artworkUrl;
```

Two conditions: the field was **supplied**, and the resulting URL **differs** from what's stored. Re-submitting an identical key is not a change, so it triggers no re-probe and no warning.

### Step 3 — establish the resulting artwork dimensions

```ts
  let resultingArtwork: ImageDimensions | null =
    page.artworkWidth && page.artworkHeight
      ? { width: page.artworkWidth, height: page.artworkHeight }
      : null;

  if (artworkChanged) {
    const previousArtwork = resultingArtwork;

    resultingArtwork = await probePageAsset(input.artworkUrl!, "artwork");
    data.artworkWidth = resultingArtwork.width;
    data.artworkHeight = resultingArtwork.height;

    if (previousArtwork && aspectRatioChanged(previousArtwork, resultingArtwork)) {
      warnings.push(
        `Artwork aspect ratio changed from ${previousArtwork.width}x${previousArtwork.height} to ${resultingArtwork.width}x${resultingArtwork.height}. Re-check bubble positions on this page.`
      );
    }
  }
```

| Line | Purpose |
|---|---|
| `resultingArtwork = page.artworkWidth && ... ? {...} : null` | **Starts from the stored dimensions.** If artwork isn't changing, this is already the answer — no R2 download needed |
| `const previousArtwork = resultingArtwork` | Captures the *old* value before overwriting, so the ratio comparison has something to compare against |
| `probePageAsset(input.artworkUrl!, "artwork")` | The `!` is safe: `artworkChanged` being true guarantees `input.artworkUrl` is defined |
| `if (previousArtwork && aspectRatioChanged(...))` | The `previousArtwork &&` skips the warning when artwork is being attached for the *first* time — there's nothing to have changed from |
| `warnings.push(...)` | **Does not throw.** Decision 3.8: warn, never block |

### Step 4 — decide which mask to validate ⚠️ *the trap*

```ts
  let maskKeyToVerify: string | null = null;

  if (input.maskUrl !== undefined) {
    maskKeyToVerify = input.maskUrl;
  } else if (artworkChanged && page.maskUrl) {
    maskKeyToVerify = keyFromPublicUrl(page.maskUrl);
  }

  if (maskKeyToVerify && resultingArtwork) {
    const maskDimensions = await probePageAsset(maskKeyToVerify, "mask");
    assertMaskMatchesArtwork(maskDimensions, resultingArtwork);
  }
```

**Three cases, in priority order:**

| Case | Action |
|---|---|
| A new mask was supplied | Verify it (it's already a key — use directly) |
| No new mask, **but the artwork underneath changed** | Verify the **existing** mask (it's a stored URL — convert to a key first) |
| Neither asset touched | `maskKeyToVerify` stays `null` → **zero R2 downloads** |

**Case 2 is the trap.** It's why `keyFromPublicUrl` exists in this file at all.

**Case 3 is a performance requirement, not an optimization.** A PATCH that touches only `steps` or `hasFace` must not trigger any R2 traffic. If it did, every trivial toggle would cost a multi-megabyte download.

### Step 5 — save, then clean up

```ts
  const updated = await prisma.page.update({ where: { id: pageId }, data });

  // Best-effort cleanup — the DB update must stand even if R2 is unreachable.
  for (const oldR2Key of oldR2KeysToDelete) {
    try {
      await deleteFile("public", oldR2Key);
      logger.info({ pageId, oldR2Key }, "Old page asset deleted from R2");
    } catch (error) {
      logger.warn({ error, pageId, oldR2Key }, "Failed to delete old page asset from R2");
    }
  }

  return { ...updated, warnings };
```

**Ordering matters:** all validation happens *before* line `prisma.page.update`. A mask mismatch aborts and nothing is written.

**Cleanup happens *after* the DB write, in try/catch.** If R2 is briefly unreachable, the update must still stand — an orphaned file is a far smaller problem than a failed save. This mirrors the pattern already used in `comic.service.ts`.

**Why `warnings` rides on the return value:** the controller passes the service's return straight to `sendSuccess`, so it lands in `data.warnings` with **no controller change needed**.

## 8.12 `deletePage` — R2 cleanup

```ts
  const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");
  const assetUrls = [page.artworkUrl, page.maskUrl].filter(
    (url): url is string => Boolean(url)
  );

  for (const url of assetUrls) {
    const key = url.replace(`${publicBase}/`, "");
    try {
      await deleteFile("public", key);
      logger.info({ pageId, key }, "Deleted page asset from R2");
    } catch (error) {
      logger.warn({ error, pageId, key }, "Failed to delete page asset from R2");
    }
  }

  await prisma.page.delete({ where: { id: pageId } });
```

**`(url): url is string => Boolean(url)`** is a TypeScript **type predicate**. A plain `.filter(Boolean)` would leave the array typed `(string | null)[]`, and `url.replace(...)` below would be a compile error. The predicate tells TypeScript the survivors are all `string`.

**Why this cleanup was added at all:** deleting a page previously left two publicly-readable files behind with nothing recording them anywhere. That was untidy when the bucket was private; now every orphan is a **live public URL of your client's artwork you've lost track of**.

**Cleanup runs before the DB delete** — the row is the only place the URLs are recorded, so it must be read first.

---

# 9. CODE WALKTHROUGH — `src/services/comic.service.ts`

Three separate changes across two rounds.

## 9.1 `normalizeThumbnailInput` — the single-thumbnail-delete fix

```ts
const normalizeThumbnailInput = (input: string): string => {
  const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");
  const prefix = `${publicBase}/`;

  return input.startsWith(prefix) ? input.slice(prefix.length) : input;
};
```

**What it does:** accepts either a raw R2 key or a full public URL, always returns a key.

**Why `startsWith` + `slice` rather than `.replace()`:** `.replace()` finds the base **anywhere** in the string, not just at the start. Since this function now receives raw keys as well as URLs, "pass through anything that isn't a public URL" needs to be the *intended* behaviour, not a lucky accident. (`.replace()` happens to work on a key because the base isn't present — but only by coincidence.)

**Why it's local and not `r2.getKeyFromPublicUrl`:** §3.13. Different contracts — internal URL→key vs untrusted either-form client input.

**What this buys the frontend:**

| Before | After |
|---|---|
| Must know `R2_PUBLIC_URL_BASE` | Doesn't need it at all |
| Must reverse-engineer keys from URLs | Sends back exactly what it received |
| Silent doubled-URL corruption if bases drift | Impossible — backend owns the conversion |

The frontend delete becomes:
```ts
await patchComic(comicId, {
  thumbnailKeys: comic.coverThumbnailUrls.filter(u => u !== urlToDelete)
});
```

## 9.2 `createComic` — normalize before converting

```ts
    const coverThumbnailUrls = thumbnailKeys.map((entry) =>
      getPublicUrl(normalizeThumbnailInput(entry))
    );
```

Strictly unnecessary today — create only ever receives fresh keys. Included so **both entry points behave identically**. Without it, a future "duplicate this comic" feature that copies thumbnail URLs would silently produce doubled URLs on create while working fine on update.

## 9.3 `updateComic` — normalize, and why the diff still works

```ts
    if (data.thumbnailKeys !== undefined) {
      const newUrls = data.thumbnailKeys.map((entry) =>
        getPublicUrl(normalizeThumbnailInput(entry))
      );
      updateData.coverThumbnailUrls = newUrls;

      const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");
      const removedUrls = comic.coverThumbnailUrls.filter((u) => !newUrls.includes(u));
      oldR2KeysToDelete = removedUrls.map((u) => u.replace(`${publicBase}/`, ""));
    }
```

**The diff logic below the change needed no modification.** Here's why:

```
Stored:  ["https://base/a.png", "https://base/b.png", "https://base/c.png"]
Client sends (deleting b):
         ["https://base/a.png", "https://base/c.png"]

normalize → ["a.png", "c.png"]
getPublicUrl → ["https://base/a.png", "https://base/c.png"]   ← byte-identical to stored

removedUrls = stored.filter(not in new) = ["https://base/b.png"]   ✓ correct
```

Because normalize→convert **round-trips exactly**, a kept thumbnail is never seen as removed.

**Mixed arrays work** — which is the real-world case:
```
["https://base/a.png",        ← kept, sent as URL
 "https://base/c.png",        ← kept, sent as URL
 "comics/temp/new.png"]       ← just uploaded, sent as key
```
All normalize to keys, then to canonical URLs. `b.png` is absent → deleted. That's add-and-remove in one call.

🔴 **The consequence to internalize: omission means deletion.** Sending only the new key permanently deletes every existing thumbnail from R2. No undo.

## 9.4 `deleteComic` — page asset cleanup

```ts
  const comic = await prisma.comic.findUnique({
    where: { id: comicId },
    include: {
      pages: {                                        // ← added
        select: { artworkUrl: true, maskUrl: true },
      },
      _count: { select: { orderSessions: true } },
    },
  });
```

```ts
  const publicBase = config.r2.publicUrlBase.replace(/\/$/, "");   // ← hoisted

  // ...existing thumbnail cleanup loop, unchanged...

  // Pages cascade-delete in the DB, but their R2 assets do not — clean them up
  // here or every deleted comic leaves orphaned, permanently public artwork.
  const pageAssetUrls = comic.pages.flatMap((p) =>
    [p.artworkUrl, p.maskUrl].filter((url): url is string => Boolean(url))
  );

  for (const url of pageAssetUrls) {
    const key = url.replace(`${publicBase}/`, "");
    try {
      await deleteFile("public", key);
      logger.info({ comicId, key }, "Deleted page asset from R2");
    } catch (error) {
      logger.warn({ error, comicId, key }, "Failed to delete page asset from R2");
    }
  }
```

**Why this was needed:** deleting a comic cascade-deletes its pages **in the database only**. A 24-page comic previously left **48 orphaned files** with permanently live public URLs.

**`flatMap` + type-predicate filter** flattens `[[artwork, mask], [artwork, mask], ...]` into one array while dropping nulls and narrowing the type.

**One deviation from the plan:** `publicBase` was hoisted above both loops rather than declared twice in the same function. Behaviour is identical.

## 9.5 `getPublicComicDetails` — expose dimensions

```ts
      pages: {
        where: { isPreviewPage: true },
        orderBy: { pageNumber: "asc" },
        select: {
          id: true,
          pageNumber: true,
          artworkUrl: true,
          // Lets the frontend reserve the correct aspect-ratio box before the
          // preview image loads, avoiding layout shift in the carousel.
          artworkWidth: true,
          artworkHeight: true,
        },
      },
```

Two lines. Prevents cumulative layout shift on the product page — the browser can size the box before the image arrives.

**Not needed for `listComicPages` or `getAdminComicDetail`** — both return the full page row, so the new columns appear automatically.

---

# 10. CODE WALKTHROUGH — `src/validators/bubble.schema.ts`

Rewritten. This is where the normalized-coordinate contract is enforced for creates.

## 10.1 Imports

```ts
import {
  BUBBLE_BOUND_EPSILON,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from "../config/generation.js";
```

## 10.2 `createBubbleSchema` — per-field bounds

```ts
    x: z
      .number()
      .min(0, "x must be a 0–1 fraction of the artwork width")
      .max(1, "x must be a 0–1 fraction of the artwork width"),
    ...
    width: z
      .number()
      .gt(0, "width must be greater than 0")
      .max(1, "width cannot exceed the full artwork width"),
```

**Before:** `x: z.number()` (any float, negatives allowed) and `width: z.number().positive()` (no upper limit).

| Field | Rule | Why |
|---|---|---|
| `x`, `y` | `.min(0).max(1)` | A fraction outside 0–1 is off the artwork |
| `width`, `height` | `.gt(0).max(1)` | `gt(0)` not `min(0)` — a zero-width bubble is meaningless. `max(1)` — can't be wider than the page |

**The error messages say "0–1 fraction"** deliberately. A developer sending pixels gets told the unit, not just "too large".

## 10.3 `createBubbleSchema` — `fontSize` 🔴 the easily-missed one

```ts
    // Fraction of the artwork's HEIGHT, not pixels.
    fontSize: z
      .number()
      .min(MIN_FONT_SIZE, `fontSize must be at least ${MIN_FONT_SIZE}`)
      .max(MAX_FONT_SIZE, `fontSize cannot exceed ${MAX_FONT_SIZE}`)
      .default(DEFAULT_FONT_SIZE),
```

**Before:** `z.number().int().positive().default(24)`.

🔴 **`.int()` would reject `0.02` outright.** Once the schema column became `Float @default(0.02)`, the validator and the database disagreed — **every bubble create with a normalized font size would return a 400** until this was fixed.

This is the single most likely thing to be overlooked when implementing, because the field looks unrelated to the coordinate work.

## 10.4 `createBubbleSchema` — the object-level refines

```ts
  .refine((data) => data.x + data.width <= 1 + BUBBLE_BOUND_EPSILON, {
    message: "Bubble extends past the right edge of the artwork",
    path: ["width"],
  })
  .refine((data) => data.y + data.height <= 1 + BUBBLE_BOUND_EPSILON, {
    message: "Bubble extends past the bottom edge of the artwork",
    path: ["height"],
  });
```

**Why these can't be per-field rules:** `x: 0.9` is legal on its own. `width: 0.5` is legal on its own. **Together they overflow.** Only an object-level check sees both.

**`path: ["width"]`** makes the error point at the offending field, so `validateBody`'s message reads `"width: Bubble extends past the right edge"` rather than a pathless string.

**`+ BUBBLE_BOUND_EPSILON`** — the float tolerance from §7.

## 10.5 `updateBubbleSchema` — deliberately missing the refines

```ts
// No sum refine here: PATCH is partial, so Zod may only see `x` and have no idea
// what `width` is. That cross-check lives in bubble.service.updateBubble(),
// where the existing row is available to merge against.
```

**This is a deliberate gap, not an oversight**, hence the comment. Same per-field bounds, same `fontSize` fix, but the sum check moves to the service — see §11.

`sortOrder` keeps its pre-existing asymmetry: `.int()` on create (negatives allowed), `.int().nonnegative()` on update. Not introduced this session; documented in the guide so the frontend isn't surprised.

---

# 11. CODE WALKTHROUGH — `src/services/bubble.service.ts`

One change: closing the gap Zod deliberately left.

```ts
  // The bounds cross-check can't live in Zod for a partial update — a body
  // containing only `x` gives Zod no `width` to add it to. Merge the incoming
  // values over the stored ones and validate the resulting rectangle.
  const merged = {
    x: input.x ?? bubble.x,
    y: input.y ?? bubble.y,
    width: input.width ?? bubble.width,
    height: input.height ?? bubble.height,
  };

  if (merged.x + merged.width > 1 + BUBBLE_BOUND_EPSILON) {
    throw new ValidationError(
      "Bubble extends past the right edge of the artwork"
    );
  }

  if (merged.y + merged.height > 1 + BUBBLE_BOUND_EPSILON) {
    throw new ValidationError(
      "Bubble extends past the bottom edge of the artwork"
    );
  }
```

**Why this matters concretely:** an admin drags a bubble rightward. The frontend sends only `x: 0.95`. Without this check the bubble silently overflows the page, because `width` was never re-examined.

**`??` not `||`** — nullish coalescing. `input.x || bubble.x` would incorrectly fall back to the stored value when `x` is legitimately `0`.

**`bubble` is already loaded** at the top of the function for the existing font-ownership check, so this costs no extra query.

**Placement:** after the update payload is built, before `prisma.bubble.update`. A rejection means nothing is written.

`ValidationError` and `BUBBLE_BOUND_EPSILON` added to this file's imports — it previously had only `NotFoundError` and `ConflictError`.

---

# 12. CODE WALKTHROUGH — `src/validators/comic.schema.ts`

One small change:

```ts
    // Entries may be freshly-uploaded R2 keys or URLs the client is re-sending
    // to keep. The service normalizes both. min(1) is what prevents an admin
    // from removing the final thumbnail.
    thumbnailKeys: z
      .array(z.string().min(1))
      .min(
        1,
        "A comic must have at least one thumbnail — you cannot remove the last one"
      )
      .max(10, "Maximum 10 thumbnails per comic")
      .optional(),
```

**The `.min(1)` rule already existed** — it was never possible to delete the last thumbnail. Only the *message* changed, from `"At least one thumbnail is required"` to something that explains the situation an admin is actually in when they hit it.

The comment records two non-obvious facts: entries may be either form, and `min(1)` is load-bearing for the last-thumbnail rule.

---

# 13. FILES DELIBERATELY NOT CHANGED

Listed so you know these were considered and consciously left alone.

| File | Why untouched |
|---|---|
| `src/validators/page.schema.ts` | Field names stay `artworkUrl`/`maskUrl` (your decision). **`artworkWidth`/`artworkHeight` deliberately NOT added as accepted input** — accepting them from the client re-opens the trust problem. Zod strips unknown keys, so a client sending them is harmless |
| `src/controllers/page.controller.ts` | Passes `req.body` through; `warnings` rides on the service return value, so no controller change was needed |
| `src/controllers/bubble.controller.ts` | Same |
| `src/services/font.service.ts` | Fonts stay **private** (decision 3.15) |
| `src/services/session.service.ts` | Child photos stay **private** |
| `getLoraUploadUrl` in comic.service.ts | Stays **private**, unused |
| The 6 pre-existing inline base-strippings | heroImage, teamMember ×2, customerReview, comic ×2 — left alone per your convention call |
| `src/routes/admin.ts` / `public.ts` | **No new endpoints.** Everything rides existing routes |
| `.env` / `env.ts` | No new variables. `R2_PUBLIC_BUCKET_NAME` and `R2_PUBLIC_URL_BASE` already existed |

---

# 14. THE DOCUMENTATION WRITTEN

## 14.1 `FRONTEND_COMIC_INTEGRATION.md`

Written, then rewritten twice as decisions landed. Final structure — 12 parts:

| Part | Contents |
|---|---|
| 0 | Mental model, the 3-step upload pattern, bucket table, auth **including how to log in**, response envelope, the two error-message formats |
| 1 | **How to build this** — recommended stack, API layer with code, TanStack Query invalidation map, wizard architecture, react-konva mapper, upload UX patterns |
| 2 | Countries & Themes — 9 endpoints in full |
| 3 | The 6-step wizard — every endpoint with request fields, rules, response samples |
| 4 | Managing an existing comic, **including §4.1.1 thumbnail delete/add/reorder/set-primary** |
| 5 | User-facing pages + adjacent endpoints not covered |
| 6 | Complete endpoint index |
| 7 | Path-shape gotchas |
| 8 | Enum & numeric bounds reference |
| 9 | 17 cautions & catches |
| 10 | Do not build these |
| 11 | Known limitations accepted by design |
| 12 | Suggested build order |

**Key content decisions:**
- **Part 1 exists** because the first version documented *what* the endpoints were but not *how* to approach the integration. You flagged the gap.
- **react-konva recommended** for the bubble mapper. Zoom was the deciding factor: artwork is ~2048px shown at ~900px, and placing bubbles precisely at 44% scale ×24 pages is genuinely hard. Konva makes zoom/pan a `scale` prop; DOM libraries make you fight CSS transforms and hit-testing simultaneously.
- **"Normalize only at the API boundary"** — work in pixels inside the component, convert on send/load. If fractions leak into drag handlers you get bugs where rectangles jump on the second drag.
- **§4.1.1 written after you asked** about single-thumbnail deletion, with working code for all four operations.
- **The auth section was added last**, after a final audit found the guide never explained how to log in — it documented session cookies and manual role assignment but omitted Better Auth's `/api/auth/*` surface entirely, leaving the admin panel's first screen undocumented.

## 14.2 Project docs updated

| File | What changed |
|---|---|
| `PROJECT_CONTEXT.md` | 6 targeted edits: never-do additions, Sharp/Konva stack rows, 3 new design principles, `Page`/`Bubble` field lists, `src/lib/image.ts` in folder structure, public-artwork security note |
| `CURRENT_STATE.md` | Rewritten from scratch |
| `DECISIONS.md` | 9 new never-dos, 3 new finalized sections, 6 mistakes caught, 5 entries moved to superseded |
| `SESSION_LOG.md` | July 29 entry added; July 26 collapsed to a one-liner |

---

# 15. MISTAKES MADE AND CORRECTED

Recorded because the pattern matters more than the individual errors.

## 15.1 I claimed the public bucket's CORS was probably already configured

**What I said:** "almost certainly fine because thumbnails already upload from the browser."

**Why it was wrong:** there is no frontend. Every upload had been tested through **Apidog**, which is not a browser and never sends a CORS preflight request. Cloudflare had never been asked to answer one.

**Corrected to:** "assume unconfigured, verify before the team starts."

**Lesson:** "it must already work because X uses it" is only valid if X actually exercises the same code path. Apidog and a browser do not.

## 15.2 I recommended reusing `getKeyFromPublicUrl`; you overruled me

You preferred a local helper for consistency with the existing per-service convention.

**On reflection you were right for a stronger reason than consistency** — see §3.13. The two functions have different contracts, and sharing one would have given the SD worker's helper "accepts anything" semantics it doesn't want.

## 15.3 `fontSize` was about to ship as `Int @default(24)`

Caught during schema review. Normalizing geometry while leaving typography in pixels would have reintroduced the exact bug being fixed. See §3.11.

## 15.4 §10.5 of the guide read as "thumbnail deletion is unsupported"

**You caught this.** The claim ("no sub-endpoints exist") was literally true, but it sat under a header reading **DO NOT BUILD THESE**, alongside six items that genuinely meant "this feature doesn't exist."

**The flaw:** two different kinds of item wearing the same ⛔ icon. Anyone skimming a "do not build" list — which is what people do — would conclude thumbnail deletion wasn't supported. The opposite of true, and the one thumbnail feature just enabled.

**Fixed:** both items moved under a divider with an explicit lead-in, icons changed to ⚠️, and each now opens with what IS supported before listing the endpoints that don't exist.

## 15.5 The guide never explained how to log in

Found in the final audit. It described what a session cookie does and that roles are assigned manually, but never mentioned Better Auth's `/api/auth/*` endpoints or the client library — leaving the admin panel's **first screen** undocumented.

Worse than the §10.5 issue in practical terms: the team would have been blocked at step zero.

---

# 16. WHAT MUST BE TESTED

🔴 **Nothing in this session has been run against a live server.** It typechecks. That is all that is known.

## Priority 1 — the two edge cases most likely to be wrong

| # | Test | Expect |
|---|---|---|
| 1 | PATCH **only** `artworkUrl` on a page that already has a mask, to a different size | **400** — §8.11 step 4 |
| 2 | PATCH only a bubble's `x`, pushing it past the edge | **400** — §11 merged check |

## Priority 2 — the one that silently destroys data

| # | Test | Expect |
|---|---|---|
| 3 | PATCH the same thumbnail URLs in a **different order** | Order changes, **NO files deleted** |

If normalize doesn't round-trip byte-identically, every reorder wipes every thumbnail with no error.

## Priority 3 — the core paths

| # | Test | Expect |
|---|---|---|
| 4 | Browser PUT from `localhost:3000` to a page upload URL | 200 (proves CORS — Apidog can't) |
| 5 | POST page with a key | `artworkUrl` is a full `https://` URL |
| 6 | **Paste that URL into an incognito tab** | Image renders. *This is the actual test* |
| 7 | POST page with artwork | `artworkWidth`/`artworkHeight` populated |
| 8 | POST page, artwork + matching mask | 201 |
| 9 | POST page, artwork + mismatched mask | 400 naming both sizes |
| 10 | PATCH artwork → same aspect, different size | 200, **no** warning |
| 11 | PATCH artwork → different aspect | 200, **warning present** |
| 12 | PATCH only `steps` | 200, **zero R2 downloads in logs** |
| 13 | POST page for a file never uploaded | Clean 400, not 500 |
| 14 | Bubble `{x:0.85, width:0.30}` | 400 |
| 15 | Bubble `{x:0.5, width:0.5}` | 201 (epsilon works) |
| 16 | Bubble `fontSize: 0.02` | 201 |
| 17 | Bubble `fontSize: 24` | 400 |
| 18 | Delete one thumbnail | File gone from R2, others still resolve |
| 19 | PATCH `thumbnailKeys: []` | 400 with the new message |
| 20 | DELETE page | Both files gone from R2 |
| 21 | DELETE draft comic | All page + thumbnail files gone |
| 22 | Two upload-url requests back to back | **Two different keys** |

---

# 17. CONCEPTS GLOSSARY

Terms used throughout, defined once.

**Key** — an object's path inside an R2 bucket, e.g. `comics/abc/pages/artwork/9f2c-175.png`. Not reachable from a browser on its own. Think shelf number.

**Public URL** — a key prefixed with `R2_PUBLIC_URL_BASE`, e.g. `https://pub-xxxx.r2.dev/comics/abc/...`. Directly usable in `<img src>`.

**Presigned upload URL** — a temporary, cryptographically signed URL that permits one PUT to one specific key with one specific `Content-Type`. Expires (10–15 min here). The signature covers the headers, which is why sending the wrong `Content-Type` yields a 403.

**Normalized coordinate** — a value between 0 and 1 expressing a position as a *fraction* of a dimension rather than an absolute pixel count. `x: 0.35` = 35% across, whatever the image's real width.

**Probe** — reading an image's header to extract its dimensions without decoding the whole image. Done by Sharp.

**Aspect ratio** — `width / height`. Two images with the same ratio are the same shape at different sizes. **Never compare with `===`** — floating point.

**Best-effort cleanup** — an R2 delete that runs in a try/catch and only logs on failure. The database write is authoritative; a failed cleanup leaves an orphaned file, which is far less bad than a failed save.

**Type predicate** — TypeScript's `(x): x is string => ...`. Tells the compiler that a `.filter()` narrowed the element type, which a plain `Boolean` filter cannot express.

**Full-array replacement** — an update model where the client sends the complete desired state rather than a delta. Used for `thumbnailKeys` and `pricing`. Simple contract, but **omission means deletion**.

**Round-trip** — converting a value out of one form and back, expecting the original. `normalize → getPublicUrl` must produce a byte-identical URL, or the thumbnail diff silently deletes kept files.

---

*Generated at the end of the July 29, 2026 session. If anything here contradicts the code, the code changed after this was written.*
