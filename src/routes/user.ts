import { Router } from "express";
import { validateBody } from "../middlewares/validateBody.js";
import {
  createAddressSchema,
  updateAddressSchema,
} from "../validators/savedAddress.schema.js";
import {
  listAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
  setDefaultAddressHandler,
} from "../controllers/savedAddress.controller.js";

const router = Router();

// Saved addresses
router.get("/addresses", listAddressesHandler);
router.post("/addresses", validateBody(createAddressSchema), createAddressHandler);
router.patch("/addresses/:id", validateBody(updateAddressSchema), updateAddressHandler);
router.delete("/addresses/:id", deleteAddressHandler);
router.post("/addresses/:id/set-default", setDefaultAddressHandler);

export default router;