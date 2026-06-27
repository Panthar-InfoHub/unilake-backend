import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createOrderSession, getOrderSessionId } from "../services/session.service.js";
import { ValidationError } from "../utils/errors.js";


export const createSessionHandler = asyncHandler(async(req: Request, res: Response) => {

    const session = await createOrderSession(req.body);

    res.status(201).json(session)
})

export const getSessionHandler = asyncHandler(async (req: Request, res : Response) => {
    const {sessionId } = req.params;

    if(!sessionId || typeof sessionId !== 'string' ) {
        throw new ValidationError('sessionId param is requried');
    }

    const session = await getOrderSessionId(sessionId);

    res.status(200).json(session)
})