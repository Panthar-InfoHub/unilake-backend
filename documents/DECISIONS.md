# Unilake Backend — Decisions

**Finalized decisions with one-line reasoning.** Prune superseded entries — don't keep historical footnotes.

**⚠️ markers:** entries tagged `⚠️ CONTRADICTORY (Aug 11 audit)` are places where the code currently does something different from the decision recorded here. They are flagged rather than rewritten, because the decision is still the intent — the code is what needs to change. Full list with priorities in `CODE_VS_DOCS_AUDIT.md`. Clear the marker when the code is fixed.

---

## NEVER DO (rejected approaches)

- **NestJS** — DI-container overhead not worth it for solo dev.
- **Winston logging** — Pino chosen. **⚠️ CONTRADICTORY (Aug 11 audit):** `winston` is still listed in `package.json` `dependencies`. Nothing imports it, but it ships to production. Either the dependency or this rule needs to go.
- **Socket.IO** — `ws` sufficient; rooms via `Map`.
- **MongoDB** — Postgres relational fit.
- **Single R2 bucket with prefixes** — R2 public toggle is bucket-level.
- **Prisma `connect` for pricing rules** — direct FK writes preferred.
- **Hardcoded free-preview page counts** — per-comic via `Comic.freePreviewPages`.
- **Comic-level generation prompts** — prompts page-specific only.
- **Backend Python photo validation** — moved to frontend MediaPipe.js.
- **Frontend sending `userId` in body** — always from Better Auth cookie.
- **ComfyUI infra setup as ongoing responsibility** — deployment help is scope-limited to producing an endpoint URL for the client; ongoing GPU ops remains client's job per SOW.
- **`PageVersion` with bare `pageNumber Int`** — must use real `pageId` FK.
- **WebSocket `{ server: httpServer }`** — `{ noServer: true }` needed for pre-handshake auth.
- **Old MediaPipe `mp.solutions` API** — fully removed.
- **Python versions other than 3.11.x** — 3.14 incompatible with TensorFlow.
- **Pupil-shape contour / frame-bridge-uniformity sunglasses detection** — rejected with real evidence.
- **`validateParams` middleware** — retrofit cost too high.
- **Two photos per session** — single photo.
- **Signed R2 URLs to Python** — Node downloads to temp file first.
- **Cloud Pub/Sub over BullMQ** — revisit at scale.
- **Alpine Docker base** — native npm packages need glibc.
- **Cascade-delete font references from bubbles** — silent data loss.
- **Cross-comic font assignment** — validated at bubble update. Scope note: `createBubble` does not run this check; only `updateBubble` does.
- **RunPod Cached Model feature for face-swap endpoint** — designed for single-HF-model LLM workers; face-swap uses 9 heterogeneous files across 4 folders + one-model-per-endpoint limit + custom path-mapping work required. Revisit if RunPod adds multi-model cache support.
- **Serverless as default deployment mode without warm worker** — cold starts on 40+ GB Qwen model = 60–180s; incompatible with live-preview UX. Active Workers ≥ 1 in production.
- **Pointing production endpoint at comfy.getrunpod.io's Docker Hub image** — client should own full pipeline; rebuild on client's RunPod GitHub integration instead.
- **Client sending workflow-JSON round-trips through their own backend routing** — Express backend sends workflow directly to RunPod endpoint via HTTPS; RunPod is the transport, not comfy.getrunpod.io at runtime.
- **Waiting for comfy.getrunpod.io's Docker build to finish before deploying to RunPod** — comfy.getrunpod.io's build is independent; RunPod builds from GitHub separately.
- **Raw `schema.parse()` left uncaught in a controller** — must be `safeParse` + thrown `ValidationError`, or wrapped in try/catch converting `ZodError`; otherwise it escapes as an uncaught 500 instead of a 400.
- **Ad hoc per-controller success response shapes** — replaced by the shared `sendSuccess()` envelope; never hand-roll a one-off `res.json({...})` for a success path again.
- **Omitting `sessionId` when re-emitting the WebSocket `connection` event** — `wss.handleUpgrade`'s callback must pass `sessionId` through to `wss.emit("connection", ws, req, sessionId)`, or every socket silently joins the same "undefined" room.
- **HD upscale stage / `hdGenerationQueue` / `hdWorker` re-introduction** — HD pipeline dropped. SD output is the final print-ready image. All future variants stay in the SD pipeline.
- **Stamping text AFTER ComfyUI** — text is always stamped onto raw artwork FIRST, then the stamped image is sent to ComfyUI for face-swap. Reversing this order breaks the whole flow.
- **SD/HD-stage-based variant caps** — cap is determined by payment status (`hasPaid ? 8 : 3`), never by which generation stage the session is in.
- **Deleting HD code before launch** — commented-out HD code (queues, workers, imports) stays in the repo until product launch is confirmed stable, then gets swept. Explicit choice to keep a rollback path if the product decision reverses.
- **`.map()` callbacks that wrap the promise in braces without returning** — `Promise.all(list.map((x) => { asyncFn(x) }))` awaits `[undefined, ...]`. Always implicit-return or explicit `return`.
- **Bare `pip install onnxruntime-gpu` in ComfyUI Dockerfiles targeting `runpod/worker-comfyui`** — the base image is CUDA 12.x; onnxruntime-gpu 1.27.0+ is CUDA 13. Pin `"onnxruntime-gpu<1.27"` when installing.
- **Trusting comfy.getrunpod.io's Dockerfile output as-is for custom nodes cloned via raw `git clone`** — the tool clones the repo but skips `pip install -r requirements.txt`. Must add manually. Also check whether the custom node has an `install.py` (like ReActor) that installs deps outside requirements.txt.
- **Committing large placeholder images baked into ComfyUI worker Docker builds** — RunPod's GitHub build has a 30-min hard timeout. Every extra layer adds export time. Strip unused downloads and placeholder inputs before pushing.
- **Guessing a fix from a RunPod status error alone** — the top-level error message (`missing_node_type`, etc.) is often ambiguous. Always pull container logs and read the actual Python traceback before proposing a fix.
- **Magic numbers in Zod validator bounds for generation-tunable fields** — bounds like `min(1).max(8)` for steps must live as named constants in `src/config/generation.ts` and be imported. The SD worker will import the same constants for defensive checks.
- **Raw `git checkout <hash>` without confirming the commit contains the exact nodes/classes the workflow references** — comfy.getrunpod.io picks a commit that exists, not one validated against your workflow. If time-pinning, verify the target commit against a known-working local run.
- **Per-comic LoRA sync / publish-time asset sync worker** — client confirmed single face-swap LoRA for entire catalogue (baked in Docker). Publish stays as synchronous DB status flip; no BullMQ publish worker, no ComfyUI asset push, no async progress UI. Revisit ONLY if client reverses on multi-style comics.
- **Deleting LoRA schema fields / endpoint / Zod fields now** — retained-but-unused pattern chosen over deletion. Cost of retention is zero (fields optional, endpoint unused); cost of deletion + potential reversal is high. Sweep post-launch with HD cleanup only if decision holds ~1–2 months.
- **Exposing LoRA upload step in admin wizard UI** — frontend must skip this step. Backend fields stay for schema stability but wizard UI does not surface them.
- **Two thumbnail upload endpoints (single + batch)** — batch endpoint (`POST /comics/thumbnails/upload-urls`) handles single case trivially (`files: [{...}]`). Single-file endpoint removed to avoid two paths doing the same thing.
- **Diff-based thumbnail array patching from frontend** — frontend sends the FULL desired `thumbnailKeys` array on update, backend computes the removed-URLs diff for R2 cleanup. Simpler frontend contract; no `PATCH .../thumbnails/add` or `/remove` sub-endpoints.
- **Page artwork / masks in the private bucket** — moved to PUBLIC July 29; admin bubble-mapper and public preview carousel both need to render them, and a signed-URL layer to protect artwork we already give away free is not worth building.
- **Storing bare R2 keys in `Page.artworkUrl` / `maskUrl`** — store the resolved full public URL, matching thumbnails/flags/hero/team/review. The field is named `Url`; make it be one.
- **Absolute-pixel bubble geometry or `fontSize`** — normalized 0–1 fractions only. Pixels are meaningless without a reference resolution and break when artwork is re-uploaded at a different size.
- **Accepting `artworkWidth` / `artworkHeight` from the client** — always Sharp-probed server-side; a client-supplied value cannot be verified and silently corrupts every bubble on the page.
- **Dedicated thumbnail add / remove / reorder endpoints** — all four operations ride the full-array `PATCH /comics/:comicId`. Index-based deletion is race-prone with two admins on one screen.
- **Using `r2.getKeyFromPublicUrl()` for request-body normalization** — it assumes its input is always a URL, and a request body may carry either a URL or a bare key. That case keeps its own local helper (`normalizeThumbnailInput`). *(Amended Aug 24: the rule used to say "outside the SD worker," which was too broad. Converting a **stored** `*Url` column back to a key for deletion is exactly what the helper is for, and it now has callers in the SD worker, PDF worker, `howItWorks.service.ts` and `blog.service.ts`.)*
- **Blocking a publish on anything beyond thumbnails + pricing** — the remaining 9 checks are permanently the frontend's responsibility. Deliberate, not a gap to close later.
- **Making fonts public to enable `@font-face` preview** — font selection is by name only; the client picks from the per-comic list. Accepted trade-off: no visual overflow check until a printed proof.
- **Webhook-based RunPod result delivery** — polling was chosen. Adding a webhook route later would create two systems doing the same job.
- **`/runsync` for RunPod jobs** — connection timeouts + BullMQ retry semantics turn a held-open HTTP call into an unpredictable failure mode. Especially bad given 60–180s job durations approaching proxy timeouts.
- **Modifying node 473 (negative prompt) per request** — it's a generic quality guardrail; per-page overrides not planned. The positive prompt (node 111) IS patched per request from `Page.pagePrompt`.
- **Font `randomUUID()` in upload keys** — tried and reverted in the August 3 session. Font upload contract stays sequential (`Date.now()` only); real-world usage is 1–3 fonts per comic, sequential upload is fine, and one less rule reduces cognitive load for the frontend team. Locked as a decision, not a temporary workaround.
- **Mutating the imported `apiWorkflow` JSON object** — it's a shared module-cached reference in Node ESM; mutation would leak state across concurrent jobs. Always `JSON.parse(JSON.stringify(...))` or `structuredClone` before patching.
- **Preview page selection based on `pageNumber <= freePreviewPages`** — `Page.isPreviewPage` boolean is the ONLY source of truth for which pages are free. Admin picks WHICH pages (not necessarily the first N). `Comic.freePreviewPages` is metadata + sanity-check warning only. Query filter must always be `where: { comicId, isPreviewPage: true }`.
- **BullMQ enqueue inside a Prisma `$transaction`** — Redis is a separate system that doesn't roll back with Prisma. Enqueue AFTER DB commit succeeds. Worst case is orphaned QUEUED rows if Redis is down — and `enqueuePreviewGenerationJobs` is now re-entrant, so a retry reuses them (see FINALIZED APPROACHES). Reinforced Aug 21 in send-to-print and PDF worker.
- **Blind `pageVersion.create()` on a re-generate** — `enqueuePreviewGenerationJobs` must load existing `variantIndex: 0` rows first and create only what's missing, or a retry after a Redis outage dies on the `(orderSessionId, pageId, variantIndex)` unique constraint with no way to recover the session.
- **Pairing PageVersion rows to pages by array index** — reused rows and freshly-created rows come from two different queries, so positional pairing silently attaches the wrong BullMQ priority to the wrong page. Always look the page up by `pageId`.
- **Job payload carrying anything beyond `pageVersionId`** — worker looks up all related data from DB. Keeps the enqueue+dequeue contract minimal and the worker's row idempotency clean. (Send-to-print / PDF / Shiprocket jobs carry `{ orderSessionId }` for the same reason.)
- **Session status flip to `GENERATING_PREVIEW` before enqueue succeeds — *in `triggerGeneration`*** — flip AFTER. Otherwise a failed enqueue leaves the session stuck in `GENERATING_PREVIEW`, which `GENERATABLE_STATUSES` does not accept, so the user can never re-run `triggerGeneration` and never reach the orphan-row recovery inside `enqueuePreviewGenerationJobs`. **Scope note:** this rule is specific to the first-generation path. `regeneratePage` deliberately flips `FAILED → GENERATING_PREVIEW` *before* its enqueue — see the recovery-path entry under SD worker orchestration for why the opposite order is correct there.
- **Priority values above BullMQ's 21-bit limit** — max is 2,097,151 (2^21 − 1). Any formula using `Date.now()` values directly is 800,000x too big and throws `Priority should be between 0 and 2097152`. Compress to fit.
- **PNG for RunPod API payload** — a stamped 2000×1455 PNG is ~8 MB; base64 pushes past RunPod's 10 MiB API cap. Transcode to JPEG q88 for the round-trip; R2 STORAGE stays PNG at print quality.
- **PNG with Sharp's default compression settings** — `compressionLevel: 6` inflates output vs source. Use `compressionLevel: 9, adaptiveFiltering: true` for R2 storage (lossless, ~20-40% smaller).
- **Native JSON.stringify with BigInt fields** — throws `Do not know how to serialize a BigInt`. Patch `BigInt.prototype.toJSON` globally in `app.ts` to return `.toString()`. `PageVersion.seed` is the only BigInt in the schema.
- **Backend-side photo validation gate** — validation moved to frontend fully. `POST /sessions/:id/photo/validate` renamed to `POST /sessions/:id/photo/confirm`. Frontend runs MediaPipe.js and only calls confirm after passing its own checks.
- **Flat `pageVersions[]` in GET /sessions/:id response** — replaced by nested `pages[].variants[]` shape. Frontend needs to render locked-page overlays, so response must include ALL pages, not just ones with variants.
- **Server-side R2 CopyObject for non-face pages** — download stamped image and re-upload under `/final/` prefix to match the face-branch code path. Session-owned file copy for referential safety if comic gets deleted.
- **Shared `finalImageUrl` pointing at comic-level artwork for non-face pages without bubbles** — every session owns its own copy. Comic deletion would break referential integrity otherwise. Extra R2 traffic is worth the safety.
- **Photo cache keyed by anything other than `sessionId`** — session has exactly one photo; keying by sessionId matches the acquire/release contract. Keying by `photoUrl` adds complexity for no gain.
- **Photo cache without reference counting** — plain LRU or TTL-only cache would either evict mid-job or leak indefinitely. Refcount + TTL safety net handles both burst-completion and crashed-worker scenarios.
- **Serving the print-resolution PNG to a browser** — `finalImageUrl` is a lossless 4–5 MB master; a six-page preview came to ~27 MB. Every finished page also gets a WebP derivative at `displayImageUrl`. Clients render that and fall back to `finalImageUrl` only when it is null.
- **Failing a generation job because the display derivative failed** — `buildAndUploadDisplayImage` never throws. The GPU round-trip is already paid for by the time it runs; a cosmetic resize failure must not discard it. Log, return null, let the client fall back.
- **Downscaling or re-compressing the print master to save bandwidth** — the master stays untouched at print quality. Web weight is solved by an *additional* file, never by degrading the one bound for the printer.
- **Partial page lists in the reorder payload** — `orderedPageIds` must contain every page of the comic. A subset renumbers into 1..n and collides with the pages left alone.
- **Writing final page numbers directly during a reorder** — `@@unique([comicId, pageNumber])` is enforced per statement and is not deferrable, so any swap fails immediately. Park every page on a negative number first, then assign real ones, both inside one `$transaction`.
- **Reordering or deleting pages of a live comic** — reorder is blocked on `PUBLISHED` status and on any active order session, because PDF compilation orders by `pageNumber` and unpublishing does not cancel in-flight sessions.
- **Mounting the webhook router after `express.json()`** — Razorpay signs the exact bytes on the wire. `express.json()` parses and re-serializes them, so every signature check fails. `/api/webhooks` mounts with `express.raw({ type: "application/json" })` above `express.json()`, the same shape Better Auth already needed.
- **Hardcoding `× 100` for payment amounts** — use `toSmallestUnit(amount, currency)`. `JPY`/`KRW`/`VND`/`CLP`/`ISK`/`TWD` have no minor unit and `BHD`/`KWD`/`OMR`/`JOD` have three decimals; a hardcoded multiplier silently overcharges or undercharges by 100× the day a second currency is enabled.
- **A standalone per-page variant-select endpoint** (`PATCH /sessions/:id/pages/:pageId/select`) — considered, then eliminated. Selection is one transactional batch at send-to-print carrying `{ selections: [{ pageId, variantIndex }] }`. Browsing variants must cost zero API calls; the backend never tracks "currently viewing."
- **Writing `isSelected` at generation time** — every variant is born `false`. The field is written only by an explicit user action, and the only such action is the send-to-print commit.
- **Sending the shipping address in the checkout request body** — the frontend PATCHes the eight shipping fields onto the `OrderSession` when the user picks an address; `initiateCheckout` reads them from session state. Checkout takes no body at all.
- **Linking `Order.shipping*` back to `SavedAddress`** — `SavedAddress` is an address book, nothing more. Editing or deleting a saved address must never mutate a placed order; the snapshot is the record.
- **Storing the customer-facing order status** — it is derived from `OrderStatus` by `toPublicStatus()` on every read. Storing it means a migration every time marketing renames a stage.
- **A client-side payment-verify endpoint** — the webhook is the sole trigger. Two systems confirming the same payment is exactly the duplication rejected for RunPod webhooks-vs-polling. Accepted cost: a brief delay while the webhook lands. Revisit only if that becomes a measured UX problem post-launch (~2 h of work).
- **Treating `order.paid` as a trigger event** — redundant with `payment.captured` for a single-payment-per-order shape. `payment.captured` is the only event that changes state; `payment.failed` logs for support; everything else is logged and ignored.
- **Returning a non-400 status on a bad webhook signature** — 400 tells Razorpay the failure is permanent and stops the retry storm. Transient failures must re-throw instead, so Razorpay *does* retry.
- **Comparing webhook signatures with `===`** — use `crypto.timingSafeEqual` on equal-length buffers. String comparison short-circuits on first mismatch and leaks the signature a byte at a time.
- **Enforcing that the shipping country matches the user's real location** — deliberately not done. IP-based defaulting is the frontend's job. A US user can pick INR pricing and pay with a US card; accepted, because the volume is low and blocking it would break gift shipping.
- **Refunds** — none. Once payment succeeds and paid-page generation starts there is no way back, which is why `REFUNDED` was dropped from `OrderStatus`.
- **(Aug 21) Letting a Razorpay webhook enqueue failure return 200.** Always re-throw so Razorpay retries. Swallowing = stranded PAID session forever. Before re-throwing, delete the `WebhookEvent` row so P2002 dedupe doesn't block the retry.
- **(Aug 21) Auto-refund on paid-page generation failure.** Order stays at PAID on all-page-failure; admin decides refund/cancel. Consistent with the general no-automatic-refunds rule.
- **(Aug 21) Auto-select variants server-side at send-to-print.** Customer picks every variant explicitly across all pages (preview + paid). Preview pages get re-reviewed post-payment because the customer can regenerate them right up until send-to-print.
- **(Aug 21) Assume Prisma `updateMany` count > 0 means "everything is fine" in a multi-flip transaction.** Check `count === 0` on each guard and throw to trigger rollback. Applies to send-to-print (Session + Order both need to flip), PDF compilation (same), and future compound transitions.
- **(Aug 21) `job.attempts >= max` as a BullMQ "final failure" check.** Use `job.attemptsMade < job.opts.attempts` inside the `failed` handler. BullMQ fires `failed` on every retry, not just the last one; without the guard, PDF_FAILED / SHIPMENT_FAILED gets set prematurely on the first transient failure.
- **(Aug 21) Silent no-op on a PATCH that touches locked fields.** `updateOrderSession` throws `ConflictError` naming every attempted-but-locked field. Silent acceptance would let the customer think their edit landed and desync the DB from images/Order.
- **(Aug 21) Comic cover as `coverImageUrl`.** Field is `coverThumbnailUrls: String[]`. Order endpoints return the array; frontend picks the display index. Only permanent field name for comic covers.
- **(Aug 22) Keying webhook idempotency on the Razorpay PAYMENT id.** One payment emits `payment.authorized`, `order.paid` and `payment.captured`, all carrying the same payment id — whichever lands first claims the unique constraint and `payment.captured` is dropped as a duplicate. Use the `x-razorpay-event-id` header.
- **(Aug 22) Copying `assertNotExpired` instead of importing it.** The duplicate lost the `expiresAt` comparison and made `initiateCheckout` fail every session as expired. One exported copy in `session.service.ts`; import it.
- **(Aug 22) Placing the checkout status guard above the existing-Order check.** `initiateCheckout` flips the session itself, so a status-first order makes the reuse branch unreachable and strands anyone who closes the Razorpay modal.
- **(Aug 22) Recomputing the price from `PricingRule` on a checkout retry.** Return the amount snapshotted on the `Order` — a repriced amount disagrees with the Razorpay order and the gateway rejects it.
- **(Aug 22) Hosting the frontend and backend on different registrable domains** (`*.vercel.app` + `*.onrender.com`). The session cookie becomes third-party and is blocked by Brave/Safari, and Next middleware never sees it at all. Use subdomains of one owned domain.
- **(Aug 22) Assuming the Better Auth cookie name is stable across environments.** It gains a `__Secure-` prefix whenever `baseURL` is https. Anything reading it by name must accept both forms.
- **(Aug 22) Putting `redirect()` inside a `try/catch` in a Next server component.** `redirect()` works by throwing `NEXT_REDIRECT`; the catch swallows it and runs the fallback instead. Scope error handling to the fetch with `.catch()`.
- **(Aug 22) Reaching the API from the browser with a relative `fetch("/api/...")`.** It resolves against the Next origin, which only proxies `/api/auth/*`. Always go through the axios instance so `baseURL` and the envelope unwrap apply.
- **(Aug 22) Listing a piece of state in a `useEffect` dependency array when the effect also writes it.** In the verifying-payment overlay this turned a 2-second poll into a request storm that burned the 90-second budget in ~5 seconds. Keep loop counters in closure variables.
- **(Aug 24) Replacing an R2-backed asset without an `oldUrl !== newUrl` guard.** `updateTeamMember` lacked it, so an edit form resending an unchanged `imageKey` deleted the live photo from R2 while the DB row kept pointing at it — a broken image with no error anywhere. Every asset-replace path must compare before queuing a delete. Now applied in `updateTeamMember`, `updateHowItWorks` (video + poster), and `updateBlog` (cover).
- **(Aug 24) `.optional()` without `.nullable()` on a field backed by a nullable column.** Makes the field set-once-forever: `null` fails the type check and `""` fails `.min(1)`, so there is no request that clears it. If the column is nullable, the update schema must be `.nullable().optional()`.
- **(Aug 24) `z.coerce.boolean()` for a query-string boolean.** It runs `Boolean(value)`, and every non-empty string is truthy — so `?isActive=false` coerces to `true` and silently returns the opposite set. Use `z.enum(["true","false"]).transform(v => v === "true")`.
- **(Aug 24) `.refine((data) => Object.keys(data).length > 0)` as an "at least one field" check.** Passes for `{ field: undefined }`. Use `Object.values(data).some(v => v !== undefined)`. `updateAnnouncementSchema` still has the weak form; the newer schemas do not.
- **(Aug 24) Sanitizing rich-text HTML only on write.** `Blog.body` is stored raw and sanitized at render with DOMPurify. Write-time-only sanitizing means one bad row already in the database stays dangerous forever.
- **(Aug 24) A per-comic FAQ relation.** `Faq` has no FK to `Comic`. The `COMIC` placement is one global list rendered identically on every comic page. Adding per-comic questions later is a migration plus new endpoints, not a tweak.
- **(Aug 24) A `sortOrder`-style step table for How It Works.** Steps are a JSON array on the singleton row; array position is the step number. A steps table would have meant 5 endpoints and a cascade for a list that is always read and written whole.
- **(Aug 24) Making a blog slug editable.** Generated from the title at create and frozen. `updateBlogSchema` omits it entirely, so a sent `slug` is silently stripped rather than rejected — surface it read-only in the admin UI.
- **(Aug 24) Trusting a `500` seen immediately after a process start.** The first Prisma query in a fresh process can fail with an empty `ErrorEvent` from the Neon serverless WS adapter; every later query succeeds. Reproduce against a warm connection before debugging the endpoint.
- **(Aug 24 · s2) `@font-face` — embedded, data-URI or otherwise — inside an SVG handed to Sharp.** librsvg resolves fonts through fontconfig and silently discards the rule; the font must be installed on the machine or it does not exist. This cost a production outage where dialogue rendered blank and nobody noticed, because Sharp reports success for unresolvable fonts.
- **(Aug 24 · s2) SVG `<text>` for page rendering at all.** Text is converted to `<path>` outlines with opentype.js. Anything that depends on host-installed fonts is environment-dependent by construction.
- **(Aug 24 · s2) Installing fonts into the Docker image to "fix" text rendering.** That treats the symptom and re-introduces host dependence. Outlines need no fonts anywhere; do not add `fonts-*` packages or `FONTCONFIG_PATH`.
- **(Aug 24 · s2) A fallback font for a bubble with no font assigned.** Throws instead. Falling back is the exact behaviour that hid the outage, and in the production container there is no system font to fall back to anyway.
- **(Aug 24 · s2) WOFF2 for page rendering.** opentype.js cannot decompress it (no Brotli). `getFontUploadUrlSchema` still accepts the extension, so the failure currently surfaces at generation, not upload.
- **(Aug 24 · s2) Assuming a font contains glyphs for the text it stamps.** `.notdef` renders as blank or tofu, silently. Checked per character with `charToGlyphIndex(char) === 0` and thrown as a named error listing the offending characters.
- **(Aug 24 · s2) Judging "does the text fit" on height alone.** The old loop only compared total height, so a single unbreakable word — a long child's name — spilled out of the bubble at full size. Width is now checked against measured advance widths every iteration.
- **(Aug 24 · s2) 3-digit hex, 8-digit alpha hex, or CSS colour names for `Bubble.fontColor`.** Exactly `#rrggbb`, lowercased on write. One canonical form means the browser colour input, the stored value and the SVG `fill` are the same string with no conversion anywhere. Transparency, if ever wanted, is a separate `fill-opacity` field — not 8-digit hex, which librsvg handles unreliably.
- **(Aug 24 · s2) Server-side rejection of a low-contrast bubble colour.** The API accepts any valid hex. The server cannot see the artwork behind a bubble, so a hard rule is guesswork wearing the authority of a 400; the admin panel warns and the person looking at the page decides.
- **(Aug 24 · s2) A `fontWeight` column.** A font file holds exactly one weight — "bold" is a second `Font` row the admin uploads and selects, which already works. Synthetic bold (stroke-thickening) is visibly fake at print resolution and was deferred, not adopted.
- **(Aug 24 · s2) Per-comic or per-page default colours, or a bulk-apply endpoint.** Colour is set per bubble. Considered and cut.
- **(Aug 24 · s2) Running BullMQ against a Redis billed per command.** Three idle workers at `drainDelay: 5s` + `stalledInterval: 30s` cost ~60,000 commands/day with an empty queue and exhausted Upstash's 500k/month free tier in about eight days. **Resolved by moving to Redis Cloud, which bills by memory — Upstash is no longer in use.** The rule stands for any future provider choice: BullMQ's polling model is incompatible with per-command pricing.
- **(Aug 24 · s2) Changing an env var locally without changing it on Render.** After `REDIS_URL` was pointed at Redis Cloud in `.env`, Render kept the dead Upstash URL and production stayed broken while local worked perfectly — which reads as "the fix didn't work" rather than "the fix wasn't deployed." Every env-var change is two changes.
- **(Aug 24 · s2) Treating a green `/health` as evidence the system is working.** `/health` only exercises Express. During the Redis outage it returned 200 throughout while every queue was dead.
- **(Aug 24 · s2) A JSX comment (`{/* … */}`) between a ternary's `? (` and its element.** It parses as an object literal, not a comment, and breaks the file. Put the comment above the ternary.

---

## FINALIZED APPROACHES

**Architecture** (unchanged from prior sessions)
- Modular monolith, `routes → controllers → services → lib`.
- `server.ts` = entry; `app.ts` = middleware/routes only.
- Validation in `validateBody` middleware only.
- `asyncHandler` inside controller export.
- Three auth tiers.
- Three route files.
- CORS methods include `PATCH`.
- **Worker file is `generationWorker.ts`; internal names retain "SD" prefix** — the SD/HD distinction was dropped when the HD stage was removed. File renamed for readability; queue name (`sd-generation`), enum values (`GENERATING_SD`/`SD_READY`), and enqueue variable (`sdGenerationQueue`) stay to avoid schema migration. Sweep post-launch alongside HD dead code.
- **SD worker helpers split into `src/jobs/workers/sd/`** — one file per concern: `tokens.ts`, `textStamp.ts`, `workflow.ts`, `runpodClient.ts`, `photoCache.ts`. Keeps `generationWorker.ts` as thin orchestrator.
- **ComfyUI workflow template at `src/config/workflows/api-workflow.json`** — imported directly with `with { type: "json" }`, deep-cloned per job via `JSON.parse(JSON.stringify(x))`. Never mutated in place.
- **`BigInt.prototype.toJSON` patched in `app.ts`** — `PageVersion.seed` is BigInt; `JSON.stringify` can't handle BigInts natively. Patch returns string. Frontend must type `seed` as `string | null` if consumed.
- **Better Auth handler mounts ABOVE `express.json()`** — it needs the raw body. Reordering these two lines breaks authentication with no obvious symptom. **⚠️ CONTRADICTORY (Aug 19):** the second half of this rule said `helmet()` sits after the auth handler so `/api/auth/*` responses carry no helmet headers. As of the checkout session `helmet()` runs *before* the auth handler, so they now do. The reorder was never recorded and may have been accidental — confirm intent, then either revert the code or rewrite this rule.
- **`/api/webhooks` mounts with `express.raw({ type: "application/json" })`, also above `express.json()`** — for the same reason Better Auth is there. Razorpay's HMAC is computed over the exact wire bytes; parsing and re-serializing breaks it. Every other route still receives parsed JSON.
- **`app.set("trust proxy", 1)`** — required on Cloud Run for correct client IPs and for the `secure` cookie flag to resolve behind the load balancer.
- **`GET /health` returns a plain string, not the `sendSuccess` envelope** — the single deliberate exception to the envelope rule.
- **Query strings validated inline, not by middleware** — `comic.controller` (public + admin list) and `feedback.controller` call `schema.parse(req.query)` inside try/catch converting `ZodError` → `ValidationError`. This is the accepted stand-in until `validateQuery` exists; it satisfies the never-uncaught-`.parse()` rule.
- **`validateBody` replaces `req.body` with the parsed result** — Zod `.default()` values are therefore applied before the controller runs. This is how `Bubble.fontSize` / `sortOrder` defaults arrive.
- **Error codes are part of the API contract** — `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_SERVER_ERROR`, plus `RUNPOD_SUBMIT_FAILED`, `RUNPOD_STATUS_FAILED`, `RUNPOD_JOB_FAILED`, `RUNPOD_POLL_TIMEOUT`, `RUNPOD_MALFORMED_OUTPUT`.
- **No typecheck runs anywhere** — `tsconfig.json` sets `"types": []` and tsx strips types without checking. "No `tsc` build step" was the decision; it also left no `tsc` *check* step, so type errors surface only at runtime.
- **Workers run in the web server's process** — `initJobs()` is called from `server.ts`; there is no separate worker process or event loop. Anything that assumes process isolation (timers, in-memory caches, shutdown handling) must account for that.
- **BullMQ job retention** — completed jobs kept 24 h or the last 1000 (whichever is stricter); failed jobs kept 7 days. That window is how long a failure stays debuggable in Redis.
- **Service functions do the heavy lifting; workers are thin wrappers** (added Aug 21) — established pattern: `compilePdfForSession` in `session.service.ts`, `pdfWorker` just calls it. Mirrors `maybeMarkPaidReady`/`maybeMarkPreviewComplete` shape. Keeps all business logic testable outside the queue layer and lets multiple triggers reuse the same function.

**Data & sessions** (unchanged from prior sessions)

**Comic & pricing** (unchanged from prior sessions)
- **Multi-thumbnail model**: `Comic.coverThumbnailUrls String[] @default([])`, first element is primary (catalogue cards), full array shown on detail page. Max 10 thumbnails per comic.
- **Full-replacement update semantics**: `PATCH /api/admin/comics/:comicId` with `thumbnailKeys: [...]` replaces the entire array. Backend diffs old vs new arrays; removed URLs get best-effort R2 cleanup.
- **Batch upload URL endpoint**: `POST /api/admin/comics/thumbnails/upload-urls` accepts `{ files: [{ fileName, contentType }, ...] }` (min 1, max 10), returns `{ uploads: [{ uploadUrl, key }, ...] }`.
- **Delete cleanup**: `deleteComic` best-effort R2 cleanup of thumbnails + every page's artwork and mask, always AFTER the DB delete succeeds (DB-first rule).
- **Publish gate**: `updateComicStatus` requires `coverThumbnailUrls.length > 0`.

**Generation pipeline**
- Single-flow SD pipeline only. No HD upscale stage. SD output = final print-ready image.
- Pipeline order: Sharp text stamping FIRST (onto raw `Page.artworkUrl`) → for face pages, ComfyUI face-swap SECOND (receives text-stamped image as input) → `finalImageUrl` uploaded to R2.
- Non-face pages skip RunPod entirely: text stamp → re-upload as `finalImageUrl`. `comfyJobId` stays null.
- Variant cap is payment-based: 3 before payment (`MAX_VARIANTS_BEFORE_PAYMENT`), 8 after payment (`MAX_VARIANTS_AFTER_PAYMENT`). Pre-payment variants persist and count toward the post-payment cap.
- `PageVersion` uses `pageId` FK.
- Prompts page-specific only (`Page.pagePrompt`).
- `PageVersion` pipeline fields: `textStampedUrl` (Sharp output = ComfyUI input) → `comfyJobId` (RunPod job ID, null for non-face) → `finalImageUrl` (user-visible, PDF-bound).
- **Per-page generation tunables** — `Page.steps` (Int, default 3, range 1–8) and `Page.cfg` (Float, default 1.0, range 1.0–3.0). Bounds live in `src/config/generation.ts`.
- **`Page.isPreviewPage` is the source of truth for preview pages** — admin flags each page individually. `Comic.freePreviewPages` is a counter used only for sanity-check warnings when it drifts from the actual isPreviewPage count.
- **`Page.hasFace` drives pipeline forking** — face pages need `bestPhotoUrl`, `maskUrl`, `pagePrompt` and go through RunPod. Non-face pages skip all three and finish after text-stamp.
- **Base64-everything transport to ComfyUI** — text-stamped artwork + mask + child photo all travel as base64 strings inside RunPod's `input.images[]` payload. Result also arrives as base64 in polling response; backend decodes → Buffer → uploads to R2 public bucket → stores public URL as `finalImageUrl`.
- **JPEG q88 for RunPod payload** — Sharp transcodes stamped artwork + mask + child photo to JPEG right before RunPod submit. RunPod caps API payloads at 10 MiB; JPEG keeps that comfortably under 1 MB. R2 STORAGE stays PNG at print quality; the JPEG is only for the round-trip. RunPod OUTPUT comes back at ComfyUI's stitched resolution and is saved to R2 as PNG. Filenames sent to RunPod match `.jpg` extension.
- **PNG compression for R2 storage** — `.png({ compressionLevel: 9, adaptiveFiltering: true })` in `textStamp.ts`. Lossless, ~20-40% smaller than Sharp's default level 6.
- **`Page.pagePrompt` is required in Zod (create + update), nullable in DB** — enforced at API boundary, not schema level.
- **Dialogue token contract mirrored between frontend and backend** — four tokens `{name}`, `{pronoun_subject}`, `{pronoun_object}`, `{pronoun_possessive}`. Unknown tokens render literally in the final image.
- **Pronoun table (backend source of truth):** `HE → {subject: he, object: him, possessive: his}`; `SHE → {she, her, her}`; `THEY → {they, them, their}`. Located in `src/jobs/workers/sd/tokens.ts`.
- **Sharp text stamping design (rewritten Aug 24):** SVG-per-bubble containing a single `<path>` of glyph outlines produced by opentype.js. No `<text>`, no `font-family`, no `@font-face`. Lines are centred per-line on measured width (paths have no `text-anchor`); auto-shrink decrements 1px until it fits **both axes** or hits the `MIN_FONT_SIZE * artworkHeight` floor, logging a warning at the floor.
- **Character width comes from real font metrics** — `font.getAdvanceWidth(text, size)`, kerning included. Replaces the `fontSizePx * 0.6` approximation, which also meant width was never actually checked.

**SD worker orchestration (Part E)**
- **`PageVersion` row created BEFORE BullMQ enqueue** — inside a `$transaction` in `enqueuePreviewGenerationJobs`. Enqueue happens after commit. If Redis fails, orphaned QUEUED rows exist in DB (recoverable) but no data lost.
- **Job payload is `{ pageVersionId }` only** — worker fetches everything else from DB. Minimizes queue coupling.
- **Regenerate uses transactional variant-index computation** — count + cap check + row create all inside `$transaction`. Prevents double-click race producing duplicate `variantIndex` values.
- **Session status transition timing (first generation):** `PHOTO_UPLOADED → GENERATING_PREVIEW` fires AFTER `enqueuePreviewGenerationJobs` returns successfully, not before. Recoverable on enqueue failure. The recovery path in `regeneratePage` uses the opposite order on purpose — see below.
- **BullMQ priority formula:** `sessionSecondsInDay + (pageNumber * 80_000)`. Max value = 2,006,399 — fits BullMQ's 21-bit ceiling of 2,097,151. Session component wraps at 24h (matches session TTL); page-number term dominates so users interleave. Implemented as `computeJobPriority(sessionCreatedAt, pageNumber)` helper in `session.service.ts` used by both enqueue and regenerate.
- **BullMQ concurrency = 5 to match RunPod max workers.** Wasted RunPod capacity if lower; wasted BullMQ slots waiting for RunPod if higher. PDF worker and Shiprocket worker also run at concurrency 5 for consistency.
- **Idempotency guard at top of worker** — if row is already `SD_READY` with `finalImageUrl`, re-emit `page:ready` and return successfully. Handles BullMQ retry-after-ack-lost edge case cheaply.
- **`SD_READY` write clears `errorMessage: null`** — retries that succeed after a prior failure must not leave stale error text on the successful row.
- **Non-face pages skip `GENERATING_SD` status** — go `TEXT_STAMPED → SD_READY` directly. Consistent visibility of pipeline progress in DB.
- **Non-face pages re-upload the stamped image** — into `sessions/{sessionId}/final/{pageVersionId}.png`. Every session owns a full copy of every page; no shared refs to comic-level artwork.
- **Failure path in worker:** wraps pipeline in try/catch/finally. Catch marks row `FAILED` with `errorMessage`, emits `page:error`, re-throws so BullMQ retries per `attempts:3` policy. Finally releases photo cache if it was acquired. `photoAcquired` boolean flag ensures release only fires if acquire succeeded.
- **`markPageVersionFailed` never throws** — nested throw inside a catch handler would mask the original error. DB failure inside cleanup is logged, not re-raised.
- **Preview completion uses `updateMany` + status guard** — `maybeMarkPreviewComplete` runs after every terminal PageVersion transition (SD_READY or FAILED). Counts total preview pages, reduces every terminal row into per-page "settled" and "succeeded" sets, decides success-vs-failure, flips via `updateMany` with status in the `WHERE` clause. Real Postgres single-statement atomicity — no `$transaction`, no fake row-lock reasoning.
- **Paid-page completion mirrors preview completion** (added Aug 21) — `maybeMarkPaidReady` in `session.service.ts` has the same shape as `maybeMarkPreviewComplete` scoped to `isPreviewPage: false`. Flips session `GENERATING_PAID → PAID_PAGES_READY` AND Order `PAID → GENERATED` in one `$transaction`. Success-wins semantics: any `SD_READY` variant → `PAID_PAGES_READY`; only flips to `FAILED` when every paid page has final-failed. On all-page-failure, Order stays at `PAID` — refund/cancel is an explicit ops decision, never automatic. Wired into both success and failure paths of `generationWorker.ts` alongside the existing preview call; whichever helper's filter doesn't match the finished page returns `not-done` and no-ops.
- **`emitSessionPaidReady` WebSocket event** (added Aug 21) — mirrors `emitSessionPreviewReady`. Emitted from both the success path and the failure-with-earlier-success edge case in `generationWorker.ts`. Type string: `session:paid-ready`, no payload. All-failure path stays silent (mirrors preview).
- **No `distinct: ["pageId"]` in the terminal-state query** — a regenerated page holds several variants (variant 0 `FAILED`, variant 1 `SD_READY`), and `distinct` collapses to one arbitrary row per page because there is no `orderBy` that answers both "did it settle" and "did any variant succeed" at once. The `distinct` version could read `FAILED` for a page that succeeded on retry and flip the whole session to `FAILED`. Load all terminal rows and reduce into two `Set`s instead — bounded by preview pages × variant cap, so the cost is nil.
- **Success-wins semantics** — session flips to `PREVIEW_READY` if any single page reaches `SD_READY`. Only flips to `FAILED` when every preview page has final-failed. Failed pages surface via per-page `page:error` events; users retry them via existing `/regenerate` endpoint.
- **`FAILED` is retryable** — added to `REGENERATABLE_STATUSES` so a totally-failed session can self-recover via per-page regenerate. `assertNotExpired` runs first in `regeneratePage`, so an expired-then-failed session can't be re-opened via regenerate.
- **`regeneratePage` flips `FAILED → GENERATING_PREVIEW` BEFORE its enqueue** — the deliberate exception to the never-do about flip ordering. Two halves to the reasoning:
  - **Why the flip at all:** `maybeMarkPreviewComplete` only matches sessions already at `GENERATING_PREVIEW`. Without moving the session back, a successful regeneration writes `SD_READY` on the page and the session stays pinned at `FAILED` forever — the retry path enqueues work with no route back out. Done as `updateMany` guarded on `status: "FAILED"`, so concurrent regenerations no-op safely.
  - **Why before, not after:** the worker runs at concurrency 5 and picks jobs up immediately. Flipping after `queue.add()` resolves lets a fast page finish first, no-op the guard while the status is still `FAILED`, and then get overwritten to `GENERATING_PREVIEW` — stuck the other way. **No rollback on enqueue failure** either: `GENERATING_PREVIEW` is itself regeneratable so the user retrying re-enters the normal path, and a rollback would race a sibling regeneration that did enqueue. Worst case is one burned variant slot against the cap of 3, during a Redis outage.
- **`maybeMarkPreviewComplete` runs after every terminal transition** — including regenerations post-`PREVIEW_READY`. Status guard makes it a cheap no-op in that case.
  - **Target count is `page.count({ comicId, isPreviewPage: true })`, NOT `Comic.freePreviewPages`.** Same source of truth as the enqueue filter. Counting against the comic-level counter desyncs the moment it drifts: too high and the session never leaves `GENERATING_PREVIEW`, too low and it flips early.
  - Guarded with `totalPreviewPages === 0` so a comic with nothing flagged never flips on a `0 >= 0` comparison, and scoped to `page: { isPreviewPage: true }` so paid-page work can't satisfy the preview transition.
- **Display derivative built per SD_READY row** — `buildAndUploadDisplayImage(sessionId, pageVersionId, sourceBuffer)` uploads to `sessions/{sessionId}/final/{pageVersionId}.webp` and returns the public URL, or null on failure. Runs for both branches: face pages from the RunPod result buffer, non-face pages from the stamped buffer. Written in the same `SD_READY` update as `finalImageUrl`.
- **Display derivative settings** — long edge capped at 1600px (`fit: "inside"`, never crops), WebP quality 80, `withoutEnlargement: true`. 1600 covers a 2× retina display for the viewer's 800 CSS px box with nothing wasted. Constants live in `src/lib/image.ts`.
- **Worker error-message truncation** — `markPageVersionFailed` cuts messages to `MAX_ERROR_MESSAGE_LENGTH = 500` before writing. That truncated text is what reaches the user through `page:error` and the GET response.
- **Re-entrant enqueue** — `enqueuePreviewGenerationJobs` reuses existing `variantIndex: 0` rows, creates only missing ones, resets reused rows that are neither `SD_READY` nor `QUEUED` back to `QUEUED` with `errorMessage: null`, and skips enqueuing anything already `SD_READY`. Retry after a Redis outage now recovers cleanly. `enqueuePaidGenerationJobs` mirrors this exactly with the `isPreviewPage: false` filter.

**Photo cache (`src/jobs/workers/sd/photoCache.ts`)**
- **In-memory `Map<sessionId, CacheEntry>` with reference counting** — first `acquirePhoto` triggers R2 download and stores Promise; concurrent callers await the same in-flight fetch. `releasePhoto` decrements refCount; entry evicts when refCount hits zero.
- **Promise memoization (not Buffer memoization)** — storing the Promise means concurrent callers get the same in-flight fetch. Once resolved, still just a resolved Promise — `await` returns the value immediately. No branching needed for "download-in-progress" vs "download-done" states.
- **Failed downloads self-evict** — `.catch` on the bufferPromise deletes the cache entry so poison Promises don't sit forever.
- **Safety-net TTL sweep** — every 5 minutes, evict entries idle >15 minutes. Catches leaked entries from crashed workers that never called `releasePhoto`.
- **Cache is process-memory only** — no persistence across restarts. Reference-counted for the duration of a job burst, not for the user's session lifetime. Different concept from the user's OrderSession.

**WebSocket events (`src/websocket/event.ts`)**
- **Four emit helpers:** `emitPageReady`, `emitPageError`, `emitSessionPreviewReady`, `emitSessionPaidReady`. All four: get room → bail silently with debug log if no sockets → iterate sockets → send only if `readyState === OPEN`.
- **Event shapes (locked, frontend building against these):**
  - `page:ready` → `{ type, pageNumber, variantIndex, imageUrl, displayImageUrl, pageVersionId }`
  - `page:error` → `{ type, pageNumber, variantIndex, errorMessage }`
  - `session:preview-ready` → `{ type }` (no payload)
  - `session:paid-ready` → `{ type }` (no payload)
- **`imageUrl` stays the print master; `displayImageUrl` is the web-sized WebP** — keeping `imageUrl` unchanged made the added field backward compatible. `displayImageUrl` is `string | null`; clients fall back to `imageUrl` when null. The worker's idempotency re-emit path sends both fields too.
- **Emit is fire-and-forget** — never awaited. WebSocket send is synchronous; awaiting adds latency for no gain.
- **Empty rooms are silent no-ops** — DB has the source-of-truth state; user reconnects via `GET /sessions/:id` if they missed events.

**Session API contracts**
- **`POST /sessions/:id/photo/confirm`** (renamed from `.../photo/validate`) — accepts `{ key }`. Sets `bestPhotoUrl` + `rawPhotoUrls`, flips status to `PHOTO_UPLOADED`. Accepts both `CREATED` and `PHOTO_UPLOADED` current status (allows photo re-upload before generation).
- **`GET /sessions/:id` response shape** — nested `pages[].variants[]` structure, includes ALL pages of the comic (not just preview ones) so frontend can render locked pages with paywall overlay. Each page exposes `pageId`, `pageNumber`, `isPreviewPage`, `hasFace`, `variants[]`. Each variant exposes `pageVersionId`, `variantIndex`, `status`, `finalImageUrl`, **`displayImageUrl`**, `isSelected`, `errorMessage`. Internal fields (`seed`, `textStampedUrl`, `comfyJobId`, `steps`, `cfg`, `pagePrompt`) deliberately excluded. Response includes `comic: { id, title, freePreviewPages, coverThumbnailUrls }` for one-shot rendering.
- **`PATCH /sessions/:id`** — accepts `childName`, `age`, `pronounKey`, `notificationEmail`, `coverType`, and all seven shipping fields. Also carries the expiry gate (`assertNotExpired`). **(Aug 21 update)** Now carries a status gate too: locks 12 fields (`childName`, `age`, `pronounKey`, `coverType`, and all 8 shipping fields) once session is at `AWAITING_PAYMENT` or any post-payment status. Only `notificationEmail` stays editable, because it's never printed. Silent PATCH acceptance would have desynced the DB from images baked into paid PageVersions and from shipping snapshotted onto `Order`. Closes audit 8.3.
- **`POST /api/user/sessions/:sessionId/send-to-print`** (added Aug 21) — customer commits variant selections across all pages, session locks. Body: `{ selections: [{ pageNumber, variantIndex }, ...] }`, one entry per page. Full flow: guards → in-flight check (rejects if any PageVersion for the session is non-terminal, not just the selected ones) → per-selection validation → atomic transaction (mark `isSelected: true` on chosen variants + flip Session `PAID_PAGES_READY → CONFIRMED` + flip Order `GENERATED → CONFIRMED`) → enqueue PDF compilation with `jobId: sessionId` for BullMQ dedupe. Idempotent: second call at `CONFIRMED` re-enqueues the PDF job and returns success; no status change on the retry path.
- **`GET /countries` (public)** — active countries only, explicit `select` so `isActive` never appears in the payload. Deliberately separate from the admin list, which must also return deactivated rows and needs a different field set.
- **Snapshot + stream contract for frontend** — GET is the complete state (initial load, reconnect after disconnect, return after being away). WebSocket is the delta stream during active generation. Both together = full state sync.

**ComfyUI/RunPod integration**
- **Deployment tool: comfy.getrunpod.io (ComfyUI-to-API)** for wrapping the client's workflow. Base image is `runpod/worker-comfyui:5.8.4-base` (CUDA 12.x).
- **api-workflow.json IS the backend template.** Deep-clone per request, patch per-job fields, send in `input.workflow`. Committed to backend git under `src/config/workflows/`.
- **Fields patched per request (SEVEN):** node 78 (comic page artwork filename), node 435 (child image filename), node 519 (mask filename), node 466 (`noise_seed`), node 471 (`steps` from `Page.steps`), node 467 (`cfg` from `Page.cfg`), node 111 (positive prompt from `Page.pagePrompt`). Node 473 (negative prompt) stays hardcoded.
- **Filename-match rule:** `input.images[].name` must exactly equal the workflow's LoadImage `inputs.image` string.
- **Seed handling:** the worker generates a plain JS number (`Math.floor(Math.random() * 1_000_000_000)`), patches that straight into node 466, and only converts to `BigInt(seed)` when writing `PageVersion.seed`. There is no BigInt→Number conversion anywhere. Seeds stay in the safe 53-bit range by construction.
- **Result decoding:** only `output.images[0]` is read. The current workflow has one `SaveImage` node; additional outputs would be silently dropped.
- **Poll loop shape:** status is checked first, then the loop sleeps — so the first check is immediate rather than 5 s late.
- **Polling over webhook for RunPod result retrieval** — worker submits to `/run`, gets jobId, then polls `GET /status/{jobId}` every 5s until COMPLETED / FAILED / CANCELLED.
- **Polling settings:** `POLL_INTERVAL_MS = 5000`, `MAX_POLL_ATTEMPTS = 200` (17 min ceiling). RunPod endpoint-level `executionTimeout: 600s`.
- **RunPod status response shapes fully mapped:** `IN_QUEUE` → `{id, status}` only; `IN_PROGRESS` adds `delayTime`, `workerId`; `COMPLETED` adds `executionTime` + `output.images[]`; `FAILED` adds `error` string.
- **No client-side TTL in RunPod payload** — endpoint-level `executionTimeout: 600s`.
- **Single face-swap LoRA baked in Docker (client-confirmed)** — `bfs_head_v5_2511_merged_version_rank_16_fp16.safetensors` applies to every comic. Plus Lightning speed-up LoRA also baked.
- **Cold-start mitigation stack (priority):** Active Workers ≥ 1, FlashBoot enabled, Idle Timeout ≥ 90s.
- **A40 GPU tier confirmed stable; RTX 4090 in US-NC-1 has driver heterogeneity** — some workers have CUDA <12.6 drivers and cannot start the container. Fix path: switch region or GPU tier.
- **Client owns the pipeline**: GitHub repo, RunPod endpoint on client account. Backend needs only endpoint URL + API key.
- **Artwork upload size soft cap: 5 MB (admin discipline)** — with JPEG transcode for RunPod, full payload stays well under 10 MiB even for 2000×1455 stamped artwork.

**ComfyUI Dockerfile requirements — client repo baseline** (unchanged)
- Custom-node repos cloned via raw `git clone` MUST have `pip install -r requirements.txt` appended.
- **ReActor specifically** needs `pip install "onnxruntime-gpu<1.27"`.
- **Strip unused downloads.**
- Commit pins on custom nodes kept but must be validated against the workflow.

**Asset storage** (unchanged)
- **Page artwork + masks are PUBLIC**; fonts, child photos and LoRA stay PRIVATE.
- **Frontend always sends a `key`, backend stores the resolved URL.**
- **`thumbnailKeys` accepts either a full public URL or a raw key.**
- **`normalizeThumbnailInput` is local to `comic.service.ts`** — it handles the URL-or-key ambiguity of a request body. **`r2.getKeyFromPublicUrl` is for stored URLs only** (turning a `finalImageUrl` / `imageUrl` / `videoUrl` / `coverImageUrl` column back into a key for download or delete). Callers: SD worker, PDF worker, and — added Aug 24 — `howItWorks.service.ts` and `blog.service.ts`. The older services (`teamMember`, `customerReview`, `page`) still inline the same `.replace(publicBase + "/", "")` by hand; consolidating them is a rainy-day tidy, not a bug.
- **Page upload keys carry `randomUUID()`**; **font upload keys stay `Date.now()`-only**.
- **Best-effort R2 cleanup on page update/delete and comic delete.** `deleteComic` also sweeps every page's artwork and mask, since pages cascade-delete in the DB but their R2 objects do not. `Font` and `Country` perform no R2 cleanup on replace or delete.
- **Delete ordering — DB row first, always:** every deleter across the codebase (`CustomerReview`, `TeamMember`, `HeroImage`, `comic.service`, `page.service`) now follows the same shape: (1) load DB row, (2) run guards, (3) extract R2 keys into local vars, (4) delete DB row, (5) best-effort R2 cleanup in try/catch. A failed DB delete leaves R2 assets intact and the operation retryable. A failed R2 cleanup after DB success just orphans files (wasted storage), never breaks references.
- **Presigned upload URLs set no size cap** — `getSignedUploadUrl` passes no `ContentLength` condition. Expiry windows are set per asset type in each service; see PROJECT_CONTEXT §4 for the full table.
- **`requestChecksumCalculation: "WHEN_REQUIRED"` on the S3 client is mandatory for R2** — newer AWS SDK versions send checksum headers R2 rejects. Do not drop it during an SDK upgrade.

**Bubble geometry** (unchanged)
- **Normalized 0–1 fractions** for `x/y/width/height`.
- **`fontSize` is a fraction of artwork HEIGHT**, `Float @default(0.02)`.
- **Bounds enforced in two places**: Zod object-refine on create; merged-value check in `bubble.service.updateBubble` for partial PATCH.
- **`BUBBLE_BOUND_EPSILON = 0.0001`** absorbs float division noise.
- **`Page.artworkWidth`/`artworkHeight` Sharp-probed** on create and on artwork replace.
- **Mask must match artwork dimensions exactly** → 400. A mask uploaded without artwork in the same request is stored unvalidated and checked later, when artwork is attached.
- **Aspect-ratio change warns, never blocks.** Threshold is `ASPECT_RATIO_TOLERANCE = 0.01` — never an `===` comparison, since 2048/1536 and 4096/3072 are the same ratio but not bit-identical.
- **`updatePage` validates the RESULTING state, not the payload** — replacing only the artwork re-verifies the existing mask even though it wasn't sent. A PATCH touching neither asset performs zero R2 downloads.
- **`createPage` always returns `warnings: []`** — empty by design, so create and update share one response shape. Only `updatePage` fills it.

**Frontend contract** (unchanged)
- **`react-konva` recommended** for the bubble mapper.
- **Normalize only at the API boundary** — work in pixels inside the mapper.
- **Better Auth login is via `better-auth/react`'s `createAuthClient`**; `role` is `input: false`.
- **CORS origin lives in two places** — `app.ts` middleware and Better Auth `trustedOrigins`. Update both or login silently breaks.

**Infra**
- **(Aug 22) Production hosting is Render (backend) + Vercel (frontend), on subdomains of one owned domain.** `api.unilakekids.com` + `www.unilakekids.com`, sharing the registrable domain `unilakekids.com`. This is what makes the Better Auth session cookie first-party. *(Supersedes the Cloud Run hosting decision — the `Dockerfile` is still Cloud Run–shaped, so moving back needs zero URL changes, only platform settings.)*
- **(Aug 22) Single instance, autoscaling off, permanently.** WebSocket rooms are an in-memory `Map` and the photo cache is per-process; a second instance means half the users never receive live page events. Applies to any host, not just Render.
- **(Aug 22) A host that suspends idle instances is disqualified.** BullMQ workers and the hourly expiry sweeper run inside the web process. Render's free tier spins down after ~15 min; Cloud Run throttles CPU to ~0 between requests unless CPU is always-allocated. Either one silently stops all background work.
- **2 GB RAM minimum** — PDF worker concurrency 5 × ~120 MB peak per job, alongside the Node runtime and the other workers.

**CMS** (prior modules unchanged; three added Aug 24)

*How It Works, FAQ, Blog — added August 24, 2026*
- **How It Works is a singleton found by `findFirst({ orderBy: { createdAt: "asc" } })`, created on first PATCH.** Find-then-create was chosen over a sentinel-id upsert; the `orderBy` is the mitigation, so that if the narrow double-create race ever fires, every read still deterministically agrees on the same row.
- **`isActive` is a normal PATCH field on How It Works, not a `/status` toggle** — the one CMS module where it is an idempotent setter rather than a blind flip. Consequence of it being a singleton with one save endpoint.
- **Public readiness is enforced in the service, not the client** — `isActive && videoUrl && steps.length > 0`, else `null`. Keeps a half-built section off the homepage regardless of when the admin flips `isActive`.
- **FAQ is one table with a `placement` enum, not two models** — the rows are structurally identical; two models would duplicate controller, service, validator and admin UI for nothing.
- **FAQ reorder is strict, and infers `placement` from the rows rather than trusting the body.** Requires the complete list for one placement including inactive rows. Chose the strict shape (`reorderComicPages`) over the lenient one (`reorderAnnouncements`, which silently allows a subset to collide with untouched rows).
- **Blog slug: slugify → append `-2`, `-3` on collision → `|| "post"` when the title strips to empty.** Bounded at 50 attempts. A `P2002` on insert (the concurrent-same-title race) surfaces as a `ConflictError`, not a retry loop.
- **Blog list endpoints omit `body` via an explicit shared `select`; detail endpoints include it.** The article HTML has no business travelling in a listing payload.
- **Blog is draft-by-default** (`isActive @default(false)`) — unlike the other CMS models, which default `true`. A post is written over time; a review or team member is created complete in one request. Same reasoning `AnnouncementBar` already used.
- **One generic `POST /blogs/upload-url` for cover images and in-body editor images** — same MIME types, same bucket, same prefix. A `cover`/`body` discriminator would add structure with no behavioural difference.

**SavedAddress** (unchanged from prior sessions)

**Sunglasses/hat detection** — brightness+uniformity heuristic is final.

**Python cleanup** — deferred indefinitely.

**Response envelope** (unchanged from prior sessions)


### RunPod status polling (added August 15, 2026)

- **Retry policy:** `fetchStatus` retries transient failures up to 2 times with 500ms then 1000ms backoff. Total worst-case extra delay per poll: 1.5s (well under the 5s poll interval, so normal flow is unaffected).
- **Transient (retry):** network failures (fetch `TypeError`), HTTP 5xx, HTTP 429 rate limits.
- **Permanent (fail immediately):** HTTP 4xx other than 429 — bad auth, missing job, malformed request. Retrying won't help.
- **Split into two functions:** `fetchStatusOnce` (raw HTTP call, no retry logic) + `fetchStatus` (retry wrapper). Separation of concerns keeps each function reasonable to reason about.
- **Fixes audit 9.8** — a single network blip on any of ~200 status polls per job used to bubble to BullMQ and trigger a full-job retry, double-charging GPU.

### Session expiry enforcement (added August 15, 2026)

- **Two-layer defense:** query-time via `assertNotExpired(session)` at the top of every session-mutating function, plus hourly background sweeper.
- **On expiry detection during a mutation:** throw `ConflictError` AND atomically flip status to `FAILED` via `updateMany` + status guard. Future reads see clean terminal state. User can no longer bypass expiry via a subsequent call (idempotent).
- **Background sweeper (`sweepExpiredSessions`):** runs hourly via `setInterval` registered in `initJobs`. Safe against concurrent runs (updateMany with status guard makes duplicates no-op). Cleared on graceful shutdown.
- **The sweeper is hygiene, not correctness — layer 1 carries the guarantee.** `setInterval` only fires reliably on Cloud Run when the instance has CPU always-allocated; the default throttles CPU to near zero between requests, and the first tick fires after the interval rather than at boot, so an instance recycling more often than hourly never sweeps at all. The in-process BullMQ workers do handle jobs between requests, which implies CPU is already always-allocated — **unverified, on the verify list.** If the sweep ever needs to be guaranteed, the reliable shape is Cloud Scheduler → admin endpoint, not an in-process timer.
- **R2 asset cleanup deliberately deferred** — expired sessions may still have assets the user has cached. Physical cleanup needs reference-checking beyond this fix's scope.
- **Read functions (`getOrderSessionId`) do NOT call `assertNotExpired`** — they still return `isExpired: true` in the response so the frontend can render appropriate UI before the user attempts to mutate.
- **Expiry writes `FAILED`, which overloads that status** — `FAILED` now means generation-failed, expired-on-mutation, *or* expired-by-sweep. The frontend must read `isExpired` to tell them apart, because `FAILED` is regeneratable and only the generation-failed case actually retries successfully. Two knock-on effects: expired sessions stop blocking comic deletion and page reorder (both guards exclude `FAILED`), and their `PageVersion` rows then cascade-delete with the comic. A distinct `EXPIRED` enum value would resolve this for one migration plus four call-site updates — backlogged, not done. Full detail in `PROJECT_CONTEXT.md` §5.
- **(Aug 21 amendment) Paid sessions are exempt from expiry entirely.** `EXPIRY_EXEMPT_STATUSES` = `AWAITING_PAYMENT` + `POST_PAYMENT_STATUSES` (`PAID`, `GENERATING_PAID`, `PAID_PAGES_READY`, `CONFIRMED`, `COMPILING_PDF`, `SHIPMENT_QUEUED`, `COMPLETED`). Checked in three places: both `assertNotExpired` copies (`session.service.ts` and `checkout.service.ts`), `sweepExpiredSessions`, and the `isExpired` computation returned by `getOrderSessionId`. Post-payment sessions live until send-to-print completes, period. **Accepted tradeoff:** abandoned `AWAITING_PAYMENT` sessions live forever with no cleanup — the alternative (killing a session mid-payment when the user takes >24h from session start) was strictly worse. Cleanup for abandoned checkouts is a separate future concern; can be layered as a dedicated sweep with different rules (Razorpay's own 15-min order expiry as the signal).

### Environment variable validation

- **`R2_PUBLIC_URL_BASE` and `BETTER_AUTH_SECRET` are required at boot** — added to `env.ts` required list. App refuses to start if either is missing. Fixes audit 2.9 + 2.10: previously, missing `R2_PUBLIC_URL_BASE` silently wrote `undefined/<key>` as permanent URLs.
- **`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` are required at boot** (added August 19). The required list is now 22 entries.
- **Razorpay config is nested, not flat** — `config.razorpay.razorpayKeyId`, `.razorpayKeySecret`, `.razorpayWebhookSecret`. The stutter is intentional; code that assumed flat naming was reverted to match.
- **`NODE_ENV` remains optional** — falls back to `"development"`. Deliberate.

---

### Checkout & payments (added August 19, 2026; expanded August 21, 2026)

**Order lifecycle**
- **`OrderStatus` is 9 values:** `CREATED`, `PAID`, `GENERATED`, `CONFIRMED`, `SHIPROCKET_FAILED`, `READY_TO_SHIP`, `SHIPPED`, `DELIVERED`, `CANCELLED`. Migration `20260818214132_update_order_status_enum` replaced the old enum outright; it cost nothing because no `Order` rows existed.
- **Customer-facing status is derived, never stored** — `toPublicStatus()` in `src/utils/orderStatusMapping.ts` collapses the 9 internal values into 7 strings. `CONFIRMED` / `SHIPROCKET_FAILED` / `READY_TO_SHIP` all read as `"Printing"`, because a Shiprocket failure is an ops concern and not something to worry a customer with. Renaming a stage is one line and no migration.
- **The `Order` row is created at checkout initiation, not at payment success.** An abandoned checkout leaves a `CREATED` row that is cheap, filterable, and the natural anchor for a future "resume payment" flow.

**`initiateCheckout` shape**
- **Guard order (Aug 22):** exists → not expired → **existing-Order check** → `PREVIEW_READY` → has `userId` → has `coverType` → has all seven shipping fields. *(Superseded: the Order check used to sit last, which made it dead code — see the Aug 22 never-do above.)*
- **Idempotent while `CREATED`:** a repeat call returns the same `razorpayOrderId` rather than creating a second Razorpay order. Any later order status 409s. The reuse path skips the field guards (already frozen by the post-payment lock) and returns the `Order`'s snapshotted amount. A `CREATED` order with a null `razorpayOrderId` is refused with a 409 instead of returning `undefined` to the client.
- **(Aug 22) `assertNotExpired` is imported from `session.service.ts`, not duplicated.** The former private copy had silently lost its `expiresAt` comparison and failed every session as expired.
- **`Country.code` (ISO alpha-2) is the lookup key**, `Country.currencyCode` supplies the currency, and `isInternational` is snapshotted as `code !== "IN"`. Inactive countries are refused.
- **A missing `PricingRule` logs at `error` and returns 404.** Configuration gap on our side, not user error.
- **The Razorpay order is created OUTSIDE the transaction; the `Order` row and the `PREVIEW_READY → AWAITING_PAYMENT` flip go INSIDE one.** External system can't participate in Prisma rollback.
- **The session flip uses `updateMany` with `status: "PREVIEW_READY"` in the WHERE**, not `update`.
- **(Aug 21) `checkoutParamsSchema` wired via `safeParse` + `ValidationError`.** Reinforces the general "never raw `.parse()` in a controller" rule; the schema had been written but never imported.

**Razorpay webhook**
- **`payment.captured` is the sole state-changing event.** `payment.failed` logs error code + description for support and changes nothing. `order.paid` and everything else are logged and ignored.
- **Idempotency at two layers, deliberately.** Transport layer: `WebhookEvent.eventId @unique` — **(Aug 22) the `x-razorpay-event-id` request header**, falling back to `` `${eventType}:${entityId}` ``; a `P2002` on insert means a duplicate delivery and returns early. The header is unique per event and stable across that event's retries, so genuine redelivery still dedupes. *(Superseded: the key used to be the payment id, which collided across the three event types a single payment emits and permanently discarded `payment.captured`.)* Business layer: `payment.captured` no-ops when the `Order` is already past `CREATED`. **(Aug 21 refinement)** The business-layer check now allows a retry through when the `Order` is `PAID` but the Session is still `PAID` — that shape means the previous webhook attempt flipped the Order but the paid-page enqueue failed. Second webhook attempt re-runs the enqueue. `Order` flip in the transaction is idempotent (`updateMany` with status guard), so re-running it is a safe no-op.
- **(Aug 21) Enqueue failure re-throws; controller returns 500; Razorpay retries.** Before re-throwing, the `WebhookEvent` row is deleted so the P2002 dedupe path doesn't block the retry. This replaces the earlier catch-and-log approach that stranded PAID sessions forever whenever Redis was down. The Order/Session status pair remain the real idempotency anchor; losing the WebhookEvent row on retry is fine.
- **`WebhookEvent` is written before the payload is dispatched**, so even an ignored event type leaves an audit trail. The `orderId` FK is backfilled afterwards, best-effort, inside a `.catch()`.
- **`PAID` then `GENERATING_PAID` is a two-step flip on purpose** — the same shape as `triggerGeneration`. Recovery when the second step fails is Razorpay's webhook retry (see above), not user-driven regenerate.
- **A payment with no matching local `Order` logs at `error` and returns normally.** An orphan payment is an admin task; retrying it just buries the signal.

**Paid-page generation**
- **`enqueuePaidGenerationJobs` mirrors `enqueuePreviewGenerationJobs` exactly**, with the filter inverted to `isPreviewPage: false`. Same orphan-row recovery, same `$transaction` insert, same enqueue-after-commit, same `computeJobPriority`.
- **(Aug 21) `maybeMarkPaidReady` now exists** — see the SD worker orchestration section above. Wired into `generationWorker.ts` alongside `maybeMarkPreviewComplete`; whichever helper's `isPreviewPage` filter doesn't match the finished page returns `not-done` and no-ops. Fires from both success and failure paths.

**Send-to-print & PDF compilation (added Aug 21)**
- **State machine post-CONFIRMED has explicit failure branches:** `COMPILING_PDF → PDF_FAILED` and `SHIPMENT_QUEUED → SHIPMENT_FAILED`. Both terminal, both require admin retry. Full chain:
<!-- ⚠️ The "Send-to-print & PDF compilation" entry above ends mid-sentence ("Full chain:").
     Pre-existing truncation, noticed Aug 24 session 2. The state machine it was describing is
     documented in full in PROJECT_CONTEXT.md §5 under "Session state chain post-CONFIRMED". -->

---

---

## Shiprocket integration (added Aug 29)

**Auth token lifecycle**
- **Auth token cached in `SystemConfig`, not in-memory.** In-memory would make each of four processes log in independently — wasted round-trips and multiple valid tokens floating around. DB cache means one login per 10 days across the whole system.
- **Token refresh margin: refresh 12 h before Shiprocket's documented 10-day expiry.** Prevents a long-running request from racing with mid-flight expiry.

**Client module structure**
- **`src/lib/shiprocket.ts` is the sole file that talks to Shiprocket.** Workers, webhook, admin endpoints, and services all go through it. Same pattern as `razorpay.ts` and `runpodClient.ts`.
- **Retry policy matches runpodClient exactly:** network / 5xx / 429 retryable, other 4xx not. Three attempts total with progressive backoff.
- **Error codes split by fault domain:** `SHIPROCKET_*_FAILED` = transport (retryable), `SHIPROCKET_*_REJECTED` = Shiprocket said no (not retryable), `SHIPROCKET_*_MALFORMED` = response parse issue (not retryable).

**Two-stage dimensions flow**
- **Phase A (worker, auto) uses placeholder dimensions from `shipping.ts`.** Real dimensions come at packaging time.
- **Phase B (admin endpoint, inline) pushes real dimensions via `updateOrder` BEFORE `assignAwb`.** Courier pricing depends on volumetric weight; wrong dimensions mean wrong charges or courier refusal at handover.
- **Phase B runs inline from the admin endpoint, not as a queued job.** Admin waits ~3–5 seconds for the sync response; simpler than adding a second queue + status push. Revisit only if admin UX complains.

**Idempotency**
- **`createShipmentForSession` uses two-tier idempotency check** — `Order.shiprocketOrderId` set AND `Order.status` past the transition point = no-op. `shiprocketOrderId` set but status inconsistent = log-and-no-op (needs admin).
- **Shiprocket's `create/adhoc` rejects duplicate `order_id` with 422**, and blocks reuse of cancelled-order IDs. Retry contract lives on our side, not theirs — never call `createOrder` twice with the same ID without checking DB first.
- **`assignAwb` is NOT idempotent** without `status: "reassign"`. Worker must check `Order.awbNumber` before calling.
- **`generatePickup` is NOT idempotent.** Worker must check `Order.pickupGeneratedAt` before calling.

**Webhook**
- **Auth is a plain shared token in `x-api-key` header**, not HMAC. Shiprocket doesn't offer signature-based auth.
- **Idempotency key synthesized as `shiprocket:${awb}:${current_status_id}:${current_timestamp}`.** Shiprocket sends no event id; this tuple is stable across their retries of the same event and distinct across genuinely new scans.
- **Payload with missing dedup fields (`awb`, `current_status_id`, `current_timestamp`) is logged and dropped**, not double-processed. Cannot dedupe without a stable key.
- **`current_status` normalized to uppercase before mapping lookup.** Shiprocket's casing is inconsistent across couriers (`"IN TRANSIT"` vs `"Delivered"`).
- **`WEBHOOK_ALLOWED_TRANSITIONS` gates every `Order.status` flip.** DELIVERED and CANCELLED are terminal — webhook can never overwrite them. `SHIPPED` allows self-transition (timestamps refresh cleanly on repeat webhooks).
- **`shippedAt` / `deliveredAt` set only on the FIRST transition** (`!order.shippedAt` check). Repeat webhooks don't reset the timestamp.
- **`Order.trackingStatus` always updated on every webhook**, even when `Order.status` doesn't change. Raw audit trail for admin.

**Status visibility split**
- **Users see only mapped `Order.status`** (5–7 friendly labels via `toPublicStatus()`).
- **Admin sees BOTH mapped `Order.status` AND raw `Order.trackingStatus`** on the order list, plus full `WebhookEvent.payloadJson` history on the detail page.
- **Nothing hidden from users — just organized by audience.** If users ever want more detail, expose `trackingStatus` on the user tracking page (zero backend change).

**Feature scope decisions**
- **NEVER cache Shiprocket-owned URLs (label, manifest).** Fetched fresh on every admin click. Shiprocket may rotate storage; stored URLs risk becoming dead links. Applies to `generateLabel`, `generateManifest`, `printManifest`.
- **Manifest generation deferred to Shiprocket dashboard for launch.** Backend functions exist; no admin endpoint or frontend UI. Admin prints manifests from Shiprocket's own portal. Revisit if context-switching becomes friction.
- **No user-facing shipment cancellation.** Backend `cancelOrder` exists for admin use only (wrong address, refund, defect, duplicate, abandoned READY_TO_SHIP).
- **International shipping deferred to Phase 2.** Schema fields already anticipate it (`Order.isInternational`); adding later is a ~6–10h additive branch (new endpoint variants + IEC/AD/HSN payload fields). Requires client IEC + AD Code + Shiprocket International product active — 3–6 weeks of client-side paperwork.
- **Package defaults hardcoded** in `shipping.ts`: 25 × 20 × 1 cm, 0.25 kg. Real dimensions per order supplied by admin at packaging (Phase B).

**Worker structure**
- **`shiprocketWorker` is a thin wrapper** matching `pdfWorker`'s shape — all logic lives in `shiprocket.service.ts::createShipmentForSession`.
- **Final-failure handler runs only after BullMQ exhausts all 3 retries** (`attemptsMade >= opts.attempts`). Flips `Order.status = SHIPROCKET_FAILED` and `OrderSession.status = SHIPMENT_FAILED` with `updateMany` status guards to prevent overwriting good state on a race.
- **API user email may be swapped later without code change** — credentials in `.env` + Render only. Currently client-owned as of this session.

**Never do (Shiprocket)**
- **Never cache label / manifest URLs on our side.** Shiprocket owns them; fetch fresh.
- **Never call `createOrder` for an `Order` that already has `shiprocketOrderId` set** — Shiprocket 422s on duplicate order_id and blocks reuse of cancelled-order IDs. Worker must check DB first.
- **Never call `assignAwb` or `generatePickup` twice for the same shipment without status guards** — neither is idempotent. Check `Order.awbNumber` and `Order.pickupGeneratedAt` respectively.
- **Never enqueue Phase B as a job** — runs inline from admin endpoint. Adding a queue would need progress-push infrastructure for no real gain at current volume.
- **Never expose Shiprocket raw `trackingStatus` on the user-facing UI** — user sees mapped `Order.status` only. Raw text is admin-only.
- **Never store the auth token in-memory across worker processes** — each process would log in independently, wasting round-trips. Use `SystemConfig` cache.
- **Never let the webhook overwrite `Order.status = DELIVERED`** — `WEBHOOK_ALLOWED_TRANSITIONS` doesn't list DELIVERED as a source for anything.
- **Never trust `current_status` casing from Shiprocket** — normalize to uppercase before `SHIPROCKET_STATUS_MAP` lookup.
- **Never build manifest UI in the admin panel for launch** — Shiprocket's dashboard already does it well. Backend function exists as a building block.

---

## Font shaping & bubble layout (added Sep 10–11)

- **opentype.js is patched to SKIP unsupported GSUB lookups, not throw.** A library gap must degrade a glyph, not kill a page — the unpatched `default:` branch took down generation for three BullMQ attempts per page.
- **Safe because `lookupFeature` only invokes the returned function for types it handles** (`11, 12, 21, 41, 51, 53, 63`); an unsupported type's no-op is never called.
- **Never try to disable `ccmp` via render options** — the feature is registered unconditionally and queried under the `"delf"` (default) script; no option reaches it. Patching is the only route.
- **`patches/` MUST be COPYed before `npm ci` in the Dockerfile.** Otherwise `postinstall` finds nothing, exits 0, and production silently runs unpatched while local works.
- **Never verify a font fix only against a font downloaded from upstream.** The deployed file is whatever the admin uploaded and may differ; test the actual artefact.
- **Layout diagnostics log at `info`, not `debug`.** The logger runs at `info` whenever `NODE_ENV=production`, so a debug line is invisible in exactly the environment where a bad render is most expensive to reproduce.
- **Never diagnose a render bug by inferring geometry from output pixels when a log line would state it.** Three wrong diagnoses this session; one log line settled it in one generation.
- **`fitTextToBox` must check width as well as height, and admins must size bubbles to the text.** The SVG canvas is the bubble box, so anything wider is destroyed, not overflowed.

## Frontend preloader (added Sep 11)

- **The preloader is a deliberate fixed ~55 s stall, not a progress measurement.** Generation already runs underneath it (the preview page's hooks fire regardless of what it renders); the stall buys the pipeline a head start.
- **It does not end early when pages are ready** — predictable pacing beats a variable wait.
- **Real errors break through it immediately** (expired / no preview pages / FAILED / no snapshot). Holding someone 55 s to then say it failed wastes their time.
- **Progress bar is a CSS keyframe animation, never a JS interval.** An interval can move backwards and did; a keyframe cannot, costs zero re-renders, and always starts from `from`.
- **Never drive a mount animation with a CSS transition flipped from an effect** — it only animates if the browser painted the start value in an earlier frame; when it doesn't, the bar snaps to full. Use `@keyframes`.
- **Callbacks passed to a timer-owning child go through a ref, not effect deps.** The parent passes an inline arrow and re-renders constantly (TanStack polls, WS events); depending on it restarted the timer every time. Fixing it in the parent instead would silently regress on the next edit.

---

## SUPERSEDED

Entries replaced in place; kept as one-liners so the old shape isn't re-proposed.

- **(Aug 24 · s2) "Font embedded as base64 `@font-face` data URI" in the Sharp text-stamping design** — never worked; librsvg discards the rule. Replaced by glyph outlines via opentype.js.
- **(Aug 24 · s2) "`avgCharWidthPx = fontSizePx * 0.6`, rough but adequate for MVP"** — replaced by real advance widths, which also revealed that bubble width was never being checked at all.
- **(Sep 10) "Fall back to per-glyph layout when a font cannot be shaped"** — built and verified, then made unreachable the same session by patching opentype.js so every font shapes. Code still present in `textStamp.ts`; scheduled for deletion.
