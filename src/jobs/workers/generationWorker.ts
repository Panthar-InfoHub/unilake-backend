// src/jobs/workers/generationWorker.ts
//
// Consumes jobs from the "sd-generation" queue and runs the full pipeline
// for one PageVersion: text stamp → (RunPod face swap for face pages)
// → upload → notify. On any error, marks the row FAILED, emits page:error,
// releases the photo cache, then re-throws so BullMQ's retry policy applies.

import { Worker, type Job } from "bullmq";
import { randomUUID } from "crypto";
import { redisClient } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import {
  uploadFile,
  getPublicUrl,
  getKeyFromPublicUrl,
  downloadFileToBuffer,
} from "../../lib/r2.js";
import {
  emitPageReady,
  emitPageError,
  emitSessionPreviewReady,
} from "../../websocket/event.js";
import { stampTextOnPage } from "./sd/textStamp.js";
import { buildWorkflow } from "./sd/workflow.js";
import { submitAndAwaitResult } from "./sd/runpodClient.js";
import { acquirePhoto, releasePhoto } from "./sd/photoCache.js";
import { buildDisplayImage } from "../../lib/image.js";
import sharp from "sharp";

type GeneratePageJobData = {
  pageVersionId: string;
};

const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Best-effort cleanup on failure: mark row FAILED with a human-readable
 * error message. Failures inside this function are logged, never thrown —
 * we're already inside a catch block; a nested throw would mask the
 * original error.
 */
async function markPageVersionFailed(
  pageVersionId: string,
  err: unknown
): Promise<string> {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const errorMessage = rawMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH);

  try {
    await prisma.pageVersion.update({
      where: { id: pageVersionId },
      data: {
        status: "FAILED",
        errorMessage,
      },
    });
  } catch (dbErr) {
    logger.error(
      { pageVersionId, dbErr },
      "[SD Worker] Failed to mark PageVersion FAILED — leaving in prior status"
    );
  }

  return errorMessage;
}

/**
 * Builds the browser-facing derivative of a finished page and uploads it beside
 * the print master, returning its public URL.
 *
 * 🔴 Best-effort on purpose — never throws.
 *
 * By the time this runs, the print PNG is already uploaded and the expensive
 * work (a GPU round trip that can take minutes) is done. Failing the whole job
 * because a resize failed would throw all of that away and hand the user a
 * FAILED page for a purely cosmetic problem.
 *
 * So on failure we log and return null. The API then returns
 * `displayImageUrl: null`, the frontend falls back to `finalImageUrl`, and the
 * user sees their page — just the heavier version. Degraded, not broken.
 */
async function buildAndUploadDisplayImage(
  sessionId: string,
  pageVersionId: string,
  sourceBuffer: Buffer
): Promise<string | null> {
  try {
    const displayBuffer = await buildDisplayImage(sourceBuffer);
    const displayKey = `sessions/${sessionId}/final/${pageVersionId}.webp`;

    await uploadFile("public", displayKey, displayBuffer, "image/webp");

    logger.info(
      {
        pageVersionId,
        printBytes: sourceBuffer.length,
        displayBytes: displayBuffer.length,
        reduction: `${(sourceBuffer.length / displayBuffer.length).toFixed(1)}x`,
      },
      "[SD Worker] Display image uploaded"
    );

    return getPublicUrl(displayKey);
  } catch (err) {
    logger.warn(
      { err, pageVersionId },
      "[SD Worker] Display image build failed — falling back to the print master"
    );
    return null;
  }
}

/**
 * Check whether this was the final preview page for the session. If so,
 * atomically flip the session status to PREVIEW_READY and emit the
 * WebSocket event. Uses a transaction with row-level locking to prevent
 * duplicate transitions when multiple pages finish concurrently.
 *
 * Safe to call after every SD_READY. Returns whether the transition fired,
 * mainly for logging.
 */
async function maybeMarkPreviewReady(
  orderSessionId: string,
  comicId: string
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    // Lock the row so concurrent workers block here until we commit.
    // Prisma doesn't have a first-class SELECT FOR UPDATE, but calling
    // findUnique inside a transaction serializes access via Postgres'
    // MVCC — combined with the status check below, no duplicate flips.
    const session = await tx.orderSession.findUnique({
      where: { id: orderSessionId },
      select: { status: true },
    });

    if (!session) return false;

    // Someone else already flipped it. Nothing to do.
    if (session.status !== "GENERATING_PREVIEW") {
      return false;
    }

    // `Page.isPreviewPage` is the only source of truth for which pages are
    // free — the same filter enqueuePreviewGenerationJobs uses to decide what
    // to generate. Counting against Comic.freePreviewPages instead desyncs the
    // moment that counter drifts from the flags: too high and the session
    // never leaves GENERATING_PREVIEW, too low and it flips early.
    const totalPreviewPages = await tx.page.count({
      where: { comicId, isPreviewPage: true },
    });

    // No preview pages flagged means nothing was ever enqueued — never flip.
    // Without this guard the comparison below is 0 >= 0 and fires instantly.
    if (totalPreviewPages === 0) return false;

    // Count distinct pages that have at least one SD_READY variant.
    // We count on `pageId` so pages with multiple variants only count once.
    // Scoped to preview pages so paid-page generations can never satisfy the
    // preview transition.
    const readyPreviewPages = await tx.pageVersion.findMany({
      where: {
        orderSessionId,
        status: "SD_READY",
        page: { isPreviewPage: true },
      },
      select: { pageId: true },
      distinct: ["pageId"],
    });

    if (readyPreviewPages.length < totalPreviewPages) {
      return false; // Not the last one yet.
    }

    // We're the last. Flip the status.
    await tx.orderSession.update({
      where: { id: orderSessionId },
      data: { status: "PREVIEW_READY" },
    });

    return true;
  });
}

async function processJob(job: Job<GeneratePageJobData>): Promise<void> {
  const { pageVersionId } = job.data;

  logger.info(
    { jobId: job.id, pageVersionId, attempt: job.attemptsMade + 1 },
    "[SD Worker] Picked up job"
  );

  // === 1. FETCH THE ROW + EVERYTHING RELATED ===
  const pageVersion = await prisma.pageVersion.findUnique({
    where: { id: pageVersionId },
    include: {
      page: {
        include: {
          bubbles: {
            include: { font: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
      orderSession: true,
    },
  });

  // Row deleted between enqueue and pickup. Not retryable — return success
  // so BullMQ drops it cleanly. No page:error emit; the row is gone.
  if (!pageVersion) {
    logger.warn(
      { jobId: job.id, pageVersionId },
      "[SD Worker] PageVersion not found, dropping job"
    );
    return;
  }

  const { page, orderSession } = pageVersion;
  const sessionId = orderSession.id;

  // === 2. IDEMPOTENCY GUARD ===
  //
  // Already succeeded on a prior attempt. Re-emit for late-joining browsers
  // and skip. No error handling needed for this branch — nothing acquired
  // or transitioned.
  if (pageVersion.status === "SD_READY" && pageVersion.finalImageUrl) {
    logger.info(
      { jobId: job.id, pageVersionId },
      "[SD Worker] Already SD_READY, re-emitting and skipping"
    );
    emitPageReady(sessionId, {
      pageNumber: page.pageNumber,
      variantIndex: pageVersion.variantIndex,
      imageUrl: pageVersion.finalImageUrl,
      // May be null on rows written before this field existed, or where the
      // derivative failed. The client falls back to imageUrl.
      displayImageUrl: pageVersion.displayImageUrl,
      pageVersionId: pageVersion.id,
    });
    return;
  }

  // === OUTER TRY/CATCH ===
  //
  // Wraps everything from invariant checks onward. Any thrown error marks
  // the row FAILED, emits page:error, releases photo cache if we acquired
  // it, then re-throws so BullMQ retry policy applies.

  let photoAcquired = false;

  try {
    // === 3. GUARD INVARIANTS ===
    //
    // Guards are split into "always required" vs "only if hasFace".
    // Non-face pages don't need bestPhotoUrl, mask, or pagePrompt because
    // they skip RunPod entirely.
    if (!orderSession.childName) {
      throw new Error(`Session ${sessionId} has no childName`);
    }
    if (!orderSession.pronounKey) {
      throw new Error(`Session ${sessionId} has no pronounKey`);
    }
    if (!page.artworkUrl || !page.artworkWidth || !page.artworkHeight) {
      throw new Error(`Page ${page.id} has no artwork or dimensions`);
    }

    // Face-only requirements — mask + prompt for ComfyUI, photo for the swap.
    if (page.hasFace) {
      if (!orderSession.bestPhotoUrl) {
        throw new Error(`Session ${sessionId} has no bestPhotoUrl`);
      }
      if (!page.maskUrl) {
        throw new Error(`Face page ${page.id} has no mask`);
      }
      if (!page.pagePrompt) {
        throw new Error(`Face page ${page.id} has no pagePrompt`);
      }
    }

    // === 4. TEXT STAMP (reuse or fresh) ===
    //
    // Runs for BOTH face and non-face pages. `stampTextOnPage` gracefully
    // returns the raw artwork when a page has zero bubbles — so a non-face
    // no-bubble page just downloads the artwork and re-uploads it, which
    // gives every session its own copy under sessions/{id}/.
    let textStampedUrl = pageVersion.textStampedUrl;

    if (textStampedUrl) {
      logger.info(
        { pageVersionId, textStampedUrl },
        "[SD Worker] Reusing existing text-stamped image from prior attempt"
      );
    } else {
      await prisma.pageVersion.update({
        where: { id: pageVersionId },
        data: { status: "TEXT_STAMPING" },
      });

      const stampedBuffer = await stampTextOnPage({
        page,
        bubbles: page.bubbles,
        childName: orderSession.childName,
        pronounKey: orderSession.pronounKey,
      });

      const stampedKey = `sessions/${sessionId}/stamped/${pageVersionId}.png`;
      await uploadFile("public", stampedKey, stampedBuffer, "image/png");
      textStampedUrl = getPublicUrl(stampedKey);

      await prisma.pageVersion.update({
        where: { id: pageVersionId },
        data: { status: "TEXT_STAMPED", textStampedUrl },
      });

      logger.info(
        { pageVersionId, textStampedUrl, hasFace: page.hasFace },
        "[SD Worker] Text stamped and uploaded"
      );
    }

    // === 5. FORK ON hasFace ===
    //
    // Face pages go through RunPod; non-face pages are done after the
    // stamp step. For non-face pages, we re-upload the stamped buffer
    // under the /final/ prefix so every session owns a full copy — no
    // shared refs to comic-level artwork that would break if the comic
    // gets deleted.

    let finalImageUrl: string;
    // Null when the derivative could not be built — see buildAndUploadDisplayImage.
    let displayImageUrl: string | null = null;
    let comfyJobId: string | null = null;

    if (!page.hasFace) {
      // Non-face path: the stamped image IS the final image. Copy it
      // into sessions/{sessionId}/final/{pageVersionId}.png so the row
      // owns a full copy. We download from R2 and re-upload rather than
      // server-side CopyObject to keep the code path identical to the
      // face branch below.
      logger.info(
        { pageVersionId, pageNumber: page.pageNumber },
        "[SD Worker] Non-face page — skipping RunPod"
      );

      const stampedBuffer = await downloadFileToBuffer(
        "public",
        getKeyFromPublicUrl(textStampedUrl)
      );

      const finalKey = `sessions/${sessionId}/final/${pageVersionId}.png`;
      await uploadFile("public", finalKey, stampedBuffer, "image/png");
      finalImageUrl = getPublicUrl(finalKey);

      displayImageUrl = await buildAndUploadDisplayImage(
        sessionId,
        pageVersionId,
        stampedBuffer
      );
    } else {
      // === 5a. GATHER INPUTS FOR COMFYUI ===
      const stampedBufferForComfy = await downloadFileToBuffer(
        "public",
        getKeyFromPublicUrl(textStampedUrl)
      );

      const maskBuffer = await downloadFileToBuffer(
        "public",
        getKeyFromPublicUrl(page.maskUrl!) // guarded above
      );

      // Photo cache is acquired here; must be released in finally block below.
      const childPhotoBuffer = await acquirePhoto(
        sessionId,
        orderSession.bestPhotoUrl! // guarded above
      );
      photoAcquired = true;

      // === 5b. BUILD THE PATCHED WORKFLOW ===
      //
      // Filenames use .jpg to match the JPEG transcoding done below. ComfyUI's
      // LoadImage node accepts either format, but keeping the extension honest
      // avoids any decoder confusion.
      const artworkFilename = `artwork_${randomUUID()}.jpg`;
      const maskFilename = `mask_${randomUUID()}.jpg`;
      const photoFilename = `photo_${randomUUID()}.jpg`;
      const seed = Math.floor(Math.random() * 1_000_000_000);

      const workflow = buildWorkflow({
        artworkFilename,
        maskFilename,
        childPhotoFilename: photoFilename,
        seed,
        steps: page.steps,
        cfg: page.cfg,
        pagePrompt: page.pagePrompt!, // guarded above
      });

      // === 5c. MARK GENERATING_SD ===
      await prisma.pageVersion.update({
        where: { id: pageVersionId },
        data: {
          status: "GENERATING_SD",
          seed: BigInt(seed),
        },
      });

      // === 5c.5. TRANSCODE TO JPEG FOR RUNPOD PAYLOAD ===
      //
      // Lossless PNG at print resolution is what we STORE in R2 (that's the
      // user-visible / print-bound image). But RunPod caps API payloads at
      // 10 MiB, and a 2000×1455 PNG can hit 8 MB by itself. JPEG at quality
      // 88 gets us to ~400 KB per image with no perceivable quality drop
      // on photorealistic comic art. The face-swap OUTPUT from RunPod is
      // separate — it comes back at ComfyUI's stitched resolution and gets
      // stored as PNG in R2 in section 5e. So print quality is preserved.
      //
      // WATCH: masks are strict black/white with sharp edges. JPEG can
      // slightly blur those edges. If face-swap boundaries look soft in
      // testing, revert the mask to PNG (see loose ends in CURRENT_STATE).
      const stampedJpegBuffer = await sharp(stampedBufferForComfy)
        .jpeg({ quality: 88 })
        .toBuffer();

      const maskJpegBuffer = await sharp(maskBuffer)
        .jpeg({ quality: 88 })
        .toBuffer();

      const childPhotoJpegBuffer = await sharp(childPhotoBuffer)
        .jpeg({ quality: 88 })
        .toBuffer();

      logger.debug(
        {
          pageVersionId,
          stampedKb: Math.round(stampedJpegBuffer.length / 1024),
          maskKb: Math.round(maskJpegBuffer.length / 1024),
          photoKb: Math.round(childPhotoJpegBuffer.length / 1024),
        },
        "[SD Worker] Transcoded RunPod payload to JPEG"
      );

      // === 5d. CALL RUNPOD ===
      const result = await submitAndAwaitResult({
        workflow,
        images: [
          {
            name: artworkFilename,
            image: stampedJpegBuffer.toString("base64"),
          },
          { name: maskFilename, image: maskJpegBuffer.toString("base64") },
          { name: photoFilename, image: childPhotoJpegBuffer.toString("base64") },
        ],
      });

      logger.info(
        {
          pageVersionId,
          comfyJobId: result.jobId,
          delayMs: result.delayTimeMs,
          execMs: result.executionTimeMs,
        },
        "[SD Worker] RunPod returned result"
      );

      // === 5e. UPLOAD FINAL IMAGE ===
      const finalKey = `sessions/${sessionId}/final/${pageVersionId}.png`;
      await uploadFile("public", finalKey, result.imageBuffer, "image/png");
      finalImageUrl = getPublicUrl(finalKey);
      comfyJobId = result.jobId;

      displayImageUrl = await buildAndUploadDisplayImage(
        sessionId,
        pageVersionId,
        result.imageBuffer
      );
    }

    /// === 6. MARK SD_READY ===
    //
    // comfyJobId is nullable — non-face pages don't have one. Both
    // branches converge here so we only have one status write.
    //
    // errorMessage: null explicitly clears any stale error from a previous
    // failed attempt. Without this, a row that fails once and succeeds on
    // retry keeps the old error message even at SD_READY — misleading in
    // both the DB and the GET /sessions response.
    await prisma.pageVersion.update({
      where: { id: pageVersionId },
      data: {
        status: "SD_READY",
        finalImageUrl,
        displayImageUrl,
        comfyJobId,
        errorMessage: null,
      },
    });

    // === 7. NOTIFY BROWSER ===
    //
    // Both URLs go out. `imageUrl` stays the print master so the event shape
    // remains backward compatible; `displayImageUrl` is what a browser should
    // actually render, and is null when the derivative could not be built.
    emitPageReady(sessionId, {
      pageNumber: page.pageNumber,
      variantIndex: pageVersion.variantIndex,
      imageUrl: finalImageUrl,
      displayImageUrl,
      pageVersionId: pageVersion.id,
    });

    // === 8. CHECK IF THIS WAS THE LAST PREVIEW PAGE ===
    //
    // Race-safe: transaction with a status guard ensures only one worker
    // triggers the transition when the last few pages complete at nearly
    // the same time. Fires for face and non-face pages alike — a page is
    // a page as far as PREVIEW_READY counting is concerned.
    const flipped = await maybeMarkPreviewReady(
      sessionId,
      orderSession.comicId
    );

    if (flipped) {
      logger.info(
        { sessionId },
        "[SD Worker] All preview pages done — session marked PREVIEW_READY"
      );
      emitSessionPreviewReady(sessionId);
    }

    logger.info(
      {
        jobId: job.id,
        pageVersionId,
        pageNumber: page.pageNumber,
        hasFace: page.hasFace,
        finalImageUrl,
      },
      "[SD Worker] Job complete"
    );
  } catch (err) {
    // === ERROR PATH ===
    //
    // Mark FAILED with readable message, tell the browser, re-throw so
    // BullMQ can retry per its attempts:3 backoff policy.
    logger.error(
      {
        jobId: job.id,
        pageVersionId,
        attempt: job.attemptsMade + 1,
        err,
      },
      "[SD Worker] Pipeline failed"
    );

    const errorMessage = await markPageVersionFailed(pageVersionId, err);

    emitPageError(sessionId, {
      pageNumber: page.pageNumber,
      variantIndex: pageVersion.variantIndex,
      errorMessage,
    });

    throw err;
  } finally {
    // === CLEANUP ===
    //
    // Release photo cache slot ONLY if we successfully acquired it. Runs on
    // both success and failure paths — no leaked refcounts either way.
    // Non-face pages never call acquirePhoto so photoAcquired stays false
    // and this correctly skips the release.
    if (photoAcquired) {
      releasePhoto(sessionId);
    }
  }
}

export const generationWorker = new Worker<GeneratePageJobData>(
  "sd-generation",
  processJob,
  { connection: redisClient, concurrency: 5 }
);

generationWorker.on("failed", (job, err) => {
  logger.error(
    { jobId: job?.id, pageVersionId: job?.data?.pageVersionId, err },
    "[SD Worker] Job failed (final)"
  );
});
