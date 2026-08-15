# Unilake Backend — Current State

**Rewritten every session.** Overwrite, don't append. Keep it small.

**Last updated:** August 15, 2026 — P1 bug-fix session. 10 of 13 P1 audit items closed, 3 deferred to before-launch. Two defects introduced by the fixes themselves were found on review and fixed the same session. Code + docs synced.

---

## DONE

**Everything through prior sessions** — see `SESSION_LOG.md` for detail.

### This session — 10 P1 audit items closed

**Preview completion overhaul (audits 9.1 + 9.2)** — `maybeMarkPreviewReady` renamed to `maybeMarkPreviewComplete`, counts pages in either terminal state (`SD_READY` or `FAILED`). Success-wins semantics — session flips to `PREVIEW_READY` if any single page succeeds, only flips to `FAILED` when every preview page has final-failed. Replaced fake row-lock with `updateMany` + status guard for real Postgres single-statement atomicity. Wired to `on("failed")` handler gated on `job.attemptsMade >= attempts`. Added `FAILED` to `REGENERATABLE_STATUSES` so users can self-recover totally-failed sessions.

### Found on review of this session's own work — both fixed

A review pass over the P1 fixes turned up two defects that the fixes themselves introduced. Neither is an audit item; both are recorded here rather than renumbered into the frozen audit.

**1. `FAILED` sessions could never recover.** Adding `FAILED` to `REGENERATABLE_STATUSES` let a user enqueue a regeneration, but `regeneratePage` never reset the session status — and `maybeMarkPreviewComplete` only flips sessions already at `GENERATING_PREVIEW`. So a *successful* regeneration wrote `SD_READY` on the page, the completion check matched zero rows, and the session stayed `FAILED` forever. The self-recovery path enqueued work with no route back out. **Fix:** `regeneratePage` now flips `FAILED → GENERATING_PREVIEW` via `updateMany` guarded on `status: "FAILED"`, placed *before* the enqueue (flipping after races a fast page finishing). No rollback on enqueue failure, deliberately. See `DECISIONS.md` → SD worker orchestration.

**2. `distinct: ["pageId"]` was nondeterministic.** `maybeMarkPreviewComplete` collapsed each page to one terminal row with no `orderBy`, so for a page holding variant 0 `FAILED` plus variant 1 `SD_READY` — exactly what regeneration produces — it could read the `FAILED` row and flip the whole session to `FAILED` despite the retry having worked. **Fix:** dropped `distinct`, load all terminal rows, reduce into `terminalPageIds` / `succeededPageIds` sets. Exact regardless of row order.

These two compounded: fix 1 alone would have produced a recovery path that nondeterministically undid itself, since a recovered session is precisely the mixed-variant shape fix 2 addresses.

**RunPod retry with backoff (audit 9.8)** — split `fetchStatus` into `fetchStatusOnce` (raw call) and `fetchStatus` (retry wrapper). Added `isRetryableError` distinguishing network failures and 5xx/429 (retry, up to 2 extra tries with 500ms/1000ms backoff) from permanent 4xx (fail immediately). One transient blip on any of ~200 status polls no longer double-charges GPU.

**Delete ordering (audits 8.9 + 8.15)** — `deletePage` and `deleteComic` restructured to DB-first-then-R2-cleanup. R2 keys collected before the DB delete; R2 cleanup runs after in try/catch. Matches the pattern the three CMS services already follow. Failed DB deletes now leave assets intact and recoverable rather than orphaning files with dead references.

**Env var validation (audits 2.9 + 2.10 + 2.11)** — added `R2_PUBLIC_URL_BASE` and `BETTER_AUTH_SECRET` to the boot-time required list; app now fails loudly instead of silently writing `undefined/<key>` as permanent URLs. Deleted unused `import { string } from "zod"`.

**Photo key ownership check (audit 8.2)** — `confirmSessionPhoto` now verifies the client-supplied key starts with `sessions/{thisSessionId}/`. Blocks cross-session photo theft, path traversal, and other malformed inputs in one string check. Logs a warning on rejection so ops can spot attack attempts.

**Session expiry enforcement (audit 11.1)** — added `assertNotExpired(session)` helper called at the top of all 6 session-mutating functions. Throws `ConflictError` and atomically flips status to `FAILED` via `updateMany` + status guard. Also added `sweepExpiredSessions` background job registered via `setInterval` in `initJobs`, runs hourly, safe against concurrent runs from multiple Cloud Run instances. R2 asset cleanup deferred (out of scope — needs reference checks).

**LOCKED contract docs (audit 13.1)** — verified already-fixed; `displayImageUrl` was correctly documented in both LOCKED sections before this session started.

**CI/CD (audit 1.1)** — auto-deploy from GitHub to Cloud Run is set up and working. Exact method (Cloud Build trigger / Cloud Run continuous deploy / GitHub Actions) TBD — needs confirmation and documentation in a follow-up session. Old references to `.github/workflows/deploy.yml` were inaccurate.

### Built prior to this session but previously unlogged

Same as prior state — `displayImageUrl` derivative, re-entrant preview enqueue, page reordering, public countries endpoint, comic-delete R2 sweep. Now committed as part of this session's changes.

---

## IN PROGRESS

Nothing.

---

## KNOWN OPEN ITEMS — MUST FIX BEFORE PUBLIC LAUNCH

These are **vulnerabilities, not defects.** App runs fine today. Must be closed before real customer data is in the DB.

- **Audit 8.1 — WebSocket token + PII leaked in public GET response.** `GET /api/public/sessions/:id` returns `wsRoomToken`, shipping address, and `notificationEmail` to any unauthenticated caller with a sessionId. Two-tier security model collapses to one tier. **Requires frontend coordination** — they need to save `wsRoomToken` from the POST creation response instead of re-fetching via GET.
- **Audit 3.4 + 4.1 — No file size cap + no rate limiting on public endpoints.** `/sessions`, `/feedbacks`, `/photo/upload-url`, `/generate`, `/regenerate` all unlimited. Presigned upload URLs have no `ContentLength` cap. Combined: attacker can pump gigabytes of garbage into R2 and burn GPU budget on garbage generations. Requires decisions on per-endpoint limits + `npm install express-rate-limit`.
- **CI/CD method needs documenting.** Auto-deploy works but exact config path (Cloud Build vs. Cloud Run continuous vs. GitHub Actions) is unverified. There is no `.github/` directory and no `cloudbuild.yaml` in the repo, so the config lives GCP-side. Check GCP Console → Cloud Run → service → Continuous deployment, then update `PROJECT_CONTEXT.md`.

## KNOWN OPEN ITEMS — NOT LAUNCH-BLOCKING BUT DECIDED-AND-DEFERRED

- **`FAILED` is overloaded three ways** (generation-failed / expired-on-mutation / expired-by-sweep). Documented rather than fixed. **Frontend consequence: must read `isExpired` before offering a retry button**, because `FAILED` is regeneratable but an expired session 409s on every attempt. A distinct `EXPIRED` enum value is the clean fix — one migration plus updates to `assertNotExpired`, `sweepExpiredSessions`, `REGENERATABLE_STATUSES`, and the two active-session guards. See `PROJECT_CONTEXT.md` §5.
- **Expiry sweeper is best-effort.** `setInterval` needs CPU always-allocated on Cloud Run. The in-process BullMQ workers suggest it is already on, but that is unverified (see VERIFY below). Layer 1 — `assertNotExpired` — carries all correctness, so a silent sweeper costs hygiene only.
- **Audit 9.3 (worker doesn't check expiry) got sharper.** A session flipped to `FAILED` mid-generation leaves its in-flight jobs running the full RunPod round-trip; those pages complete, then `maybeMarkPreviewComplete` no-ops on the status guard. Real GPU spend producing nothing reachable. A status/expiry check at the top of `processJob` closes it.

---

## NEXT (priority order)

Unchanged from prior sessions — no feature work happened this session.

1. **Checkout / confirm endpoints** (~6–8 h)
2. **Razorpay integration** (~10–14 h)
3. **Paid page generation** (~4–6 h) — mirror preview enqueue with `isPreviewPage: false` filter; add `maybeMarkPaidReady`
4. **PDF compilation with pdf-lib** (~6–8 h) — producer only; worker exists
5. **User + admin order endpoints** (~6–8 h)
6. **Shiprocket integration** (~10–14 h)
7. **Email notifications** (~6–8 h)
8. **Stabilization** (~8–10 h)

**Total remaining: ~50–74 h** of feature work.

---

## OPEN QUESTIONS

- **CORS origins for deployed frontend** — hardcoded `http://localhost:3000` in `app.ts` and Better Auth `trustedOrigins`. Three places to update together (also `crossSubDomainCookies` in `auth.ts`).
- **Client RunPod cost sign-off** — 1 active worker (~$250/month) vs. concurrency 5 (~$1,250/month).
- **JPEG quality for mask** — q88 could soften strict black/white edges. Verify in production.
- **Frontend seed type** — `PageVersion.seed` serializes as `string | null`.
- **Backend hard cap on artwork upload size (5 MB)** — admin discipline only. See audit 3.4 above.
- **Photo validation ownership** — moved to frontend. Legacy Python service file still on disk.
- Razorpay order ID reuse on retry; Shiprocket international address format; email provider; international Razorpay account.
- `validateQuery` middleware — deferred. Currently inline in 3 controllers.
- WebSocket rooms in-memory → needs Redis pub/sub for multi-instance.
- No signed-download endpoint for private assets.
- Python cleanup — deferred indefinitely.

---

## FIX LIST — remaining after this session

Full detail per file in **`CODE_VS_DOCS_AUDIT.md`** (125 items, frozen at August 11). All P1 items are now either fixed or in KNOWN OPEN ITEMS above. Remaining lower-priority items:

**Quick correctness wins (P2):**
- **8.3** Status guard on `updateOrderSession` — the sharpest of the four. Editing `childName` / `pronounKey` after generation desyncs the text already burned into the images, including post-payment.
- **8.20** Cross-comic font check on bubble create.
- **8.23** A way to toggle `Country.isActive`.
- **8.16** A way to detach a theme from a comic.

8.17 (`freePreviewPages` unchecked on update), 8.19, 8.20 and 8.23 are all the same habit — a rule enforced on create *or* update but never both. Worth fixing as one pass rather than four tickets.

**Also worth pulling forward:**
- **8.21 / 8.22** — fonts orphan their R2 files on both replace and delete. The only two services that skip cleanup entirely.
- **9.10** fonts re-downloaded from R2 on every single job (1–3 fonts × 24 pages × every session, forever).
- **9.11** a bubble flush against the artwork edge can crash the page in Sharp.
- **7.2 / 2.6** graceful shutdown still never calls `process.exit()` or `server.close()`.
- **12.1** nothing typechecks — `"types": []` plus `tsx`. This is the mechanism that let most of the other items accumulate silently.

**P2 + P3 sweep** — the audit's original counts were 40 P2 and 72 P3. Confirmed closed since: **P2** 2.10, 8.4, 8.5, 10.5, 11.3, 13.2 (≈34 left); **P3** 2.11, 8.6, 13.6, 13.7 (≈68 left). Most of the rest are one-line fixes, doc accuracy, or dead-code deletions. Recommended cutoff: clear all P2 before launch, defer P3 to post-launch.

---

## VERIFY / LOOSE ENDS

**🔴 From July 29 — still not run against a live server.**
- Public bucket CORS re-verify with real browser PUT from `localhost:3000`
- Page asset flow end-to-end
- Dimension probe populates `artworkWidth`/`artworkHeight`
- Mask size mismatch → 400
- Bubble bounds sweep
- Thumbnail delete + reorder
- R2 cleanup on page/comic delete (test the new DB-first ordering — force a DB error post-cleanup call and confirm assets survive)
- Zero-R2-traffic path (PATCH only `steps`)
- Per-page tunables

**Untested since built:**
- Page reorder — two-phase renumber, both 409 guards, partial/foreign-ID 400s never exercised.
- Display derivative — verify the WebP loads in a browser; verify fallback when `displayImageUrl` is null.
- Re-entrant enqueue — force a Redis failure mid-generate, retry `POST /generate`, confirm recovery.
- **New this session:** expiry enforcement — force an expired session (manually update `expiresAt`), confirm mutations 409 and status flips to FAILED.
- **New this session — the one that matters most:** the `FAILED` recovery round-trip. Force a session to full `FAILED` (all preview pages fail every attempt), then `POST /regenerate` on one page. Expect: session shows `GENERATING_PREVIEW` immediately, then `PREVIEW_READY` with a `session:preview-ready` emit once the page lands. Before this session's last two fixes that session could never leave `FAILED`. This single test exercises both fixes at once — the recovery path *and* the mixed-variant read that used to undo it.
- **New this session:** recovery that fails again — regenerate, let it fail all attempts, confirm the session returns to `FAILED` rather than being left in `GENERATING_PREVIEW`.
- **New this session:** expired session + regenerate — confirm it still 409s from `assertNotExpired` and never reaches the status flip.
- **New this session:** RunPod retry — simulate a network failure mid-poll, confirm the retry succeeds and the job doesn't get double-submitted.
- **New this session:** confirm Cloud Run CPU is always-allocated (GCP Console → Cloud Run → service → CPU allocation). If it is request-only, the hourly expiry sweeper never fires — and the in-process BullMQ workers are likely also mis-scheduled, which would be the bigger finding.
- **Nothing in this session was typechecked.** `"types": []` + `tsx` means no `tsc` pass exists (audit 12.1). Every fix above is verified by reading only; first real check is at runtime.

**Still open from August 7:**
- JPEG mask edges — verify face-swap boundaries in production.
- Stale `errorMessage` on old rows — optional cleanup query.
- Comic thumbnail prefix rename `comics/temp/` → `comics/thumbnails/` deferred.
- Full Apidog pass on page/bubble/font CRUD.

**Frontend-team dependency:**
- Frontend has not yet built the preview viewer / WebSocket consumer.
- Handoff doc still needs writing.

**Code cleanup backlog** (unchanged from prior session — none urgent).