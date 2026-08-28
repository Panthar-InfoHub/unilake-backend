import { Router } from "express";
import { razorpayWebhookHandler, shiprocketWebhookHandler, } from "../controllers/webhook.controller.js";

const router = Router();

router.post("/razorpay", razorpayWebhookHandler);
router.post("/shiprocket", shiprocketWebhookHandler);

export default router;