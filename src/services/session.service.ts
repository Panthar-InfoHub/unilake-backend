import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import type { CreateSessionInput } from "../validators/session.schema.js";

export const createOrderSession = async (input: CreateSessionInput) => {
  try {
    logger.info({ comicId: input.comicId }, "Initiating new order session...");

    const comic = await prisma.comic.findUnique({
      where: { id: input.comicId },
      select: { id: true, status: true },
    });

    if (!comic || comic.status !== "PUBLISHED") {
      throw new NotFoundError("Comic not found");
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const newSession = await prisma.orderSession.create({
      data: {
        comicId: input.comicId,
        childName: input.childName,
        age: input.age,
        pronounKey: input.pronounKey,
        expiresAt,
      },
    });

    logger.info({ sessionId: newSession.id }, "Order session created successfully");

    return newSession;
  } catch (error: any) {
    logger.error({ err: error, input }, "Failed to create order session");

    throw error;
  }
};

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
