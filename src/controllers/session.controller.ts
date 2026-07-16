import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  createOrderSession,
  createPhotoUploadUrl,
  getOrderSessionId,
  updateOrderSession,
  validateSessionPhoto,
  triggerGeneration,
  regeneratePage,
  attachUserToSession,
} from "../services/session.service.js";
import { regeneratePageParamsSchema } from "../validators/regenerate.schema.js";
import { ValidationError } from "../utils/errors.js";
import { generateSessionParamsSchema } from "../validators/generate.schema.js";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";

export const createSessionHandler = asyncHandler(
  async (req: Request, res: Response) => {
    let userId: string | undefined;
    try {
      const sessionData = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (sessionData?.user) {
        userId = sessionData.user.id;
      }
    } catch {
      // No valid session — that's fine, session stays anonymous
    }
    const session = await createOrderSession(req.body, userId);

    res.status(201).json(session);
  }
);

export const updateSessionHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || typeof sessionId !== "string") {
    throw new ValidationError("sessionId param is required");
  }

  const session = await updateOrderSession(sessionId, req.body);

  res.status(200).json(session);
});

export const getSessionHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    if (!sessionId || typeof sessionId !== "string") {
      throw new ValidationError("sessionId param is requried");
    }

    const session = await getOrderSessionId(sessionId);

    res.status(200).json(session);
  }
);

export const createPhotoUploadUrlHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || typeof sessionId !== "string") {
    throw new ValidationError("sessionId param is required");
  }

  const { fileExtension } = req.body;
  const result = await createPhotoUploadUrl(sessionId, fileExtension);

  res.status(200).json(result);
});

export const validateSessionPhotoHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId || typeof sessionId !== "string") {
    throw new ValidationError("sessionId param is required");
  }

  const { key } = req.body;
  const result = await validateSessionPhoto(sessionId, key);

  res.status(200).json(result);
});

export const generateSessionHandler = asyncHandler(async (req, res) => {
  const { sessionId } = generateSessionParamsSchema.parse({
    sessionId: req.params.sessionId,
  });

  const result = await triggerGeneration(sessionId);

  res.status(200).json(result);
});

export const regeneratePageHandler = asyncHandler(async (req, res) => {
  const { sessionId, pageNumber } = regeneratePageParamsSchema.parse({
    sessionId: req.params.sessionId,
    pageNumber: req.params.pageNumber,
  });

  const result = await regeneratePage(sessionId, pageNumber);

  res.status(200).json(result);
});

export const attachUserHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!sessionId || typeof sessionId !== "string") {
      throw new ValidationError("sessionId param is required");
    }

    const userId = req.user!.id;

    const session = await attachUserToSession(sessionId, userId);

    res.status(200).json(session);
  }
);
