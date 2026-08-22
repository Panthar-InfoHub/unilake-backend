import { Router } from "express";
import { razorpayWebhookHandler } from "../controllers/webhook.controller.js";

const router = Router();

router.post("/razorpay", razorpayWebhookHandler);

export default router;