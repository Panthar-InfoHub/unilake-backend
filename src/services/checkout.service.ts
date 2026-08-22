import { prisma } from "../lib/prisma.js";
import { razorpay, toSmallestUnit } from "../lib/razorpay.js";
import { logger } from "../lib/logger.js";
import { config } from "../config/env.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import type { OrderSession } from "../generated/prisma/client.js";
import { assertNotExpired } from "./session.service.js";

function assertShippingComplete(session: OrderSession): void {
  const required: (keyof OrderSession)[] = [
    "shippingName",
    "shippingLine1",
    "shippingCity",
    "shippingState",
    "shippingZip",
    "shippingCountry",
    "shippingPhone",
  ];

  const missing = required.filter((field) => !session[field]);
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required shipping fields: ${missing.join(", ")}`
    );
  }
}

/**
 * Initiate checkout for a session.
 *
 * Flow:
 *   1. Fetch session (+ its Order, if any); assert it exists and is not expired.
 *   2. Idempotency FIRST: if an Order already exists for this session:
 *        - status CREATED: reuse it, return the existing Razorpay order id.
 *        - any other status: 409 (already paid, or past checkout).
 *   3. Status guard — must be PREVIEW_READY.
 *   4. Must have userId attached.
 *   5. Must have coverType.
 *   6. Must have all shipping fields.
 *   7. Look up Country by ISO code -> countryId + currency.
 *   8. Look up PricingRule(comicId, countryId, coverType) -> price.
 *   9. Create Razorpay order (external API, OUTSIDE transaction).
 *  10. Create Order row + flip session to AWAITING_PAYMENT (transaction).
 *      Then return the payload the frontend needs to open the Razorpay modal.
 *
 * Steps 3-6 are only reachable on a fresh checkout, because step 2 returns or
 * throws whenever an Order row exists.
 *
 * Step 2 MUST stay above step 3. This function itself flips the session
 * PREVIEW_READY -> AWAITING_PAYMENT, so on any second call the status guard
 * rejects first. With the guard first the reuse branch was unreachable, and a
 * user who closed the Razorpay modal was stranded at AWAITING_PAYMENT holding
 * an unpaid CREATED order with no way to retry.
 */

export async function initiateCheckout(sessionId: string) {
  // 1. Fetch session
  const session = await prisma.orderSession.findUnique({
    where: { id: sessionId },
    include: {
      order: true, // may or may not exist
      comic: { select: { id: true, title: true } },
    },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  await assertNotExpired(session);

  // 2. Idempotency: existing order?
  //
  // Deliberately ABOVE the status guard — see the flow note on this function.
  // The Order row is the authoritative record that checkout already happened,
  // so it is the strongest signal available and we return on it early. The
  // guards below then only run on a genuinely fresh checkout, which makes the
  // invariant explicit: no Order row => the session must still be PREVIEW_READY.
  //
  // The field guards (userId / coverType / shipping) are intentionally NOT
  // re-run on this path. They were validated when the order was created, and
  // updateOrderSession's post-payment lock has frozen those fields ever since,
  // so a resume is effectively a pure read.
  if (session.order) {
    if (session.order.status === "CREATED") {
      // Nullable in the schema. It is always written at creation today, but a
      // null slipping through would hand the frontend `undefined` and the
      // Razorpay modal would silently fail to open with nothing logged.
      if (!session.order.razorpayOrderId) {
        logger.error(
          { sessionId, orderId: session.order.id },
          "Existing CREATED order has no razorpayOrderId — cannot resume checkout"
        );
        throw new ConflictError(
          "This order is in an inconsistent state and cannot be resumed. Please contact support."
        );
      }

      // Converge the session if it ever drifted back to PREVIEW_READY while an
      // order existed. A no-op in the normal case (already AWAITING_PAYMENT),
      // and the status guard means it can never stomp a paid session.
      await prisma.orderSession.updateMany({
        where: { id: sessionId, status: "PREVIEW_READY" },
        data: { status: "AWAITING_PAYMENT" },
      });

      logger.info(
        { sessionId, orderId: session.order.id, razorpayOrderId: session.order.razorpayOrderId },
        "Checkout re-initiated — reusing existing CREATED order"
      );

      // Amount comes off the Order snapshot, never a fresh PricingRule lookup.
      // If an admin edited the price since, a recomputed amount would disagree
      // with the amount the Razorpay order was actually created for and the
      // gateway would reject the payment.
      return {
        orderId: session.order.id,
        razorpayOrderId: session.order.razorpayOrderId,
        razorpayKeyId: config.razorpay.razorpayKeyId,
        amount: toSmallestUnit(session.order.amount.toNumber(), session.order.currency),
        currency: session.order.currency,
        displayAmount: session.order.amount.toString(),
        notificationEmail: session.order.notificationEmail,
      };
    }
    // Any other status — user has already paid or moved past checkout
    throw new ConflictError(
      `An order already exists for this session with status ${session.order.status}. Cannot re-initiate checkout.`
    );
  }

  // 3. Status guard — only reachable when no Order row exists for this session.
  if (session.status !== "PREVIEW_READY") {
    throw new ConflictError(
      `Session must be in PREVIEW_READY status to checkout. Current: ${session.status}`
    );
  }

  // 4. Must have userId attached
  if (!session.userId) {
    throw new ValidationError(
      "You must be logged in to proceed with payment. Please log in and try again."
    );
  }

  // 5. Must have coverType
  if (!session.coverType) {
    throw new ValidationError("Please select a cover type before proceeding to payment.");
  }

  // 6. Must have shipping filled
  assertShippingComplete(session);

  // 7. Look up country
  const country = await prisma.country.findUnique({
    where: { code: session.shippingCountry! },
  });

  if (!country) {
    throw new NotFoundError(
      `Country '${session.shippingCountry}' not found. Please contact support.`
    );
  }

  if (!country.isActive) {
    throw new ValidationError(
      `We do not currently ship to ${country.name}. Please choose a different country.`
    );
  }

  // 8. Look up pricing rule
  const pricingRule = await prisma.pricingRule.findUnique({
    where: {
      comicId_countryId_coverType: {
        comicId: session.comicId,
        countryId: country.id,
        coverType: session.coverType,
      },
    },
  });

  if (!pricingRule) {
    logger.error(
      {
        comicId: session.comicId,
        countryId: country.id,
        countryCode: country.code,
        coverType: session.coverType,
      },
      "Pricing rule missing for checkout — configuration gap"
    );
    throw new NotFoundError(
      `Pricing not configured for this comic in ${country.name} (${session.coverType}). Please contact support.`
    );
  }

  const priceInMajorUnits = pricingRule.price.toNumber();
  const amountSmallestUnit = toSmallestUnit(priceInMajorUnits, country.currencyCode);
  const isInternational = country.code !== "IN";

  // 9. Create Razorpay order — OUTSIDE transaction (external API)
  let razorpayOrder;
  try {
    razorpayOrder = await razorpay.orders.create({
      amount: amountSmallestUnit,
      currency: country.currencyCode,
      receipt: `session_${sessionId.slice(0, 30)}`, // Razorpay caps receipt at 40 chars
      notes: {
        sessionId,
        comicId: session.comicId,
        userId: session.userId,
        coverType: session.coverType,
      },
    });
  } catch (error: any) {
    logger.error(
      { sessionId, error: error?.error || error?.message || error },
      "Razorpay order creation failed"
    );
    throw new Error("Payment gateway is temporarily unavailable. Please try again.");
  }

  // 10. Persist Order row + flip session status — inside transaction
  try {
    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          orderSessionId: sessionId,
          amount: pricingRule.price,
          currency: country.currencyCode,
          countryCode: country.code,
          coverType: session.coverType!,
          notificationEmail: session.notificationEmail,
          shippingName: session.shippingName,
          shippingLine1: session.shippingLine1,
          shippingLine2: session.shippingLine2,
          shippingCity: session.shippingCity,
          shippingState: session.shippingState,
          shippingZip: session.shippingZip,
          shippingCountry: session.shippingCountry,
          shippingPhone: session.shippingPhone,
          razorpayOrderId: razorpayOrder.id,
          status: "CREATED",
          isInternational,
        },
      });

      // Flip session status via updateMany + guard, so a concurrent update can't race us
      await tx.orderSession.updateMany({
        where: { id: sessionId, status: "PREVIEW_READY" },
        data: { status: "AWAITING_PAYMENT" },
      });

      return createdOrder;
    });

    logger.info(
      {
        sessionId,
        orderId: order.id,
        razorpayOrderId: razorpayOrder.id,
        amount: amountSmallestUnit,
        currency: country.currencyCode,
      },
      "Checkout initiated — Order created and Razorpay order linked"
    );

    return {
      orderId: order.id,
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: config.razorpay.razorpayKeyId,
      amount: amountSmallestUnit,
      currency: country.currencyCode,
      displayAmount: pricingRule.price.toString(),
      notificationEmail: order.notificationEmail,
    };
  } catch (error: any) {
    // DB write failed after Razorpay order created — orphan on Razorpay side.
    // Razorpay auto-expires unused orders after 15 min. Log so ops can investigate.
    logger.error(
      {
        sessionId,
        razorpayOrderId: razorpayOrder.id,
        error: error?.message || error,
      },
      "Order row creation failed AFTER Razorpay order created — orphan Razorpay order will auto-expire"
    );
    throw new Error("Failed to save order. Please try again.");
  }
}
