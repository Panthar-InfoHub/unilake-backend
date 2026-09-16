# End-to-End API Testing Guide (Apidog)

Purpose: walk through the **entire customer journey** — browse comic → create order session → upload photo → generate preview → login → checkout (Razorpay) → simulate payment webhook → paid-page generation → send to print → PDF compilation → Shiprocket shipment → admin dimension confirm/AWB → delivery — using nothing but raw API calls in Apidog.

> Call the numbered steps **in order**. Each step tells you exactly what to copy into the next one.

---

## 0. Setup

### 0.1 Base URL
Set an Apidog environment variable:
```
baseUrl = http://localhost:<PORT>       (PORT from your .env)
```

### 0.2 Response envelope
All non-webhook endpoints return:
```json
// success
{ "success": true, "message": "optional", "data": { } }
// error
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```
Error `code` values: `VALIDATION_ERROR`(400), `UNAUTHORIZED`(401), `FORBIDDEN`(403), `NOT_FOUND`(404), `CONFLICT`(409), `INTERNAL_SERVER_ERROR`(500).

### 0.3 Enable cookies in Apidog
This API uses **cookie-based auth** (better-auth), not bearer tokens. In Apidog, make sure the environment/runner has **"send cookies automatically"** turned on so the session cookie set by login is replayed on later requests.

### 0.4 Get an ADMIN user ready (needed later, step 15+)
better-auth's `role` field can't be set via signup API. After you sign up a user (step 9), open the DB and run:
```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'your-admin-test@example.com';
```
Use a **second** account for this (keep your normal customer account separate), or flip the same account to ADMIN only when you reach the admin steps.

### 0.5 Env vars you'll need values for while testing webhooks
From `src/config/env.ts` — grab these from your `.env` file:
- `RAZORPAY_WEBHOOK_SECRET` — used to sign the fake Razorpay webhook (step 14).
- `SHIPROCKET_WEBHOOK_TOKEN` — sent as a plain header for the Shiprocket webhook (step 19, optional).

---

## 1. Browse comics (public, no auth)

### 1.1 List comics
```
GET {{baseUrl}}/api/public/comics
```
Optional query params: `gender` (`BOY|GIRL|UNISEX`), `ageGroup` (`AGE_0_2|AGE_3_5|AGE_6_8|AGE_9_12`), `themeId` (uuid), `search`.

Response `data`: array of comics, each with `id`, `title`, `pageCount`, `pricingRules[]` (has `coverType` + `price` + `country`), etc.

**→ Copy a `comic.id` and one `pricingRules[].country.code` (e.g. `"IN"`) — you need both later.**

### 1.2 Get comic detail
```
GET {{baseUrl}}/api/public/comics/{{comicId}}
```
Confirms the comic is `PUBLISHED` and shows free preview pages + `pageCount`.

**→ Note `pageCount`** — you'll need to select exactly this many pages at send-to-print (step 17).

---

## 2. Create the order session (public)

```
POST {{baseUrl}}/api/public/sessions
Content-Type: application/json
```
Body:
```json
{ "comicId": "{{comicId}}" }
```
Response `data`: a full `OrderSession` row with `status: "CREATED"` and a `wsRoomToken`.

**→ Save `data.id` as `{{sessionId}}` and `data.wsRoomToken` as `{{wsRoomToken}}`.**

---

## 3. Fill in child + shipping details (public)

```
PATCH {{baseUrl}}/api/public/sessions/{{sessionId}}
Content-Type: application/json
```
Body — send at least one field, but send everything now so checkout doesn't fail later:
```json
{
  "childName": "Aryan",
  "age": 5,
  "pronounKey": "HE",
  "notificationEmail": "you@example.com",
  "coverType": "HARDCOVER",
  "shippingName": "Test Parent",
  "shippingLine1": "123 Test Street",
  "shippingLine2": "Apt 4B",
  "shippingCity": "Mumbai",
  "shippingState": "Maharashtra",
  "shippingZip": "400001",
  "shippingCountry": "IN",
  "shippingPhone": "9876543210"
}
```
Notes:
- `pronounKey`: `HE | SHE | THEY`.
- `coverType`: `HARDCOVER | SOFTCOVER`.
- `shippingCountry`: must be a 2-letter code that exists as an **active** `Country` row with a matching `PricingRule` for this comic+coverType (check via `GET /api/public/countries` if checkout later 404s on pricing).
- Once the session reaches `AWAITING_PAYMENT` or later, everything except `notificationEmail` locks — do this step now, before generating.

Response `data`: updated session row.

---

## 4. Upload the child's photo (public)

### 4.1 Request a presigned upload URL
```
POST {{baseUrl}}/api/public/sessions/{{sessionId}}/photo/upload-url
Content-Type: application/json
```
Body:
```json
{ "fileExtension": "jpg" }
```
(allowed: `jpg | jpeg | png | webp`)

Response `data`:
```json
{ "uploadUrl": "https://...&X-Amz-Signature=...", "key": "sessions/{{sessionId}}/photo-<timestamp>.jpg" }
```
**→ Save both `uploadUrl` and `key`.**

### 4.2 Upload the actual file — direct PUT to R2 (separate request, not this backend)
```
PUT {{uploadUrl}}
Content-Type: image/jpeg
Body: (raw binary — select "Binary" body type in Apidog, pick a real jpg file)
```
`Content-Type` must exactly match the extension you signed (`image/jpeg` for `jpg`/`jpeg`, `image/png` for `png`, `image/webp` for `webp`) or R2 rejects the signature. No auth header needed — the signature is in the URL. This URL expires in 5 minutes.

### 4.3 Confirm the upload
```
POST {{baseUrl}}/api/public/sessions/{{sessionId}}/photo/confirm
Content-Type: application/json
```
Body:
```json
{ "key": "sessions/{{sessionId}}/photo-<timestamp>.jpg" }
```
(must be the exact `key` from step 4.1)

Response `data.session`: session now has `bestPhotoUrl` set and `status: "PHOTO_UPLOADED"`.

---

## 5. (Optional) Connect the WebSocket to watch progress live

```
ws://<host:port>/?sessionId={{sessionId}}&token={{wsRoomToken}}
```
(same host/port as the HTTP API — it's a raw upgrade, not under `/api`). If Apidog's WS client is available, connect now before triggering generation in step 6, and watch for:
```json
{ "type": "page:ready", "pageNumber": 1, "variantIndex": 0, "imageUrl": "...", "displayImageUrl": "...", "pageVersionId": "uuid" }
{ "type": "page:error", "pageNumber": 1, "variantIndex": 0, "errorMessage": "..." }
{ "type": "session:preview-ready" }
```
If you skip the WebSocket, just poll step 6.2 (`GET session`) every few seconds instead.

---

## 6. Generate the preview pages (public)

### 6.1 Trigger generation
```
POST {{baseUrl}}/api/public/sessions/{{sessionId}}/generate
```
No body. Requires `childName`, `age`, `pronounKey`, `bestPhotoUrl` to already be set (steps 3 & 4) and session status `CREATED`/`PHOTO_UPLOADED`.

Response `data`:
```json
{ "status": "GENERATING_PREVIEW", "jobsEnqueued": 3 }
```

### 6.2 Poll until ready
```
GET {{baseUrl}}/api/public/sessions/{{sessionId}}
```
Keep polling every few seconds. Watch `data.status` go `GENERATING_PREVIEW → PREVIEW_READY`, and check `data.pages[].variants[]` for `status: "SD_READY"` with `finalImageUrl` populated. This can take real time since it calls RunPod/ComfyUI for face-swap pages.

### 6.3 (Optional) Regenerate a specific page
```
POST {{baseUrl}}/api/public/sessions/{{sessionId}}/pages/{{pageNumber}}/regenerate
```
No body. Only works while status is one of `GENERATING_PREVIEW, PREVIEW_READY, GENERATING_PAID, PAID_PAGES_READY, FAILED`, and only up to a max-variant cap (`src/config/generation.ts`).

---

## 7. Sign up / log in (needed before checkout)

### 7.1 Sign up
```
POST {{baseUrl}}/api/auth/sign-up/email
Content-Type: application/json
```
Body:
```json
{ "email": "customer-test@example.com", "password": "TestPass123!", "name": "Test Customer" }
```
This sets the session cookie automatically (`Set-Cookie: better-auth.session_token=...`). Make sure Apidog captured it.

### 7.2 Log in (if you already have an account / cookie expired)
```
POST {{baseUrl}}/api/auth/sign-in/email
Content-Type: application/json
```
Body:
```json
{ "email": "customer-test@example.com", "password": "TestPass123!" }
```

From here on, every `/api/user/*` call will carry this cookie automatically (as long as Apidog's cookie jar is on).

---

## 8. Attach the logged-in user to the session (protected)

```
PATCH {{baseUrl}}/api/public/sessions/{{sessionId}}/attach-user
```
No body. **Requires the auth cookie from step 7.** This is the one protected route inside the otherwise-public session flow.

- If the session has no `userId` yet → it gets set to your logged-in user's id.
- If it already belongs to a different user → `409 CONFLICT`.

Response `data`: updated session row with `userId` now set. **This must succeed before checkout**, since checkout requires `session.userId`.

---

## 9. Checkout — create the Razorpay order (public route, but needs userId set)

```
POST {{baseUrl}}/api/public/sessions/{{sessionId}}/checkout
```
No body. Preconditions checked server-side (all must already be true from earlier steps):
- session status `PREVIEW_READY`
- `userId` set (step 8)
- `coverType` set (step 3)
- all shipping fields set (step 3)
- an active `Country` + matching `PricingRule` exist for `(comicId, countryCode, coverType)`

Response `data`:
```json
{
  "orderId": "uuid",
  "razorpayOrderId": "order_xxxxxxxxxxxx",
  "razorpayKeyId": "rzp_test_xxxxxxxx",
  "amount": 199900,
  "currency": "INR",
  "displayAmount": "1999.00",
  "notificationEmail": "you@example.com"
}
```
**→ Save `orderId` (local Order id) and `razorpayOrderId`.** In a real frontend, `razorpayKeyId` + `razorpayOrderId` + `amount` + `currency` open the Razorpay Checkout widget. Since we're testing via Apidog only, skip the widget and simulate payment success with a webhook call (next step).

Calling this again while `Order.status` is still `CREATED` is safe (idempotent, returns the same values).

---

## 10. Simulate the Razorpay "payment captured" webhook

This is the trickiest step to do from Apidog because Razorpay requires a valid **HMAC-SHA256 signature** over the exact raw request body.

### 10.1 Build the JSON body (byte-for-byte — you'll sign this exact string)
```json
{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test123456789","order_id":"{{razorpayOrderId}}","amount":199900,"currency":"INR","status":"captured"}}}}
```
Use `{{razorpayOrderId}}` from step 9. **Do not pretty-print / reformat this JSON after computing the signature** — Apidog must send the identical bytes you hashed.

### 10.2 Compute the signature
Run this locally (Node) with your real `RAZORPAY_WEBHOOK_SECRET` from `.env`:
```js
const crypto = require("crypto");
const body = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test123456789","order_id":"order_xxxxxxxxxxxx","amount":199900,"currency":"INR","status":"captured"}}}}';
const secret = "<RAZORPAY_WEBHOOK_SECRET from .env>";
console.log(crypto.createHmac("sha256", secret).update(body).digest("hex"));
```
Copy the printed hex string.

### 10.3 Send the webhook
```
POST {{baseUrl}}/api/webhooks/razorpay
Content-Type: application/json
x-razorpay-signature: <hex signature from 10.2>
x-razorpay-event-id: evt_test_0001
```
Body: the exact same string from 10.1 (in Apidog, use "raw" body mode and disable any auto-formatting).

Expected response:
```json
{ "received": true }
```
A `400` means the signature didn't match — re-check that the body sent is byte-identical to what you hashed (no extra whitespace/reordering).

**Effect:** `Order.status: CREATED → PAID`, `OrderSession.status: AWAITING_PAYMENT → PAID → GENERATING_PAID` (paid-page generation jobs enqueued automatically).

---

## 11. Wait for paid-page generation (automatic)

```
GET {{baseUrl}}/api/public/sessions/{{sessionId}}
```
Poll until `data.status === "PAID_PAGES_READY"` (or watch the WebSocket for `session:paid-ready`). This regenerates/finalizes all pages (not just free previews) now that payment succeeded — no API call needed, it's worker-driven.

Check `data.pages[].variants[]` — you need at least one `SD_READY` variant per page to move on.

---

## 12. Log in again if needed, then view your orders (protected, `/api/user/*`)

```
GET {{baseUrl}}/api/user/orders
```
Requires the logged-in cookie (step 7). Response `data`: array including this order with `publicStatus: "Preparing your book"`.

```
GET {{baseUrl}}/api/user/orders/{{orderId}}
```
Full detail: shipping snapshot, `pdfDownloadUrl` (still null at this point), tracking fields (still null).

---

## 13. Send to print (protected)

```
POST {{baseUrl}}/api/user/sessions/{{sessionId}}/send-to-print
Content-Type: application/json
```
Body — pick exactly **one variant per page**, and the array length must equal the comic's `pageCount` (from step 1.2):
```json
{
  "selections": [
    { "pageNumber": 1, "variantIndex": 0 },
    { "pageNumber": 2, "variantIndex": 0 },
    { "pageNumber": 3, "variantIndex": 0 }
  ]
}
```
Use the actual `pageNumber`/`variantIndex` pairs you saw as `SD_READY` in step 11's session payload. Preconditions: you must own the session, session status must be `PAID_PAGES_READY`, and every selected `PageVersion` must be `SD_READY`.

Response `data`:
```json
{ "sessionId": "uuid", "orderId": "uuid", "status": "CONFIRMED", "pdfCompilationEnqueued": true }
```
Effect: `OrderSession.status → CONFIRMED`, `Order.status → CONFIRMED`, and a PDF-compile job is enqueued.

---

## 14. Wait for PDF compilation (automatic)

```
GET {{baseUrl}}/api/user/orders/{{orderId}}
```
Poll until `data.pdfDownloadUrl` is populated. Behind the scenes: `OrderSession.status` goes `CONFIRMED → COMPILING_PDF → SHIPMENT_QUEUED`, a real PDF is built from your selected pages and uploaded to R2, then a Shiprocket shipment-creation job is enqueued automatically (Phase A).

If it instead lands on `PDF_FAILED` (check via `GET /api/public/sessions/{{sessionId}}`), something in the selected pages/images failed — check server logs.

---

## 15. Wait for Shiprocket Phase A (automatic)

```
GET {{baseUrl}}/api/admin/orders/{{orderId}}
```
(requires ADMIN cookie — see 0.4/step 16.1). Poll until `data.status === "READY_TO_SHIP"` and `data.shipment.shiprocketOrderId` / `shiprocketShipmentId` are populated. `OrderSession.status` will be `COMPLETED` at this point (Phase A finishing = session complete from the customer's perspective; shipping continues via Order-level status).

If it lands on `SHIPROCKET_FAILED` instead, use step 16.4 (retry) before continuing.

---

## 16. Admin steps (require ADMIN-role cookie)

Log in as your admin test user (step 0.4) via `POST /api/auth/sign-in/email`, then:

### 16.1 List orders
```
GET {{baseUrl}}/api/admin/orders?page=1&pageSize=20&status=READY_TO_SHIP&sortBy=createdAt&sortOrder=desc
```
`status` is optional, one of: `CREATED, PAID, GENERATED, CONFIRMED, SHIPROCKET_FAILED, READY_TO_SHIP, SHIPPED, DELIVERED, CANCELLED`.

### 16.2 Order detail
```
GET {{baseUrl}}/api/admin/orders/{{orderId}}
```
Full detail including `shipment`, `dimensions`, `timestamps`, `webhookEvents[]`.

### 16.3 Confirm real package dimensions → assign AWB → schedule pickup (Phase B)
```
POST {{baseUrl}}/api/admin/orders/{{orderId}}/confirm-dimensions
Content-Type: application/json
```
Body (all numbers; bounds from `src/config/shipping.ts`: length/breadth/height 0.5–200 cm, weight 0.05–30 kg):
```json
{ "length": 25.0, "breadth": 18.0, "height": 2.5, "weight": 0.35 }
```
Preconditions: `Order.status === "READY_TO_SHIP"`, Phase A already ran (`shiprocketOrderId`/`shiprocketShipmentId` set), AWB not already assigned.

Response `data`:
```json
{ "awbCode": "1234567890123", "courierName": "Delhivery", "pickupScheduledDate": "2024-01-16T00:00:00.000Z" }
```

### 16.4 Retry Shiprocket (only if `Order.status === "SHIPROCKET_FAILED"`)
```
POST {{baseUrl}}/api/admin/orders/{{orderId}}/retry-shiprocket
```
No body.

### 16.5 Get shipping label
```
GET {{baseUrl}}/api/admin/orders/{{orderId}}/label
```
No body. Requires status ∈ `{READY_TO_SHIP, SHIPPED, DELIVERED}` and AWB already assigned (do this after 16.3).

### 16.6 Manually refresh tracking (fallback if you don't want to fake the Shiprocket webhook)
```
POST {{baseUrl}}/api/admin/orders/{{orderId}}/refresh-tracking
```
No body. Calls Shiprocket's real track-by-AWB API — only useful if you have a real Shiprocket test AWB. For pure local testing, use step 17 (fake webhook) instead.

---

## 17. Simulate Shiprocket tracking webhook (optional — moves order to SHIPPED/DELIVERED)

```
POST {{baseUrl}}/api/webhooks/shiprocket
Content-Type: application/json
x-api-key: <SHIPROCKET_WEBHOOK_TOKEN from .env>
```
Body (simulate "shipped"):
```json
{
  "awb": "<the awbCode from step 16.3>",
  "current_status": "In Transit",
  "current_status_id": 3,
  "current_timestamp": "2024-01-15 10:30:00",
  "courier_name": "Delhivery"
}
```
Expected response: `{ "received": true }`. Effect: `trackingStatus` updated, `Order.status → SHIPPED` (via `SHIPROCKET_STATUS_MAP`), `shippedAt` set.

Send a second call for delivery:
```json
{
  "awb": "<same awb>",
  "current_status": "Delivered",
  "current_status_id": 7,
  "current_timestamp": "2024-01-16 14:00:00",
  "courier_name": "Delhivery"
}
```
Effect: `Order.status → DELIVERED`, `deliveredAt` set (terminal state).

---

## 18. Verify the customer-facing tracking view

```
GET {{baseUrl}}/api/user/orders/{{orderId}}/tracking
```
(logged-in customer cookie, not admin). Response `data`:
```json
{
  "status": "Delivered",
  "courierName": "Delhivery",
  "shippedAt": "2024-01-15T10:30:00.000Z",
  "deliveredAt": "2024-01-16T14:00:00.000Z",
  "pickupScheduledDate": "2024-01-16T00:00:00.000Z",
  "trackingUpdatedAt": "2024-01-16T14:00:00.000Z"
}
```
This confirms the full loop end-to-end — the customer only ever sees the mapped/public status, never the raw enum or Shiprocket internals.

---

## Appendix A — Full endpoint reference (quick lookup)

| # | Method & Path | Auth | Body |
|---|---|---|---|
| 1.1 | `GET /api/public/comics` | none | — |
| 1.2 | `GET /api/public/comics/:comicId` | none | — |
| 2 | `POST /api/public/sessions` | none | `{ comicId }` |
| 3 | `PATCH /api/public/sessions/:sessionId` | none | any of the update fields |
| 4.1 | `POST /api/public/sessions/:sessionId/photo/upload-url` | none | `{ fileExtension }` |
| 4.2 | `PUT <uploadUrl>` | signed URL | raw file bytes |
| 4.3 | `POST /api/public/sessions/:sessionId/photo/confirm` | none | `{ key }` |
| 6.1 | `POST /api/public/sessions/:sessionId/generate` | none | — |
| 6.2 | `GET /api/public/sessions/:sessionId` | none | — |
| 6.3 | `POST /api/public/sessions/:sessionId/pages/:pageNumber/regenerate` | none | — |
| 7.1 | `POST /api/auth/sign-up/email` | none | `{ email, password, name }` |
| 7.2 | `POST /api/auth/sign-in/email` | none | `{ email, password }` |
| 8 | `PATCH /api/public/sessions/:sessionId/attach-user` | logged-in cookie | — |
| 9 | `POST /api/public/sessions/:sessionId/checkout` | none (needs userId set) | — |
| 10 | `POST /api/webhooks/razorpay` | `x-razorpay-signature` header | Razorpay payload |
| 12 | `GET /api/user/orders`, `GET /api/user/orders/:id` | logged-in cookie | — |
| 13 | `POST /api/user/sessions/:sessionId/send-to-print` | logged-in cookie | `{ selections: [...] }` |
| 15/16.2 | `GET /api/admin/orders/:orderId` | admin cookie | — |
| 16.1 | `GET /api/admin/orders` | admin cookie | — |
| 16.3 | `POST /api/admin/orders/:orderId/confirm-dimensions` | admin cookie | `{ length, breadth, height, weight }` |
| 16.4 | `POST /api/admin/orders/:orderId/retry-shiprocket` | admin cookie | — |
| 16.5 | `GET /api/admin/orders/:orderId/label` | admin cookie | — |
| 16.6 | `POST /api/admin/orders/:orderId/refresh-tracking` | admin cookie | — |
| 17 | `POST /api/webhooks/shiprocket` | `x-api-key` header | Shiprocket payload |
| 18 | `GET /api/user/orders/:orderId/tracking` | logged-in cookie | — |

## Appendix B — Session/Order status cheat sheet

**OrderSession.status:** `CREATED → PHOTO_UPLOADED → GENERATING_PREVIEW → PREVIEW_READY → AWAITING_PAYMENT → PAID → GENERATING_PAID → PAID_PAGES_READY → CONFIRMED → COMPILING_PDF → SHIPMENT_QUEUED → COMPLETED` (side branches: `FAILED`, `PDF_FAILED`, `SHIPMENT_FAILED`)

**Order.status:** `CREATED → PAID → GENERATED → CONFIRMED → READY_TO_SHIP → SHIPPED → DELIVERED` (side branches: `SHIPROCKET_FAILED`, `CANCELLED`)

| Transition | Who triggers it |
|---|---|
| `PREVIEW_READY → AWAITING_PAYMENT` | You call checkout (step 9) |
| `AWAITING_PAYMENT → PAID → GENERATING_PAID` | Razorpay webhook (step 10) |
| `GENERATING_PAID → PAID_PAGES_READY` | Automatic (worker) |
| `PAID_PAGES_READY → CONFIRMED` | You call send-to-print (step 13) |
| `CONFIRMED → COMPILING_PDF → SHIPMENT_QUEUED` | Automatic (PDF worker) |
| `SHIPMENT_QUEUED → COMPLETED` / `CONFIRMED → READY_TO_SHIP` | Automatic (Shiprocket Phase A worker) |
| AWB/pickup assignment (status stays `READY_TO_SHIP`) | Admin calls confirm-dimensions (step 16.3) |
| `READY_TO_SHIP → SHIPPED → DELIVERED` | Shiprocket webhook (step 17) or admin refresh-tracking (step 16.6) |
| `SHIPROCKET_FAILED → READY_TO_SHIP` | Admin calls retry-shiprocket (step 16.4) |

## Appendix C — Things that commonly break a fresh run

- **Pricing missing:** checkout 404s with "Pricing not configured" if no `PricingRule` exists for `(comicId, countryId, coverType)`. Seed one via `POST /api/admin/comics/:id/pricing` (admin) before step 1.
- **Country inactive/missing:** `shippingCountry` in step 3 must match an active `Country.code` — check `GET /api/public/countries`.
- **Webhook signature mismatch:** the exact byte string sent must be what you hashed in step 10.2 — any re-serialization (key reordering, extra spaces) breaks the HMAC check.
- **send-to-print selection count mismatch:** the `selections` array length must equal the comic's `pageCount` exactly, and every listed variant must already be `SD_READY`.
- **Admin routes 403:** the logged-in user's `role` must be `ADMIN` in the DB — this can't be set via the signup API.
