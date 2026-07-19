import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ValidationError } from "../utils/errors.js";
import {
  listUserAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "../services/savedAddress.service.js";

export const listAddressesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const addresses = await listUserAddresses(userId);

    res.status(200).json({
      success: true,
      data: addresses,
    });
  }
);

export const createAddressHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const address = await createAddress(userId, req.body);

    res.status(201).json({
      success: true,
      message: "Address saved successfully",
      data: address,
    });
  }
);

export const updateAddressHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      throw new ValidationError("Address ID is required");
    }

    const userId = req.user!.id;

    const address = await updateAddress(id, userId, req.body);

    res.status(200).json({
      success: true,
      data: address,
    });
  }
);

export const deleteAddressHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      throw new ValidationError("Address ID is required");
    }

    const userId = req.user!.id;

    await deleteAddress(id, userId);

    res.status(204).send();
  }
);

export const setDefaultAddressHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      throw new ValidationError("Address ID is required");
    }

    const userId = req.user!.id;

    const address = await setDefaultAddress(id, userId);

    res.status(200).json({
      success: true,
      message: "Default address updated",
      data: address,
    });
  }
);