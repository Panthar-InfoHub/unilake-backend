import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import { Prisma } from "../generated/prisma/client.js";
import type { CreateBubbleInput } from "../validators/bubble.schema.js";

export async function createBubble(pageId: string, input: CreateBubbleInput) {
  const page = await prisma.page.findUnique({ where: { id: pageId } });

  if (!page) {
    throw new NotFoundError("Page not found");
  }

  const data: Prisma.BubbleCreateInput = {
    page: { connect: { id: pageId } },
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    dialogue: input.dialogue,
    fontSize: input.fontSize,
    sortOrder: input.sortOrder,
  };

  if (input.fontId !== undefined) {
    data.font = { connect: { id: input.fontId } };
  }

  const bubble = await prisma.bubble.create({ data });

  logger.info(
    { pageId, bubbleId: bubble.id },
    "Bubble created successfully"
  );

  return bubble;
}