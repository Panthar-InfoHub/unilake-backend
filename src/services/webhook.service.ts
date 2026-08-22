import { prisma } from "../lib/prisma.js";
import { verifyWebhookSignature } from "../lib/razorpay.js";
import { logger } from "../lib/logger.js";
import { enqueuePaidGenerationJobs } from "./session.service.js";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Handle an incoming Razorpay webhook.
 *
 * Flow:
 *  1. Verify signature (400 on mismatch → Razorpay stops retrying).
 *  2. Parse payload.
 *  3. Insert WebhookEvent row (unique on eventId — dedupes retries).
 *  4. On `payment.captured`: flip Order + Session to PAID, enqueue paid pages.
 *  5. On `payment.failed`: log for support, no state change.
 *  6. Everything else: log and ignore.
 *
 * Returns nothing meaningful; controller returns 200 as long as no throw.
 */

export async function handleRazorpayWebhook(
  rawBody: Buffer,
  signature: string | undefined
): Promise<void> {
  // 1. Signature check
  if (!signature) {
    throw new WebhookVerificationError("Missing x-razorpay-signature header");
  }

  const rawBodyStr = rawBody.toString("utf8");
  if (!verifyWebhookSignature(rawBodyStr, signature)) {
    throw new WebhookVerificationError("Invalid webhook signature");
  }

  // 2. Parse
  let payload: any;
  try {
    payload = JSON.parse(rawBodyStr);
  } catch {
    throw new WebhookVerificationError("Malformed webhook payload");
  }

  const eventType: string = payload.event;
  const paymentEntity = payload.payload?.payment?.entity;
  const eventId: string | undefined =
    paymentEntity?.id ?? payload.payload?.order?.entity?.id;

  if (!eventId) {
    logger.warn(
      { eventType },
      "Razorpay webhook missing eventId — cannot dedupe, ignoring"
    );
    return;
  }

  const razorpayOrderId: string | undefined = paymentEntity?.order_id;

  // 3. Idempotency — insert WebhookEvent; P2002 = duplicate = already processed
  try {
    await prisma.webhookEvent.create({
      data: {
        source: "razorpay",
        eventId,
        eventType,
        payloadJson: payload,
        orderId: null, // filled in below if we can resolve it
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      logger.info(
        { eventId, eventType },
        "Duplicate Razorpay webhook — already processed, skipping"
      );
      return;
    }
    throw error;
  }

  // 4. Dispatch by event type
  switch (eventType) {
    case "payment.captured":
      await handlePaymentCaptured(razorpayOrderId, paymentEntity?.id, eventId);
      break;

    case "payment.failed":
      logger.warn(
        {
          razorpayOrderId,
          razorpayPaymentId: paymentEntity?.id,
          errorCode: paymentEntity?.error_code,
          errorDescription: paymentEntity?.error_description,
        },
        "Razorpay payment failed — no state change, user can retry"
      );
      break;

    default:
      logger.info({ eventType, eventId }, "Razorpay webhook event ignored");
  }
}

async function handlePaymentCaptured(
  razorpayOrderId: string | undefined,
  razorpayPaymentId: string | undefined,
  eventId: string
): Promise<void> {
  if (!razorpayOrderId || !razorpayPaymentId) {
    logger.error(
      { eventId, razorpayOrderId, razorpayPaymentId },
      "payment.captured missing order_id or payment id — cannot process"
    );
    return;
  }

  // Look up our Order by the Razorpay order id
  const order = await prisma.order.findUnique({
    where: { razorpayOrderId },
    include: { orderSession: true },
  });

  if (!order) {
    logger.error(
      { razorpayOrderId, razorpayPaymentId },
      "payment.captured: no local Order found for Razorpay order — orphan payment, admin follow-up needed"
    );
    return;
  }

  // Idempotency at the state level — if Order is already past CREATED,
  // this webhook is a redelivery we've already handled at business level.
  const enqueueAlreadySucceeded =
    order.orderSession.status !== "PAID" &&
    order.orderSession.status !== "AWAITING_PAYMENT";

  if (order.status !== "CREATED" && enqueueAlreadySucceeded) {
    logger.info(
      { orderId: order.id, currentStatus: order.status, sessionStatus: order.orderSession.status },
      "payment.captured on already-processed order — skipping"
    );
    return;
  }

  // Backfill the WebhookEvent.orderId now that we resolved the order
  await prisma.webhookEvent
    .update({
      where: { eventId },
      data: { orderId: order.id },
    })
    .catch(() => {
      // Non-fatal — the event row exists, just missing the FK backfill
    });

  // Flip Order + Session in a transaction. Enqueue OUTSIDE.
  await prisma.$transaction(async (tx) => {
    await tx.order.updateMany({
      where: { id: order.id, status: "CREATED" },
      data: {
        status: "PAID",
        razorpayPaymentId,
      },
    });

    await tx.orderSession.updateMany({
      where: { id: order.orderSessionId, status: "AWAITING_PAYMENT" },
      data: { status: "PAID" },
    });
  });

  logger.info(
    {
      orderId: order.id,
      sessionId: order.orderSessionId,
      razorpayPaymentId,
    },
    "Payment captured — Order + Session flipped to PAID"
  );

  // Enqueue paid-page generation OUTSIDE the transaction.
  // Never enqueue inside $transaction (Redis doesn't roll back with Prisma).
    const jobsEnqueued = await enqueuePaidGenerationJobs(
    order.orderSessionId,
    order.orderSession.comicId,
    order.orderSession.createdAt
  ).catch(async (error) => {
    await prisma.webhookEvent
      .delete({ where: { eventId } })
      .catch(() => {
        // If cleanup itself fails, log and press on with the re-throw.
        // Ops will see the stuck row and can clear it manually.
        logger.error(
          { eventId, orderId: order.id },
          "Failed to clean up WebhookEvent row after enqueue failure"
        );
      });

    logger.error(
      { orderId: order.id, error },
      "Paid-page enqueue failed — re-throwing so Razorpay retries the webhook"
    );
    throw error;
  });

  // Flip session to GENERATING_PAID once jobs are in Redis
  await prisma.orderSession.updateMany({
    where: { id: order.orderSessionId, status: "PAID" },
    data: { status: "GENERATING_PAID" },
  });

  logger.info(
    { orderId: order.id, jobsEnqueued },
    "Paid-page generation enqueued after payment"
  );
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

