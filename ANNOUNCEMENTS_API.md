# Announcement Bar API — Frontend Integration Guide

**Audience:** Unilake frontend team
**Last updated:** July 27, 2026
**Source of truth:** [src/routes/admin.ts](src/routes/admin.ts), [src/routes/public.ts](src/routes/public.ts), [src/controllers/announcement.controller.ts](src/controllers/announcement.controller.ts), [src/services/announcement.service.ts](src/services/announcement.service.ts), [src/validators/announcement.schema.ts](src/validators/announcement.schema.ts)

---

## 1. What the announcement bar is

A rotating strip of short marketing messages at the top of the site ("Free shipping over ₹999", "Use code LAUNCH20", …). It is a flat list — no nesting, no images, no links, no scheduling.

A single announcement is:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID v4) | Server-generated. Never sent by you on create. |
| `message` | `string` | The text shown. Postgres `TEXT` — no server-side max length. |
| `isActive` | `boolean` | Only `true` rows appear on the public endpoint. **Defaults to `false` on create.** |
| `sortOrder` | `number` (int) | Ascending. Controls rotation order. Server-managed — you never set it directly except via the reorder endpoint. |
| `createdAt` | `string` (ISO 8601) | e.g. `"2026-07-27T09:14:22.113Z"` |
| `updatedAt` | `string` (ISO 8601) | Auto-bumped on every write. |

Schema: [prisma/schema.prisma:475-485](prisma/schema.prisma#L475-L485)

---

## 2. Base URLs

| Environment | Base URL |
|---|---|
| Local dev | `http://localhost:8080` |
| Deployed (Cloud Run) | `https://unilake-backend-590672762351.asia-south1.run.app` |

All paths below are appended to the base URL.

> **CORS heads-up:** the server currently allows **only** `http://localhost:3000` as an origin ([src/app.ts:32](src/app.ts#L32)). When you get a real deploy URL, tell backend and it gets added. Until then, a deployed frontend hitting the deployed backend will be blocked by the browser. `credentials: true` is already set, methods allowed are `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

---

## 3. Response envelope — read this before anything else

### Every success response (except `204`)

```json
{
  "success": true,
  "data": <the payload>
}
```

`sendSuccess()` ([src/utils/response.ts](src/utils/response.ts)) can also inject an optional `message` key, but **no announcement endpoint uses it**. So for announcements the shape is always exactly `{ success, data }`.

Your unwrapping helper should do `const { data } = await res.json()`. Never read `res.json().announcements` or similar — it does not exist.

### Every error response

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Announcement not found"
  }
}
```

Produced by [src/middlewares/errorHandler.ts](src/middlewares/errorHandler.ts). The full error-code table:

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body failed Zod validation, or a reorder ID doesn't exist |
| 401 | `UNAUTHORIZED` | No Better Auth session cookie / expired session |
| 403 | `FORBIDDEN` | Logged in, but `user.role !== "ADMIN"` |
| 404 | `NOT_FOUND` | Announcement ID doesn't exist |
| 500 | `INTERNAL_SERVER_ERROR` | Unhandled server fault |

**On 500 in production the real message is suppressed** and replaced with `"An unexpected error occurred on the server."` — don't try to parse detail out of it. In local dev (`NODE_ENV=development`) you get the raw message.

### The one exception: `DELETE`

`DELETE /api/admin/announcements/:id` returns **`204 No Content` with a completely empty body**. Calling `res.json()` on it will throw. Branch on `res.status === 204` before parsing.

---

## 4. Admin access — exactly how it works

### 4.1 The guard

Every route under `/api/admin/*` passes through `requireAdmin` ([src/middlewares/requireAdmin.ts](src/middlewares/requireAdmin.ts)), mounted at [src/app.ts:44](src/app.ts#L44). It runs in this order:

1. Reads the Better Auth session **from the request cookies**.
2. No valid session → `401 UNAUTHORIZED`, message `"Unauthorized: Active session required."`
3. Session exists but `user.role !== "ADMIN"` → `403 FORBIDDEN`, message `"Forbidden: Admin privileges required."`
4. Otherwise the request proceeds.

### 4.2 What you must do on the frontend

**There is no bearer token, no `Authorization` header, no API key.** Auth is a plain httpOnly session cookie issued by Better Auth. Your only job is to make sure the cookie rides along:

```js
// fetch
await fetch(`${BASE_URL}/api/admin/announcements`, {
  credentials: "include",          // <-- REQUIRED on every admin call
});

// axios
axios.defaults.withCredentials = true;
```

Because the cookie is `httpOnly` ([src/lib/auth.ts:47](src/lib/auth.ts#L47)) you **cannot read it from JS**. Do not attempt to store, forward, or inspect it.

### 4.3 Getting an admin session

Log in through the Better Auth handler mounted at `ALL /api/auth/*`:

- Email + password: `POST /api/auth/sign-in/email` with `{ "email": "...", "password": "..." }`
- Google: redirect through `/api/auth/sign-in/social` with `provider: "google"`
- Facebook: same with `provider: "facebook"`
- Current user: `GET /api/auth/get-session` → returns the user object including `role`
- Log out: `POST /api/auth/sign-out`

**The `ADMIN` role cannot be self-assigned.** `role` is declared with `input: false` ([src/lib/auth.ts:39](src/lib/auth.ts#L39)) — signup always creates `USER`. Admin accounts are promoted manually in the database by backend. So for the admin panel: sign in, call `get-session`, and gate the UI on `data.user.role === "ADMIN"`.

### 4.4 Cookie behavior by environment

| | Local (`NODE_ENV != production`) | Deployed (`NODE_ENV = production`) |
|---|---|---|
| `sameSite` | `lax` | `none` |
| `secure` | `false` | `true` (HTTPS only) |
| `httpOnly` | `true` | `true` |

Practical consequence: **in production the frontend must be served over HTTPS**, or the browser silently drops the session cookie and every admin call returns 401.

### 4.5 Access summary

| Endpoint | Guard |
|---|---|
| `GET /api/public/announcements` | 🟢 **None** — fully open, no cookie needed |
| `GET /api/admin/announcements` | 🔒 Admin |
| `POST /api/admin/announcements` | 🔒 Admin |
| `PATCH /api/admin/announcements/:id` | 🔒 Admin |
| `PATCH /api/admin/announcements/:id/status` | 🔒 Admin |
| `PATCH /api/admin/announcements/reorder` | 🔒 Admin |
| `DELETE /api/admin/announcements/:id` | 🔒 Admin |

---

## 5. Public endpoint

### `GET /api/public/announcements`

Returns **only active** announcements, sorted by `sortOrder` ascending. This is the endpoint the storefront ticker consumes.

**Auth:** none. **Query params:** none. **Request body:** none.

**Response `200`:**

```json
{
  "success": true,
  "data": [
    {
      "id": "9f1c7b2e-4a3d-4e88-9b1f-0c2d5a7e13aa",
      "message": "Free shipping on all orders above ₹999",
      "isActive": true,
      "sortOrder": 0,
      "createdAt": "2026-07-20T11:02:41.220Z",
      "updatedAt": "2026-07-26T08:15:03.887Z"
    },
    {
      "id": "1d4a8c30-77b6-4f2a-a1de-6b9e0f3c5511",
      "message": "Use code LAUNCH20 for 20% off your first comic",
      "isActive": true,
      "sortOrder": 1,
      "createdAt": "2026-07-21T06:44:19.004Z",
      "updatedAt": "2026-07-21T06:44:19.004Z"
    }
  ]
}
```

**Empty state:** `data` is `[]`, still `200`. This is normal and expected — hide the bar entirely, don't render an empty strip or a spinner.

**Errors:** none, other than a 500 if the DB is down.

**Note:** `isActive` is always `true` here (it's the filter), so don't bother branching on it. It's included because the whole row is returned.

---

## 6. Admin endpoints

All require the admin cookie (§4). All are under `/api/admin/announcements`.

---

### 6.1 `GET /api/admin/announcements` — list all

Returns **every** announcement, active and inactive, sorted by `sortOrder` ascending. This is what the admin management table renders.

**Request body:** none. **Query params:** none — there is no pagination, no filtering, no search. You get the entire table in one array. Filter client-side if you need an "active only" toggle in the admin UI.

**Response `200`:**

```json
{
  "success": true,
  "data": [
    {
      "id": "9f1c7b2e-4a3d-4e88-9b1f-0c2d5a7e13aa",
      "message": "Free shipping on all orders above ₹999",
      "isActive": true,
      "sortOrder": 0,
      "createdAt": "2026-07-20T11:02:41.220Z",
      "updatedAt": "2026-07-26T08:15:03.887Z"
    },
    {
      "id": "3b8e5f91-2c14-49a7-8d6b-e0f7a2c4d833",
      "message": "Draft: Diwali sale coming soon",
      "isActive": false,
      "sortOrder": 1,
      "createdAt": "2026-07-25T14:30:00.000Z",
      "updatedAt": "2026-07-25T14:30:00.000Z"
    }
  ]
}
```

**Errors:** `401`, `403`.

---

### 6.2 `POST /api/admin/announcements` — create

**Request body:**

```json
{
  "message": "Free shipping on all orders above ₹999"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `message` | `string` | ✅ yes | Trimmed by the server before validation, then must be at least 1 character. |

**`message` is the only accepted field.** Sending `isActive`, `sortOrder`, or `id` is not an error — Zod strips unknown keys silently — but they are **ignored completely**. Don't send them; you'll waste a debugging hour thinking `isActive: true` worked.

Server behavior:
- `isActive` is set to **`false`** (the DB default). A brand-new announcement is invisible on the storefront.
- `sortOrder` is auto-assigned as `(highest existing sortOrder) + 1`, or `0` if the table is empty. It always lands at the bottom of the list.

**Response `201`:**

```json
{
  "success": true,
  "data": {
    "id": "9f1c7b2e-4a3d-4e88-9b1f-0c2d5a7e13aa",
    "message": "Free shipping on all orders above ₹999",
    "isActive": false,
    "sortOrder": 2,
    "createdAt": "2026-07-27T09:14:22.113Z",
    "updatedAt": "2026-07-27T09:14:22.113Z"
  }
}
```

**Errors:**

| Status | Body |
|---|---|
| 400 | `{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Validation failed - message: message is required"}}` — missing, empty, or whitespace-only `message` |
| 400 | `"Validation failed - message: Invalid input: expected string, received number"` — wrong type |
| 401 / 403 | See §4 |

**UX recommendation:** after a successful create, immediately follow with the status-toggle call (§6.4) if the admin ticked an "publish now" checkbox — creation alone never publishes.

---

### 6.3 `PATCH /api/admin/announcements/:id` — update the text

**Path param:** `id` — the announcement UUID.

**Request body:**

```json
{
  "message": "Free shipping on all orders above ₹1499"
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `message` | `string` | optional *(but see below)* | Trimmed, min 1 char after trim. |

The schema marks `message` optional but then refines that **at least one field must be present**. Since `message` is the only field that exists, in practice **`message` is effectively required** — an empty body `{}` is a 400.

**This endpoint cannot change `isActive` or `sortOrder`.** Use §6.4 and §6.5 respectively.

**Response `200`:** the full updated row.

```json
{
  "success": true,
  "data": {
    "id": "9f1c7b2e-4a3d-4e88-9b1f-0c2d5a7e13aa",
    "message": "Free shipping on all orders above ₹1499",
    "isActive": true,
    "sortOrder": 0,
    "createdAt": "2026-07-20T11:02:41.220Z",
    "updatedAt": "2026-07-27T09:31:10.552Z"
  }
}
```

**Errors:**

| Status | Code | Trigger |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `{}` → `"Validation failed - : At least one field must be provided"` |
| 400 | `VALIDATION_ERROR` | `{"message":"   "}` → `"Validation failed - message: message cannot be empty"` |
| 404 | `NOT_FOUND` | `"Announcement not found"` — ID doesn't exist |
| 401 / 403 | | See §4 |

> ⚠️ **Route-order trap:** `PATCH /api/admin/announcements/reorder` is registered **before** `PATCH /api/admin/announcements/:id` ([src/routes/admin.ts:238-247](src/routes/admin.ts#L238-L247)). This is deliberate and correct. It means the literal string `reorder` can never be used as an announcement ID — irrelevant in practice since IDs are UUIDs, but don't "fix" the ordering if you're reading the route file.

---

### 6.4 `PATCH /api/admin/announcements/:id/status` — toggle active/inactive

**Path param:** `id` — the announcement UUID.

**Request body: NONE.** This is a **toggle**, not a setter. There is no `validateBody` on this route and the handler never reads `req.body`. Sending `{"isActive": true}` does nothing — the server flips whatever the current value is.

```js
await fetch(`${BASE_URL}/api/admin/announcements/${id}/status`, {
  method: "PATCH",
  credentials: "include",
  // no body, no Content-Type needed
});
```

**Consequence for your UI:** you cannot idempotently "set to active." If you fire this twice (double-click, retry-on-timeout) you land back where you started. Disable the switch while the request is in flight, and drive the switch's rendered state from the `isActive` value in the **response**, not from optimistic local state.

**Response `200`:** the full row with `isActive` flipped.

```json
{
  "success": true,
  "data": {
    "id": "9f1c7b2e-4a3d-4e88-9b1f-0c2d5a7e13aa",
    "message": "Free shipping on all orders above ₹999",
    "isActive": true,
    "sortOrder": 0,
    "createdAt": "2026-07-20T11:02:41.220Z",
    "updatedAt": "2026-07-27T09:40:55.019Z"
  }
}
```

**Errors:** `404 NOT_FOUND` (`"Announcement not found"`), `401`, `403`.

---

### 6.5 `PATCH /api/admin/announcements/reorder` — set the rotation order

**Path:** literally `/api/admin/announcements/reorder` — no ID in the path.

**Request body:**

```json
{
  "orderedIds": [
    "3b8e5f91-2c14-49a7-8d6b-e0f7a2c4d833",
    "9f1c7b2e-4a3d-4e88-9b1f-0c2d5a7e13aa",
    "1d4a8c30-77b6-4f2a-a1de-6b9e0f3c5511"
  ]
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `orderedIds` | `string[]` | ✅ yes | Each element must be a valid **UUID**. Array must be non-empty. **No duplicates.** Every ID must exist in the DB. |

Server behavior: the array index becomes the new `sortOrder`. First element → `sortOrder: 0`, second → `1`, and so on. All updates run inside a single `$transaction`, so it's all-or-nothing.

> ⚠️ **Always send the complete list of all announcements, in the desired order.** The endpoint accepts a partial list, but it will assign `0, 1, 2…` to just those rows, colliding with the `sortOrder` of the rows you omitted and producing a non-deterministic display order. The correct flow is: `GET /api/admin/announcements` → drag-and-drop the full array in the UI → `PATCH …/reorder` with every ID.

**Response `200`:** the **entire** re-sorted list (same shape as §6.1), so you can drop it straight into state and skip a refetch.

```json
{
  "success": true,
  "data": [
    { "id": "3b8e5f91-...", "message": "Draft: Diwali sale coming soon", "isActive": false, "sortOrder": 0, "createdAt": "...", "updatedAt": "..." },
    { "id": "9f1c7b2e-...", "message": "Free shipping on all orders above ₹999", "isActive": true, "sortOrder": 1, "createdAt": "...", "updatedAt": "..." },
    { "id": "1d4a8c30-...", "message": "Use code LAUNCH20 …", "isActive": true, "sortOrder": 2, "createdAt": "...", "updatedAt": "..." }
  ]
}
```

**Errors:**

| Status | Code | Message |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `"Validation failed - orderedIds.0: Invalid uuid"` — a non-UUID element |
| 400 | `VALIDATION_ERROR` | `"Validation failed - orderedIds: orderedIds cannot be empty"` — `[]` |
| 400 | `VALIDATION_ERROR` | `"Validation failed - orderedIds: orderedIds cannot contain duplicates"` |
| 400 | `VALIDATION_ERROR` | `"One or more announcement IDs do not exist"` — passed Zod, failed the DB existence check. **Note this is a 400, not a 404.** Usually means someone deleted a row in another tab; refetch the list. |
| 401 / 403 | | See §4 |

---

### 6.6 `DELETE /api/admin/announcements/:id` — delete

**Path param:** `id` — the announcement UUID. **Request body:** none.

Hard delete. No soft-delete flag, no undo, no R2 cleanup (announcements have no files). If the admin might want it back, toggle it inactive instead of deleting.

**Response `204 No Content` — empty body, no envelope.**

```js
const res = await fetch(`${BASE_URL}/api/admin/announcements/${id}`, {
  method: "DELETE",
  credentials: "include",
});
if (res.status === 204) {
  // success — do NOT call res.json(), it will throw
}
```

**Errors:** `404 NOT_FOUND` (`"Announcement not found"`), `401`, `403`. Error responses *do* have a JSON body — only the 204 success is empty.

> **`sortOrder` gaps after delete:** deleting does not renumber the remaining rows, so you can end up with `sortOrder` values like `0, 2, 3`. This is harmless — ordering is relative, and the list still sorts correctly. If you want them tidy, follow the delete with a reorder call.

---

## 7. Quick reference

| # | Method | Path | Auth | Body | Success |
|---|---|---|---|---|---|
| 1 | `GET` | `/api/public/announcements` | none | — | `200` → array (active only) |
| 2 | `GET` | `/api/admin/announcements` | admin | — | `200` → array (all) |
| 3 | `POST` | `/api/admin/announcements` | admin | `{ message }` | `201` → object |
| 4 | `PATCH` | `/api/admin/announcements/:id` | admin | `{ message }` | `200` → object |
| 5 | `PATCH` | `/api/admin/announcements/:id/status` | admin | **none** | `200` → object |
| 6 | `PATCH` | `/api/admin/announcements/reorder` | admin | `{ orderedIds: string[] }` | `200` → array |
| 7 | `DELETE` | `/api/admin/announcements/:id` | admin | — | `204` → **empty** |

---

## 8. Gotchas checklist

Tick these off before you say the integration is done:

- [ ] Every admin call sends `credentials: "include"` (or `withCredentials: true`).
- [ ] Unwrapping `.data` from `{ success, data }`, not reading the payload at the top level.
- [ ] `DELETE` is branched on `status === 204` and never calls `res.json()` on success.
- [ ] The create form does **not** send `isActive` / `sortOrder` — and the UI makes clear that a new announcement starts **hidden**.
- [ ] The status switch sends **no body** and is disabled during the request, with state driven by the response.
- [ ] Reorder always sends the **full** ID list, not just the moved subset.
- [ ] The public bar renders nothing when `data` is `[]`.
- [ ] `400` from reorder with `"One or more announcement IDs do not exist"` triggers a refetch, not a generic error toast.
- [ ] Admin panel gates on `role === "ADMIN"` from `GET /api/auth/get-session`, and handles `401` (send to login) separately from `403` (show "not an admin").
- [ ] Backend has been given the deployed frontend URL so it can be added to CORS + Better Auth `trustedOrigins`.

---

## 9. Open item for backend

`POST` and `PATCH` cannot set `isActive`, and the status route is a blind toggle rather than a setter. If the admin UI wants "create and publish in one action" or idempotent set-active semantics (safer against retries), that's a small backend change — raise it and it can be added.
