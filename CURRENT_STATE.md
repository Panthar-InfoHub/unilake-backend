# Unilake Backend — Current State

**Rewritten every session.** Overwrite, don't append. Keep it small.

**Last updated:** July 24, 2026 (post bug-audit + response-standardization + frontend-handoff session)

---

## DONE

**Infrastructure & scaffold:**
- Express + TypeScript ESM, `app.ts`/`server.ts` split, centralized error handling, `asyncHandler`
- Prisma schema on Neon Postgres (see `schema.prisma`)
- Two-bucket R2 setup + `r2.ts` helper library
- Redis + BullMQ: 3 queues, 3 stub workers, graceful shutdown
- Better Auth: Google + Facebook + email/password, custom `role` field
- Docker: multi-stage, Python stripped, ~250MB, deployed to Cloud Run `asia-south1`
- GitHub Actions CI/CD → Artifact Registry → Cloud Run

**Auth:**
- `requireAdmin`, `requireLoggedIn` middleware
- Three-tier route structure (`/api/admin`, `/api/user`, `/api/public`)
- `PATCH /api/public/sessions/:id/attach-user`
- `createOrderSession` optionally reads cookie for auto-attach

**Full CRUD complete (admin + public where relevant):**
- Country, Theme, Comic, Page, Bubble, Font, AnnouncementBar, HeroImage, CustomerReview, TeamMember, Feedback
- SavedAddress CRUD (5 endpoints) with ownership + auto-default + default-promotion

**Order flow (partial):**
- `OrderSession` create/patch/get, WebSocket server with token auth
- Photo upload URL + Python validation pipeline (still live — see Open Questions)
- Generate trigger + per-page regenerate endpoints (enqueue jobs only — SD/HD workers are stubs, nothing actually generates yet)

**ComfyUI/RunPod learning (not deployed to client yet — carried over, untouched this session):**
- Face-swap workflow processed through comfy.getrunpod.io, GitHub repo created, Docker image built ("Ready")
- api-workflow.json confirmed usable as backend template; full path validated up to RunPod deploy step (halted on personal-account credit)

**This session — bug audit + fixes (all `npx tsc --noEmit` clean):**
- Fixed WebSocket room-join bug — `sessionId` wasn't being passed through `wss.emit("connection", ...)`, so every socket joined a room literally named "undefined." `page:ready`/`page:error` now actually reach the right client.
- Fixed `generateSessionHandler` and `regeneratePageHandler` — were using raw `.parse()`, so a bad `sessionId`/`pageNumber` produced an uncaught 500 instead of a clean 400. Now use `safeParse` + `ValidationError`.
- Fixed `errorHandler.ts` typo (`"devlopment"` vs `"development"`) that permanently suppressed real error messages, even in local dev.
- Fixed duplicate `GET /team-members` route registration in `admin.ts` — split into `/team-members` (all) and `/team-members/active`.
- **Standardized every controller's success response** to `{ success: true, data, message? }` via a new shared helper, `src/utils/response.ts` → `sendSuccess()`. Swept all 13 controllers. Also fixed a `messages` (typo key) in `country.controller.ts` and two raw/unwrapped handlers in `comic.controller.ts`.
- Added `thumbnailKey` support to `updateComicSchema` + `updateComic` — comic thumbnails can now be changed after creation via `PATCH /comics/:comicId`, with the old R2 file cleaned up best-effort (same pattern as `updateTeamMember`).
- Authored `FRONTEND_HANDOFF.md` — full API reference for every live endpoint (real request/response shapes from the actual Zod validators + controllers, not guessed), auth/CORS/error-contract docs, WebSocket protocol, end-to-end order-flow walkthrough, state machine tables, business rules, and an explicit doc/code mismatch section.

---

## IN PROGRESS

Nothing actively in progress. Client-account ComfyUI deployment is still the next big lift; CORS production-origin update is a small deferred task (see Next).

---

## NEXT (priority order)

1. **Update CORS allowed origins** once the frontend has a real deploy URL — currently hardcoded to `http://localhost:3000` only ([app.ts:26](src/app.ts#L26)). `credentials: true` already set correctly. (~15 min, whenever frontend gives a URL)
2. **ComfyUI face-swap endpoint deployment on CLIENT's RunPod account** (~4-8h including build wait) — fork repo to client's org, clean Dockerfile (remove 2509 duplicate downloads, ~20GB), deploy, test, then tune to production config (Active=1, Max=3-5, Idle=90s)
3. Seed real comic data (~3-4h)
4. SD worker real implementation — wire ComfyUI endpoint into `sdWorker.ts` (~16-24h)
5. Sharp text renderer (~8-12h)
6. Checkout / confirm endpoints (~6-8h)
7. Razorpay integration (~10-14h)
8. Paid page generation (~4-6h)
9. HD upscale ComfyUI deployment (second workflow) (~6-8h)
10. HD upscale + PDF compilation (~10-14h)
11. User + admin order endpoints (~6-8h)
12. Shiprocket integration (~10-14h)
13. Email notifications (~6-8h)
14. Publish flow (~6-8h)
15. Stabilization (~8-10h)

**Total remaining: ~110-150h. At 12h/day: ~10-13 working days.**

---

## OPEN QUESTIONS (currently unresolved)

- **Photo validation ownership** — docs/decisions say this moved to frontend MediaPipe.js, but `POST /sessions/:id/photo/validate` still runs the full legacy Python pipeline server-side and still gates `status → PHOTO_UPLOADED` on it. Decide: turn it off now that frontend has its own checks, or keep it as a secondary server-side gate indefinitely?
- **`https://unilake-backend.onrender.com`** appears in Better Auth `trustedOrigins` ([auth.ts](src/lib/auth.ts)) alongside the Cloud Run URL — confirm whether this is a live secondary deployment or stale leftover before documenting it anywhere as real.
- **Client-project cost sign-off**: ~$250/month baseline for 1 active RunPod worker — needs client approval before production tuning.
- **HD upscale workflow**: does it exist yet, or does the client still need to hand it over?
- **Comic page artwork upload path in production**: node 78's `Reference Body` currently references a test artifact — confirm `Page.artworkUrl` works as the real third `input.images[]` file during first test.
- Razorpay order ID reuse vs regeneration on payment retry
- Shiprocket international address fields — customs declaration format; country name vs ISO codes
- `validateQuery` middleware — not built, deferred
- WebSocket room map is in-memory → needs Redis pub/sub for multi-instance (accepted, Cloud Run pinned to 1)
- `PREVIEW_READY` status flipping mechanism — not designed (nothing currently transitions a session out of `GENERATING_PREVIEW`)
- Whether page generation stages can run ahead of session status
- Variant generation eagerness strategy
- Email provider — not chosen
- International Razorpay — external account setup needed
- Sharp coordinate scaling from bubble-mapper pixels to output resolution — not designed
- No signed-download endpoint exists for private-bucket assets (fonts, raw child photos) — if frontend ever needs to preview one directly, nothing serves that today
- Python cleanup timing — deferred, code retained

---

## VERIFY / LOOSE ENDS

- **Not yet manually verified end-to-end** — this session's fixes (response envelope, WS room join, comic thumbnail update, generate/regenerate error codes) were only confirmed via `npx tsc --noEmit`, not a live Apidog run. Do that before trusting them in front of the frontend team.
- `page.controller.ts`, `bubble.controller.ts`, `font.controller.ts` still call `schema.parse()` a second time on already-`validateBody`-validated `req.body` in their create/upload-url handlers — redundant, low risk, not yet cleaned up despite an earlier (inaccurate) claim that double-validation was fixed project-wide.
- **RunPod job ID mapping to `comfyPromptId1/2/3`**: field name kept, but semantics shift — stores RunPod job IDs, not ComfyUI native `prompt_id`. Document in code comments when writing `sdWorker.ts`.
- **BigInt seed → JSON**: `PageVersion.seed` is BigInt; must `Number(seed)` before serializing into workflow. Watch 53-bit precision limit.
- **Filename-match invariant**: `input.images[].name` MUST equal the workflow's LoadImage `inputs.image` string exactly. Bake into worker code as a single variable, not two.
