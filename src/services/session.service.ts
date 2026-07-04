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
import { runPhotoValidation } from "./photoValidation.service.js";
import type {
  OrderSession,
  OrderSessionStatus,
} from "../generated/prisma/client.js";
import { sdGenerationQueue, hdGenerationQueue } from "../jobs/queues.js";
import {
  MAX_SD_VARIANTS_PER_PAGE,
  MAX_HD_VARIANTS_PER_PAGE,
} from "../config/generation.js";

export async function createOrderSession(input: CreateSessionInput) {
  const comic = await prisma.comic.findUnique({ where: { id: input.comicId } });

  if (!comic || comic.status !== "PUBLISHED") {
    throw new NotFoundError("Comic not found");
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return prisma.orderSession.create({
    data: {
      comicId: input.comicId,
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

  const data: Prisma.OrderSessionUpdateInput = {};
  if (input.childName !== undefined) data.childName = input.childName;
  if (input.age !== undefined) data.age = input.age;
  if (input.pronounKey !== undefined) data.pronounKey = input.pronounKey;

  return prisma.orderSession.update({
    where: { id: sessionId },
    data,
  });
}

export const getOrderSessionId = async (sessionId: string) => {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
    include: {
      pageVersions: {
        orderBy: [{ pageNumber: "asc" }, { variantIndex: "asc" }],
      },
    },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  const isExpired = session.expiresAt < new Date();

  return { ...session, isExpired };
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

  if (session.status !== "CREATED") {
    throw new ConflictError(
      "Photo upload is only allowed while the session is in CREATED status"
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

export async function validateSessionPhoto(sessionId: string, key: string) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  if (session.status !== "CREATED") {
    throw new ConflictError(
      "Photo validation is only allowed while the session is in CREATED status"
    );
  }

  const validationResult = await runPhotoValidation(sessionId, key);

  if (validationResult.passed) {
    const updatedSession = await prisma.orderSession.update({
      where: { id: sessionId },
      data: {
        rawPhotoUrls: [key],
        bestPhotoUrl: key,
        status: "PHOTO_UPLOADED",
        photoScoreJson: validationResult as unknown as Prisma.InputJsonValue,
      },
    });

    return { session: updatedSession, validation: validationResult };
  }

  const updatedSession = await prisma.orderSession.update({
    where: { id: sessionId },
    data: {
      rawPhotoUrls: [key],
      photoScoreJson: validationResult as unknown as Prisma.InputJsonValue,
    },
  });

  return { session: updatedSession, validation: validationResult };
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
  freePreviewPages: number
): Promise<number> {
  const previewPages = await prisma.page.findMany({
    where: { comicId, pageNumber: { lte: freePreviewPages } },
    orderBy: { pageNumber: "asc" },
  });

  const jobs = previewPages.map((page) => {
    sdGenerationQueue.add("generate--page", {
      orderSessionId,
      pageId: page.id,
      pageNumber: page.pageNumber,
      variantIndex: 0,
    });
  });

  await Promise.all(jobs);
  return previewPages.length;
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

  await prisma.orderSession.update({
    where: { id: sessionId },
    data: { status: "GENERATING_PREVIEW" },
  });

  const jobsEnqueued = await enqueuePreviewGenerationJobs(
    sessionId,
    session.comicId,
    session.comic.freePreviewPages
  );

  return { status: "GENERATING_PREVIEW" as const, jobsEnqueued };
}

const HD_STAGE_STATUSES: OrderSessionStatus[] = [
  "GENERATING_PAID",
  "PAID_PAGES_READY",
  "CONFIRMED",
];
const SD_STAGE_STATUSES: OrderSessionStatus[] = [
  "GENERATING_PREVIEW",
  "PREVIEW_READY",
];

export async function regeneratePage(sessionId: string, pageNumber: number) {
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new NotFoundError("OrderSession not found");
  }

  const page = await prisma.page.findUnique({
    where: { comicId_pageNumber: { comicId: session.comicId, pageNumber } },
  });

  if (!page) {
    throw new NotFoundError(`Page ${pageNumber} does not exist for this comic`);
  }

  const isHdStage = HD_STAGE_STATUSES.includes(session.status);
  const isSdStage = SD_STAGE_STATUSES.includes(session.status);

  if (!isHdStage && !isSdStage) {
    throw new ConflictError(
      `Cannot regenerate — session is not in an active generation stage (current status: ${session.status})`
    );
  }

  const existingVariantCount = await prisma.pageVersion.count({
    where: { orderSessionId: sessionId, pageId: page.id },
  });

  const cap = isHdStage ? MAX_HD_VARIANTS_PER_PAGE : MAX_SD_VARIANTS_PER_PAGE;

  if (existingVariantCount >= cap) {
    throw new ConflictError(
      `Maximum regenerations (${cap}) already reached for page ${pageNumber}`
    );
  }

  const queue = isHdStage ? hdGenerationQueue : sdGenerationQueue;

  await queue.add("generate-page", {
    orderSessionId: sessionId,
    pageId: page.id,
    pageNumber, // descriptive only — see note below
    variantIndex: existingVariantCount,
  });
  
  return {
    queued: true,
    pageNumber,
    variantIndex: existingVariantCount,
    stage: isHdStage ? "HD" : "SD",
  };
}
