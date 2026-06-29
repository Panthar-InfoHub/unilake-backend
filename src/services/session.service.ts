import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import type { CreateSessionInput, UpdateSessionInput } from "../validators/session.schema.js";
import { Prisma } from '../generated/prisma/client.js';
import { getSignedUploadUrl } from "../lib/r2.js";
import { runPhotoValidation } from "./photoValidation.service.js";

export async function createOrderSession(input: CreateSessionInput) {
  const comic = await prisma.comic.findUnique({ where: { id: input.comicId } });

  if (!comic || comic.status !== 'PUBLISHED') {
    throw new NotFoundError('Comic not found');
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return prisma.orderSession.create({
    data: {
      comicId: input.comicId,
      expiresAt,
    },
  });
}

export async function updateOrderSession(sessionId: string, input: UpdateSessionInput) {
  const session = await prisma.orderSession.findUnique({ where: { id: sessionId } });

  if (!session) {
    throw new NotFoundError('OrderSession not found');
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

export const getOrderSessionId = async (sessionId : string) => {
    const session = await prisma.orderSession.findUnique({
        where : { id : sessionId},
        include: {
            pageVersions: {
                orderBy : [
                    {pageNumber:'asc'},
                    { variantIndex: 'asc'}
                ],
            },
        },
    });

    if(!session) {
        throw new NotFoundError('OrderSession not found')
    }

    const isExpired  = session.expiresAt < new Date();

    return { ...session, isExpired };
}

const EXTENSION_TO_CONTENT_TYPE: Record<'jpg' | 'jpeg' | 'png' | 'webp', string>  = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const PHOTO_UPLOAD_EXPIRY_SECONDS = 5 * 60; // 5 minutes — plenty of time for a direct browser upload

export async function createPhotoUploadUrl(sessionId: string, fileExtension: 'jpg' | 'jpeg' | 'png' | 'webp') {
  const session = await prisma.orderSession.findUnique({ where: { id: sessionId } });

  if (!session) {
    throw new NotFoundError('OrderSession not found');
  }

  if (session.status !== 'CREATED') {
    throw new ConflictError('Photo upload is only allowed while the session is in CREATED status');
  }

  const key = `sessions/${sessionId}/photo-${Date.now()}.${fileExtension}`;
  const contentType = EXTENSION_TO_CONTENT_TYPE[fileExtension];

  const uploadUrl = await getSignedUploadUrl(
    'private',
    key,
    contentType,
    PHOTO_UPLOAD_EXPIRY_SECONDS
  );

  return { uploadUrl, key };
}


export async function validateSessionPhoto(sessionId: string, key: string) {
  const session = await prisma.orderSession.findUnique({ where: { id: sessionId } });

  if (!session) {
    throw new NotFoundError('OrderSession not found');
  }

  if (session.status !== 'CREATED') {
    throw new ConflictError('Photo validation is only allowed while the session is in CREATED status');
  }

  const validationResult = await runPhotoValidation(key);

  const updatedSession = await prisma.orderSession.update({
    where: { id: sessionId },
    data: {
      rawPhotoUrls: [key],
      status: 'PHOTO_UPLOADED',
      photoScoreJson: validationResult as unknown as Prisma.InputJsonValue,
    },
  });

  return { session: updatedSession, validation: validationResult };
}
