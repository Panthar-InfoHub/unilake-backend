import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import { sendSuccess } from "../utils/response.js";
import { listUserOrders, getUserOrder } from "../services/order.service.js";

export const listUserOrdersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const orders = await listUserOrders(userId);

    sendSuccess(res, 200, orders);
  }
);

export const getUserOrderHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      throw new ValidationError("Order ID is required");
    }

    const userId = req.user!.id;

    const order = await getUserOrder(id, userId);

    sendSuccess(res, 200, order);
  }
);