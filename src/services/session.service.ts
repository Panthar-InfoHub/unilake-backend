import { prisma } from "../lib/prisma.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import type {
  CreateSessionInput,
  UpdateSessionInput,
} from "../validators/session.schema.js";
import { Prisma } from "../generated/prisma/client.js";
import { getSignedUploadUrl } from "../lib/r2.js";
import type {
  OrderSession,
  OrderSessionStatus,
} from "../generated/prisma/client.js";
import { sdGenerationQueue } from "../jobs/queues.js";
import {
  MAX_VARIANTS_BEFORE_PAYMENT,
  MAX_VARIANTS_AFTER_PAYMENT,
} from "../config/generation.js";

function computeJobPriority(
  sessionCreatedAt: Date,
  pageNumber: number
): number {
  const sessionSecondsInDay =
    Math.floor(sessionCreatedAt.getTime() / 1000) % 86_400;
  return sessionSecondsInDay + pageNumber * 80_000;
}
/** Throws if the session is past expiresAt; also flips it to FAILED so future reads are clean. Audit 11.1. */
async function assertNotExpired(session: {
  id: string;
  expiresAt: Date;
  status: OrderSessionStatus;
}): Promise<void> {
  if (session.expiresAt >= new Date()) return;

  // Already terminal — don't rewrite the row, just refuse the mutation.
  const TERMINAL_STATUSES: OrderSessionStatus[] = ["FAILED", "COMPLETED"];
  if (TERMINAL_STATUSES.includes(session.status)) {
    throw new ConflictError("This session has expired.");
  }

 // Atomic flip via updateMany + status guard — safe against concurrent callers.
  await prisma.orderSession.updateMany({
    where: {
      id: session.id,
      status: { notIn: TERMINAL_STATUSES },
    },
    data: { status: "FAILED" },
  });

  logger.warn(
    { sessionId: session.id, expiredAt: session.expiresAt },
    "Session expired on mutation attempt — flipped to FAILED"
  );

  throw new ConflictError("This session has expired.");
}

/** Hourly sweeper — flips every non-terminal expired session to FAILED. R2 cleanup is not done here (out of scope). */
export async function sweepExpiredSessions(): Promise<number> {
  const { count } = await prisma.orderSession.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      status: { notIn: ["FAILED", "COMPLETED"] },
    },
    data: { status: "FAILED" },
  });

  if (count > 0) {
    logger.info({ expiredCount: count }, "[Expiry Sweeper] Flipped expired sessions to FAILED");
  }

  return count;
}
export async function createOrderSession(
  input: CreateSessionInput,
  userId?: string
) {
  const comic = await prisma.comic.findUnique({ where: { id: input.comicId } });

  if (!comic || comic.status !== "PUBLISHED") {
    throw new NotFoundError("Comic not found");
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return prisma.orderSession.create({
    data: {
      comicId: input.comicId,
      userId: userId ?? null,
      expiresAt,
    },
  });
}

export async function updateOrderSession(
  sessionId: string,
  input: UpdateSessionInput
) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  await assertNotExpired(session);

  const data: Prisma.OrderSessionUpdateInput = {};
  if (input.childName !== undefined) data.childName = input.childName;
  if (input.age !== undefined) data.age = input.age;
  if (input.pronounKey !== undefined) data.pronounKey = input.pronounKey;
  if (input.notificationEmail !== undefined)
    data.notificationEmail = input.notificationEmail;
  if (input.coverType !== undefined) data.coverType = input.coverType;
  if (input.shippingName !== undefined) data.shippingName = input.shippingName;
  if (input.shippingLine1 !== undefined)
    data.shippingLine1 = input.shippingLine1;
  if (input.shippingLine2 !== undefined)
    data.shippingLine2 = input.shippingLine2;
  if (input.shippingCity !== undefined) data.shippingCity = input.shippingCity;
  if (input.shippingState !== undefined)
    data.shippingState = input.shippingState;
  if (input.shippingZip !== undefined) data.shippingZip = input.shippingZip;
  if (input.shippingCountry !== undefined)
    data.shippingCountry = input.shippingCountry;
  if (input.shippingPhone !== undefined)
    data.shippingPhone = input.shippingPhone;

  return prisma.orderSession.update({
    where: { id: sessionId },
    data,
  });
}

export const getOrderSessionId = async (sessionId: string) => {
  // Fetch the session itself (with comic metadata we'll need)
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
    include: {
      comic: {
        select: {
          id: true,
          title: true,
          freePreviewPages: true,
          coverThumbnailUrls: true,
        },
      },
    },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  // Fetch all pages of the comic (not just preview ones). Frontend needs
  // the full book structure to render locked pages with a paywall overlay.
  const allPages = await prisma.page.findMany({
    where: { comicId: session.comicId },
    orderBy: { pageNumber: "asc" },
    select: {
      id: true,
      pageNumber: true,
      isPreviewPage: true,
      hasFace: true,
    },
  });

  // Fetch every PageVersion for this session — includes all variants of
  // all pages that have been generated (or attempted) so far.
  const pageVersions = await prisma.pageVersion.findMany({
    where: { orderSessionId: sessionId },
    orderBy: { variantIndex: "asc" },
    select: {
      id: true,
      pageId: true,
      variantIndex: true,
      status: true,
      finalImageUrl: true,
      displayImageUrl: true,
      isSelected: true,
      errorMessage: true,
    },
  });

  // Group PageVersions by pageId so we can nest them under each page below.
  // Map<pageId, PageVersion[]>. Constructing this once is O(n); doing
  // .filter() per page below would be O(n²).
  const versionsByPageId = new Map<string, typeof pageVersions>();
  for (const pv of pageVersions) {
    const existing = versionsByPageId.get(pv.pageId);
    if (existing) {
      existing.push(pv);
    } else {
      versionsByPageId.set(pv.pageId, [pv]);
    }
  }

  // Shape each page with its variants nested underneath.
  const pages = allPages.map((page) => {
    const variants = (versionsByPageId.get(page.id) ?? []).map((pv) => ({
      pageVersionId: pv.id,
      variantIndex: pv.variantIndex,
      status: pv.status,
      // finalImageUrl is the print master (multi-MB PNG); displayImageUrl is the
      // web derivative and is what clients should render. Null on rows generated
      // before the derivative existed, or where building it failed — fall back
      // to finalImageUrl in that case.
      finalImageUrl: pv.finalImageUrl,
      displayImageUrl: pv.displayImageUrl,
      isSelected: pv.isSelected,
      errorMessage: pv.errorMessage,
    }));

    return {
      pageId: page.id,
      pageNumber: page.pageNumber,
      isPreviewPage: page.isPreviewPage,
      hasFace: page.hasFace,
      variants,
    };
  });

  const isExpired = session.expiresAt < new Date();

  return {
    id: session.id,
    comicId: session.comicId,
    userId: session.userId,
    childName: session.childName,
    pronounKey: session.pronounKey,
    age: session.age,
    notificationEmail: session.notificationEmail,
    coverType: session.coverType,
    status: session.status,
    bestPhotoUrl: session.bestPhotoUrl,
    shippingName: session.shippingName,
    shippingLine1: session.shippingLine1,
    shippingLine2: session.shippingLine2,
    shippingCity: session.shippingCity,
    shippingState: session.shippingState,
    shippingZip: session.shippingZip,
    shippingCountry: session.shippingCountry,
    shippingPhone: session.shippingPhone,
    wsRoomToken: session.wsRoomToken,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
    isExpired,
    comic: session.comic,
    pages,
  };
};

const EXTENSION_TO_CONTENT_TYPE: Record<
  "jpg" | "jpeg" | "png" | "webp",
  string
> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const PHOTO_UPLOAD_EXPIRY_SECONDS = 5 * 60; // 5 minutes — plenty of time for a direct browser upload

// Both photo endpoints gate on this same list: CREATED is the first upload,
// PHOTO_UPLOADED is the user swapping in a better photo before generation
// starts. Kept as ONE constant precisely because the two halves drifted apart
// once — confirm was widened to allow re-uploads while upload-url stayed at
// CREATED only, which made re-upload unreachable from the frontend.
const PHOTO_MUTABLE_STATUSES: OrderSessionStatus[] = [
  "CREATED",
  "PHOTO_UPLOADED",
];

export async function createPhotoUploadUrl(
  sessionId: string,
  fileExtension: "jpg" | "jpeg" | "png" | "webp"
) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  await assertNotExpired(session);

  if (!PHOTO_MUTABLE_STATUSES.includes(session.status)) {
    throw new ConflictError(
      `Photo upload is only allowed before generation starts. Current status: ${session.status}`
    );
  }

  const key = `sessions/${sessionId}/photo-${Date.now()}.${fileExtension}`;
  const contentType = EXTENSION_TO_CONTENT_TYPE[fileExtension];

  const uploadUrl = await getSignedUploadUrl(
    "private",
    key,
    contentType,
    PHOTO_UPLOAD_EXPIRY_SECONDS
  );

  return { uploadUrl, key };
}

export async function confirmSessionPhoto(sessionId: string, key: string) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  await assertNotExpired(session);

  if (!PHOTO_MUTABLE_STATUSES.includes(session.status)) {
    throw new ConflictError(
      `Photo confirm is only allowed before generation starts. Current status: ${session.status}`
    );
  }
  // Audit 8.2 — key ownership check. Rejects keys from other sessions'
  // folders (or malformed paths) before writing to the DB.
  const expectedPrefix = `sessions/${sessionId}/`;
  if (!key.startsWith(expectedPrefix)) {
    logger.warn(
      { sessionId, key },
      "confirmSessionPhoto: rejected key from outside this session's folder"
    );
    throw new ValidationError(
      "The provided key does not belong to this session."
    );
  }

  const updatedSession = await prisma.orderSession.update({
    where: { id: sessionId },
    data: {
      rawPhotoUrls: [key],
      bestPhotoUrl: key,
      status: "PHOTO_UPLOADED",
    },
  });

  return { session: updatedSession };
}

interface CompletenessResult {
  isComplete: boolean;
  missingFields: string[];
}

function isSessionCompleteForGeneration(
  session: OrderSession
): CompletenessResult {
  const missingFields: string[] = [];

  if (session.childName === null) missingFields.push("childName");
  if (session.age === null) missingFields.push("age");
  if (session.pronounKey === null) missingFields.push("pronounKey");
  if (session.bestPhotoUrl === null) missingFields.push("photo");

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}

async function enqueuePreviewGenerationJobs(
  orderSessionId: string,
  comicId: string,
  freePreviewPages: number,
  sessionCreatedAt: Date
): Promise<number> {
  // STEP 1: Find the pages that are explicitly marked as preview pages.
  //
  // `isPreviewPage` is the source of truth — the admin picks WHICH pages
  // are free (could be any subset, not necessarily the first N). The
  // `freePreviewPages` counter on Comic is just metadata; we use it below
  // only as a sanity check for data-integrity drift.
  const previewPages = await prisma.page.findMany({
    where: { comicId, isPreviewPage: true },
    orderBy: { pageNumber: "asc" },
  });

  if (previewPages.length === 0) {
    logger.warn(
      { orderSessionId, comicId },
      "enqueuePreviewGenerationJobs: comic has no preview pages"
    );
    return 0;
  }

  // Sanity check: the counter on Comic should match the number of pages
  // flagged as preview. Frontend enforces this on publish, but a manual
  // DB edit could break it. Log-only, don't fail — the truth is `isPreviewPage`.
  if (previewPages.length !== freePreviewPages) {
    logger.warn(
      {
        orderSessionId,
        comicId,
        expected: freePreviewPages,
        actual: previewPages.length,
      },
      "enqueuePreviewGenerationJobs: Comic.freePreviewPages counter does not match the number of pages with isPreviewPage=true"
    );
  }

  // Step 2: Recover any rows left behind by a previous failed attempt.
  //
  // Rows are committed to Postgres BEFORE anything is written to Redis, so a
  // Redis outage leaves QUEUED rows with no job to ever pick them up. Those
  // rows occupy @@unique([orderSessionId, pageId, variantIndex]), so blindly
  // creating fresh ones on retry throws P2002 and the session can never
  // recover. Reuse what already exists; create only what is missing.
  const existingRows = await prisma.pageVersion.findMany({
    where: {
      orderSessionId,
      variantIndex: 0,
      pageId: { in: previewPages.map((page) => page.id) },
    },
  });

  const existingPageIds = new Set(existingRows.map((row) => row.pageId));
  const pagesNeedingRows = previewPages.filter(
    (page) => !existingPageIds.has(page.id)
  );

  if (existingRows.length > 0) {
    logger.info(
      {
        orderSessionId,
        reused: existingRows.length,
        created: pagesNeedingRows.length,
      },
      "enqueuePreviewGenerationJobs: reusing PageVersion rows from a prior failed attempt"
    );
  }

  // Step 3: Create the missing rows atomically.
  // If any INSERT fails, none of them persist — user retries cleanly.
  const createdRows =
    pagesNeedingRows.length > 0
      ? await prisma.$transaction(
          pagesNeedingRows.map((page) =>
            prisma.pageVersion.create({
              data: {
                orderSessionId,
                pageId: page.id,
                variantIndex: 0,
                status: "QUEUED",
              },
            })
          )
        )
      : [];

  // Step 4: Work out which rows actually need a job.
  //
  // A reused row that already reached SD_READY is finished — re-queueing it
  // would only make the worker re-emit page:ready for no reason. Everything
  // else (QUEUED orphans, FAILED rows, rows stranded mid-pipeline) gets reset
  // to QUEUED so the DB reflects that they are waiting again.
  const rowsToEnqueue = [...existingRows, ...createdRows].filter(
    (row) => row.status !== "SD_READY"
  );

  const staleRowIds = existingRows
    .filter((row) => row.status !== "SD_READY" && row.status !== "QUEUED")
    .map((row) => row.id);

  if (staleRowIds.length > 0) {
    await prisma.pageVersion.updateMany({
      where: { id: { in: staleRowIds } },
      data: { status: "QUEUED", errorMessage: null },
    });
  }

  // Step 5: Enqueue BullMQ jobs — one per row, with priority.
  // Runs AFTER all DB writes commit, so a Redis failure here can't
  // orphan the DB rows in an inconsistent state.
  //
  // Pairing is by pageId lookup rather than array index: existing and created
  // rows come from two different queries, so positional pairing against
  // previewPages would silently attach the wrong priority to the wrong page.
  const pageById = new Map(previewPages.map((page) => [page.id, page]));

  const enqueuePromises = rowsToEnqueue.map((row) => {
    const page = pageById.get(row.pageId)!;
    const priority = computeJobPriority(sessionCreatedAt, page.pageNumber);

    return sdGenerationQueue.add(
      "generate-page",
      { pageVersionId: row.id },
      { priority }
    );
  });

  await Promise.all(enqueuePromises);

  logger.info(
    { orderSessionId, jobCount: rowsToEnqueue.length },
    "Preview generation jobs enqueued"
  );

  return rowsToEnqueue.length;
}

const GENERATABLE_STATUSES: OrderSessionStatus[] = [
  "CREATED",
  "PHOTO_UPLOADED",
];

export async function triggerGeneration(sessionId: string) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
    include: { comic: true },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  await assertNotExpired(session)

  if (!GENERATABLE_STATUSES.includes(session.status)) {
    throw new ConflictError(
      `Cannot trigger generation — session status is already '${session.status}'`
    );
  }

  const { isComplete, missingFields } = isSessionCompleteForGeneration(session);

  if (!isComplete) {
    throw new ValidationError(
      `Session is missing required fields: ${missingFields.join(", ")}`
    );
  }

  const jobsEnqueued = await enqueuePreviewGenerationJobs(
    sessionId,
    session.comicId,
    session.comic.freePreviewPages,
    session.createdAt
  );

  await prisma.orderSession.update({
    where: { id: sessionId },
    data: { status: "GENERATING_PREVIEW" },
  });

  return { status: "GENERATING_PREVIEW" as const, jobsEnqueued };
}

const REGENERATABLE_STATUSES: OrderSessionStatus[] = [
  "GENERATING_PREVIEW",
  "PREVIEW_READY",
  "GENERATING_PAID",
  "PAID_PAGES_READY",
  "FAILED",
];
const POST_PAYMENT_STATUSES: OrderSessionStatus[] = [
  "PAID",
  "GENERATING_PAID",
  "PAID_PAGES_READY",
  "CONFIRMED",
];

export async function regeneratePage(sessionId: string, pageNumber: number) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  await assertNotExpired(session);

  const page = await prisma.page.findUnique({
    where: { comicId_pageNumber: { comicId: session.comicId, pageNumber } },
  });

  if (!page) {
    throw new NotFoundError(`Page ${pageNumber} does not exist for this comic`);
  }

  if (!REGENERATABLE_STATUSES.includes(session.status)) {
    throw new ConflictError(
      `Cannot regenerate — session is not in an active generation stage (current status: ${session.status})`
    );
  }

  const hasPaid = POST_PAYMENT_STATUSES.includes(session.status);
  const cap = hasPaid
    ? MAX_VARIANTS_AFTER_PAYMENT
    : MAX_VARIANTS_BEFORE_PAYMENT;

  // Count + cap check + row creation all in one transaction.
  // Prevents variantIndex races if the user double-clicks regenerate.

  const newRow = await prisma.$transaction(async (tx) => {
    const existingVariantCount = await tx.pageVersion.count({
      where: { orderSessionId: sessionId, pageId: page.id },
    });

    if (existingVariantCount >= cap) {
      throw new ConflictError(
        `Maximum regenerations (${cap}) already reached for page ${pageNumber}`
      );
    }

    return tx.pageVersion.create({
      data: {
        orderSessionId: sessionId,
        pageId: page.id,
        variantIndex: existingVariantCount,
        status: "QUEUED",
      },
    });
  });

  // A FAILED session is regeneratable, but maybeMarkPreviewComplete only flips
  // sessions that are currently GENERATING_PREVIEW. Without moving the session
  // back first, a successful regeneration would write SD_READY on the page and
  // leave the session stuck at FAILED forever.
  //
  // This runs BEFORE the enqueue on purpose: the worker has concurrency 5 and
  // picks jobs up immediately, so flipping afterwards would race a fast page
  // finishing, no-opping the guard, and stranding the session the other way.
  //
  // updateMany + status guard makes concurrent regenerations safe — the second
  // one matches zero rows and no-ops. No rollback if the enqueue below throws:
  // GENERATING_PREVIEW is itself regeneratable, so the user retrying re-enters
  // the normal path, and a rollback would race a sibling regeneration that did
  // enqueue successfully.
  if (session.status === "FAILED") {
    const { count } = await prisma.orderSession.updateMany({
      where: { id: sessionId, status: "FAILED" },
      data: { status: "GENERATING_PREVIEW" },
    });

    if (count > 0) {
      logger.info(
        { sessionId, pageNumber },
        "Session moved FAILED → GENERATING_PREVIEW to accept a regeneration"
      );
    }
  }

  const priority = computeJobPriority(session.createdAt, page.pageNumber);

  await sdGenerationQueue.add(
    "generate-page",
    { pageVersionId: newRow.id },
    { priority }
  );

  logger.info(
    { sessionId, pageNumber, variantIndex: newRow.variantIndex },
    "Page regeneration job enqueued"
  );

  return {
    queued: true,
    pageNumber,
    variantIndex: newRow.variantIndex,
    hasPaid,
  };
}

export async function attachUserToSession(sessionId: string, userId: string) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  await assertNotExpired(session)

  if (session.userId === userId) {
    return session;
  }

  if (session.userId !== null) {
    throw new ConflictError("Session already belongs to another user");
  }

  return prisma.orderSession.update({
    where: { id: sessionId },
    data: { userId },
  });
}
