import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { AppError, NotFoundError, ConflictError } from "../utils/errors.js";
import {
  createOrder as shiprocketCreateOrder,
  updateOrder as shiprocketUpdateOrder,
  assignAwb as shiprocketAssignAwb,
  generatePickup as shiprocketGeneratePickup,
  type CreateOrderParams,
} from "../lib/shiprocket.js";
import {
  DEFAULT_PACKAGE_LENGTH_CM,
  DEFAULT_PACKAGE_BREADTH_CM,
  DEFAULT_PACKAGE_HEIGHT_CM,
  DEFAULT_PACKAGE_WEIGHT_KG,
  MIN_DIMENSION_CM,
  MAX_DIMENSION_CM,
  MIN_WEIGHT_KG,
  MAX_WEIGHT_KG,
  SHIPROCKET_STATUS_MAP 
} from "../config/shipping.js";
import type { OrderStatus } from "../generated/prisma/client.js";


// ============================================================
// SHIPROCKET SERVICE — Phase A & Phase B business logic
// ============================================================
//
// Sits between the raw Shiprocket client (src/lib/shiprocket.ts) and the
// two callers: the BullMQ worker (Phase A) and the admin endpoint
// (Phase B — Section 7). Neither caller should ever import from
// src/lib/shiprocket.ts directly.
//
// Two-stage flow:
//   Phase A (auto, worker-driven)
//     PDF is compiled → session flips to SHIPMENT_QUEUED → worker fires.
//     We call Shiprocket createOrder with PLACEHOLDER dimensions from
//     shipping.ts. Real dimensions come from the admin later. Result:
//     Order.status = READY_TO_SHIP, OrderSession.status = COMPLETED.
//
//   Phase B (admin, HTTP-driven)
//     Admin packs the book, measures/weighs, submits real dimensions via
//     the admin endpoint. We push those to Shiprocket via updateOrder,
//     then assign the AWB, then schedule pickup. Order.status stays at
//     READY_TO_SHIP — the webhook flips it to SHIPPED when the courier
//     first scans the AWB.

// ============================================================
// PHASE A
// ============================================================

/**
 * Runs the Phase A "create Shiprocket order" flow for a session.
 *
 * Idempotency:
 *   - If Order.shiprocketOrderId is already set AND Order.status has moved
 *     past CONFIRMED (READY_TO_SHIP / SHIPPED / DELIVERED / SHIPROCKET_FAILED),
 *     this is a no-op — worker retry after a successful prior run.
 *   - If shiprocketOrderId is set but status is still early, someone reset
 *     the status manually. Log and no-op; needs admin attention.
 *   - Otherwise, call Shiprocket createOrder, save IDs, flip status.
 *
 * Failures propagate: the worker catches them, BullMQ retries per policy,
 * final failure flips Order.status = SHIPROCKET_FAILED and
 * OrderSession.status = SHIPMENT_FAILED (handled in the worker's
 * `failed` listener, not here).
 */
export async function createShipmentForSession(
  orderSessionId: string
): Promise<{ shiprocketOrderId: string; shipmentId: string } | { skipped: true }> {
  logger.info(
    { orderSessionId },
    "[Shiprocket Service] Phase A — createShipmentForSession start"
  );

  // Load session + order + comic (need title for the shipping label).
  const session = await prisma.orderSession.findUnique({
    where: { id: orderSessionId },
    include: {
      order: true,
      comic: { select: { id: true, title: true } },
    },
  });

  if (!session) {
    throw new NotFoundError(
      `OrderSession ${orderSessionId} not found in createShipmentForSession`
    );
  }
  if (!session.order) {
    throw new ConflictError(
      `OrderSession ${orderSessionId} has no Order — cannot create shipment`
    );
  }

  const order = session.order;

  // Idempotency check #1: already created and moved on
  if (
    order.shiprocketOrderId &&
    ["READY_TO_SHIP", "SHIPPED", "DELIVERED", "SHIPROCKET_FAILED"].includes(
      order.status
    )
  ) {
    logger.info(
      {
        orderSessionId,
        orderId: order.id,
        shiprocketOrderId: order.shiprocketOrderId,
        orderStatus: order.status,
      },
      "[Shiprocket Service] Shipment already created — skipping"
    );
    return { skipped: true };
  }

  // Idempotency check #2: ID exists but status is inconsistent
  if (order.shiprocketOrderId) {
    logger.warn(
      {
        orderSessionId,
        orderId: order.id,
        shiprocketOrderId: order.shiprocketOrderId,
        orderStatus: order.status,
      },
      "[Shiprocket Service] shiprocketOrderId is set but status is inconsistent — no-op, needs admin attention"
    );
    return { skipped: true };
  }

  // Validate the shipping snapshot on Order. These were copied from
  // OrderSession at order creation; if any critical field is null the
  // order should never have reached this stage.
  const missing: string[] = [];
  if (!order.shippingName) missing.push("shippingName");
  if (!order.shippingLine1) missing.push("shippingLine1");
  if (!order.shippingCity) missing.push("shippingCity");
  if (!order.shippingState) missing.push("shippingState");
  if (!order.shippingZip) missing.push("shippingZip");
  if (!order.shippingCountry) missing.push("shippingCountry");
  if (!order.shippingPhone) missing.push("shippingPhone");
  if (missing.length > 0) {
    throw new ConflictError(
      `Order ${order.id} missing shipping fields: ${missing.join(", ")}`
    );
  }

  // Split the shipping name into first/last. If only one word, Shiprocket
  // still accepts empty last name.
  const nameParts = order.shippingName!.trim().split(/\s+/);
  const firstName = nameParts[0]!;
  const lastName = nameParts.slice(1).join(" ") || undefined;

  const params: CreateOrderParams = {
    ourOrderId: order.id,
    billing: {
      firstName,
      lastName,
      address1: order.shippingLine1!,
      address2: order.shippingLine2 ?? undefined,
      city: order.shippingCity!,
      pincode: order.shippingZip!,
      state: order.shippingState!,
      country: order.shippingCountry!,
      email: order.notificationEmail ?? session.notificationEmail ?? "",
      phone: order.shippingPhone!,
    },
    item: {
      // Label shows this. Include child name if available so the admin can
      // eyeball the right box for the right customer.
      name: session.childName
        ? `${session.comic.title} — for ${session.childName}`
        : session.comic.title,
      sku: session.comic.id,
      units: 1,
      // amount is Decimal; toNumber() is safe here — INR max ~10^4 for a single book.
      sellingPrice: Number(order.amount),
    },
    paymentMethod: "Prepaid",
    subTotal: Number(order.amount),
    dimensions: {
      length: DEFAULT_PACKAGE_LENGTH_CM,
      breadth: DEFAULT_PACKAGE_BREADTH_CM,
      height: DEFAULT_PACKAGE_HEIGHT_CM,
      weight: DEFAULT_PACKAGE_WEIGHT_KG,
    },
  };

  const result = await shiprocketCreateOrder(params);

  // Save IDs and flip status. Both flips are guarded so a concurrent status
  // change (extremely unlikely at this stage) is safe.
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        shiprocketOrderId: result.shiprocketOrderId,
        shiprocketShipmentId: result.shipmentId,
      },
    });

    // Order.status: allow flip from GENERATED or CONFIRMED (whichever the
    // upstream flow currently uses). If Order.status is already past this
    // point, don't overwrite.
    await tx.order.updateMany({
      where: {
        id: order.id,
        status: { in: ["GENERATED", "CONFIRMED"] },
      },
      data: { status: "READY_TO_SHIP" },
    });

    // Session flip: SHIPMENT_QUEUED → COMPLETED. User's journey is done.
    await tx.orderSession.updateMany({
      where: { id: orderSessionId, status: "SHIPMENT_QUEUED" },
      data: { status: "COMPLETED" },
    });
  });

  logger.info(
    {
      orderSessionId,
      orderId: order.id,
      shiprocketOrderId: result.shiprocketOrderId,
      shipmentId: result.shipmentId,
    },
    "[Shiprocket Service] Phase A complete — order = READY_TO_SHIP, session = COMPLETED"
  );

  return {
    shiprocketOrderId: result.shiprocketOrderId,
    shipmentId: result.shipmentId,
  };
}

// ============================================================
// PHASE B
// ============================================================

export type FinalDimensions = {
  length: number;
  breadth: number;
  height: number;
  weight: number;
};

/**
 * Validates admin-entered final dimensions against the bounds in shipping.ts.
 * Throws ValidationError with a clear message so the admin endpoint can
 * return a 400 with the actual bad field name.
 */
function validateFinalDimensions(d: FinalDimensions): void {
  const check = (n: number, min: number, max: number, name: string) => {
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new AppError(
        `Invalid ${name}: must be between ${min} and ${max}, got ${n}`,
        400,
        "SHIPROCKET_INVALID_DIMENSIONS"
      );
    }
  };
  check(d.length, MIN_DIMENSION_CM, MAX_DIMENSION_CM, "length");
  check(d.breadth, MIN_DIMENSION_CM, MAX_DIMENSION_CM, "breadth");
  check(d.height, MIN_DIMENSION_CM, MAX_DIMENSION_CM, "height");
  check(d.weight, MIN_WEIGHT_KG, MAX_WEIGHT_KG, "weight");
}

/**
 * Runs Phase B for an order: push real dimensions → assign AWB → schedule pickup.
 *
 * Called inline from the admin "confirm dimensions" endpoint (Section 7).
 * NOT idempotent as a whole — but each sub-step guards itself:
 *   - updateOrder is safe to re-send
 *   - assignAwb refuses a second call once AWB exists
 *   - generatePickup refuses if pickup already generated
 *
 * If assignAwb or generatePickup has already run, callers should not invoke
 * this function again — enforced via the awbNumber / pickupGeneratedAt
 * checks below.
 *
 * On success, Order gets: finalLength/Breadth/Height/Weight, awbNumber,
 * courierId, courierName, awbGeneratedAt, pickupScheduledDate,
 * pickupGeneratedAt. Order.status stays at READY_TO_SHIP — the Shiprocket
 * webhook flips it to SHIPPED when the courier first scans.
 */
export async function pushDimensionsAssignAwbAndSchedulePickup(
  orderId: string,
  dimensions: FinalDimensions
): Promise<{
  awbCode: string;
  courierName: string;
  pickupScheduledDate: Date | null;
}> {
  validateFinalDimensions(dimensions);

  logger.info(
    { orderId, dimensions },
    "[Shiprocket Service] Phase B — pushDimensionsAssignAwbAndSchedulePickup start"
  );

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderSession: {
        include: { comic: { select: { id: true, title: true } } },
      },
    },
  });

  if (!order) {
    throw new NotFoundError(`Order ${orderId} not found in Phase B`);
  }
  if (order.status !== "READY_TO_SHIP") {
    throw new ConflictError(
      `Order ${orderId} is ${order.status}, must be READY_TO_SHIP for Phase B`
    );
  }
  if (!order.shiprocketOrderId || !order.shiprocketShipmentId) {
    throw new ConflictError(
      `Order ${orderId} missing shiprocketOrderId / shipmentId — Phase A did not run`
    );
  }
  if (order.awbNumber) {
    throw new ConflictError(
      `Order ${orderId} already has an AWB (${order.awbNumber}) — Phase B already ran`
    );
  }

  // 1. Save final dimensions locally BEFORE the Shiprocket calls. If any
  // downstream call fails, at least the DB reflects what the admin entered
  // and they can see what they typed.
  await prisma.order.update({
    where: { id: orderId },
    data: {
      finalLength: dimensions.length,
      finalBreadth: dimensions.breadth,
      finalHeight: dimensions.height,
      finalWeight: dimensions.weight,
    },
  });

  // 2. Rebuild the same params shape used for createOrder, with the real
  // dimensions swapped in. Shiprocket's update endpoint accepts the full
  // payload and only mutates dimensions + items.
  const nameParts = order.shippingName!.trim().split(/\s+/);
  const firstName = nameParts[0]!;
  const lastName = nameParts.slice(1).join(" ") || undefined;

  const params: CreateOrderParams = {
    ourOrderId: order.id,
    billing: {
      firstName,
      lastName,
      address1: order.shippingLine1!,
      address2: order.shippingLine2 ?? undefined,
      city: order.shippingCity!,
      pincode: order.shippingZip!,
      state: order.shippingState!,
      country: order.shippingCountry!,
      email:
        order.notificationEmail ??
        order.orderSession.notificationEmail ??
        "",
      phone: order.shippingPhone!,
    },
    item: {
      name: order.orderSession.childName
        ? `${order.orderSession.comic.title} — for ${order.orderSession.childName}`
        : order.orderSession.comic.title,
      sku: order.orderSession.comic.id,
      units: 1,
      sellingPrice: Number(order.amount),
    },
    paymentMethod: "Prepaid",
    subTotal: Number(order.amount),
    dimensions,
  };

  await shiprocketUpdateOrder(params);
  logger.info({ orderId }, "[Shiprocket Service] Phase B — updateOrder done");

  // 3. Assign AWB
  const awbResult = await shiprocketAssignAwb({
    shipmentId: order.shiprocketShipmentId,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      awbNumber: awbResult.awbCode,
      courierId: awbResult.courierId,
      courierName: awbResult.courierName,
      awbGeneratedAt: awbResult.awbGeneratedAt,
    },
  });

  logger.info(
    { orderId, awbCode: awbResult.awbCode, courierName: awbResult.courierName },
    "[Shiprocket Service] Phase B — assignAwb done"
  );

  // 4. Generate pickup
  const pickupResult = await shiprocketGeneratePickup({
    shipmentId: order.shiprocketShipmentId,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      pickupScheduledDate: pickupResult.pickupScheduledDate,
      pickupGeneratedAt: pickupResult.pickupGeneratedAt,
    },
  });

  logger.info(
    {
      orderId,
      pickupScheduledDate: pickupResult.pickupScheduledDate?.toISOString() ?? null,
    },
    "[Shiprocket Service] Phase B — generatePickup done"
  );

  return {
    awbCode: awbResult.awbCode,
    courierName: awbResult.courierName,
    pickupScheduledDate: pickupResult.pickupScheduledDate,
  };
}


// ============================================================
// WEBHOOK STATUS UPDATE
// ============================================================
//
// Called from webhook.service.ts::handleShiprocketWebhook after the
// WebhookEvent row has been created (dedup gate passed).
//
// Responsibilities:
//   - Look up our Order by AWB
//   - Always update trackingStatus + trackingUpdatedAt (raw audit trail)
//   - Optionally flip Order.status if the raw status maps to a target
//     enum AND the current status permits that transition
//   - Set shippedAt / deliveredAt on the first transition into those states
//   - Trigger notifyUser on shipped/delivered (TODO stub for now)
//
// Idempotent: repeat webhooks for the same status re-write the same values
// and never move Order.status backwards.

/**
 * Which source statuses may transition to a given target on webhook.
 * Anything not listed is a no-op status flip (raw tracking still updates).
 *
 * DELIVERED and CANCELLED are terminal — never overwritten by webhook.
 * SHIPPED allows self-transition so timestamps refresh cleanly on repeats.
 */
const WEBHOOK_ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  SHIPPED: ["READY_TO_SHIP", "SHIPPED"],
  DELIVERED: ["READY_TO_SHIP", "SHIPPED"],
  SHIPROCKET_FAILED: ["READY_TO_SHIP", "SHIPPED"],
};

/**
 * Parses Shiprocket's inconsistent webhook timestamp formats.
 * Handles both "yyyy-mm-dd HH:mm:ss" and "dd mm yyyy HH:mm:ss".
 * Returns null on unparseable input (caller falls back to now()).
 */
function parseShiprocketWebhookTimestamp(s: unknown): Date | null {
  if (typeof s !== "string" || s.trim().length === 0) return null;
  const trimmed = s.trim();

  // Format A: "2021-07-02 16:41:59" (yyyy-mm-dd starts with 4 digits + dash)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const iso = trimmed.replace(" ", "T") + "Z";
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  // Format B: "23 05 2023 11:43:52" (dd mm yyyy space-separated)
  const m = trimmed.match(/^(\d{2}) (\d{2}) (\d{4}) (\d{2}:\d{2}:\d{2})$/);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}T${m[4]}Z`;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  return null;
}

export type ShiprocketWebhookResult =
  | { orderId: string; statusFlipped: boolean }
  | { orderId: null; reason: "no_awb" | "no_order" };

export async function processShiprocketStatusUpdate(
  payload: unknown
): Promise<ShiprocketWebhookResult> {
  // Payload is `unknown` — Shiprocket's shape is loose, narrow defensively.
  const p = payload as {
    awb?: string | number;
    current_status?: string;
    current_status_id?: number;
    current_timestamp?: string;
    courier_name?: string;
  };

  // AWB can arrive as string or number — normalise to string for lookup.
  const awb =
    typeof p.awb === "number" ? String(p.awb) : p.awb?.toString().trim();

  if (!awb) {
    logger.warn(
      { payload: p },
      "[Shiprocket Webhook] Missing AWB in payload — cannot look up order"
    );
    return { orderId: null, reason: "no_awb" };
  }

  const rawStatus = (p.current_status ?? "").trim();
  const normalized = rawStatus.toUpperCase();
  const mappedStatus: OrderStatus | undefined = SHIPROCKET_STATUS_MAP[normalized];
  const eventTimestamp =
    parseShiprocketWebhookTimestamp(p.current_timestamp) ?? new Date();

  const order = await prisma.order.findFirst({
    where: { awbNumber: awb },
  });

  if (!order) {
    logger.warn(
      { awb, rawStatus, normalized, courierName: p.courier_name },
      "[Shiprocket Webhook] No Order found for AWB — orphan webhook, needs admin follow-up"
    );
    return { orderId: null, reason: "no_order" };
  }

  // Step 1: always update raw tracking fields. This runs on EVERY webhook,
  // regardless of whether we can map the status or flip Order.status.
  // Admin sees the raw text in the admin panel; user sees only Order.status.
  await prisma.order.update({
    where: { id: order.id },
    data: {
      trackingStatus: rawStatus,
      trackingUpdatedAt: eventTimestamp,
    },
  });

  // Step 2: attempt Order.status transition if we have a mapping.
  let statusFlipped = false;

  if (mappedStatus) {
    const allowedSources = WEBHOOK_ALLOWED_TRANSITIONS[mappedStatus] ?? [];

    if (allowedSources.length === 0) {
      logger.warn(
        { awb, mappedStatus, currentStatus: order.status },
        "[Shiprocket Webhook] No allowed transitions defined for target status"
      );
    } else {
      const flipData: {
        status: OrderStatus;
        shippedAt?: Date;
        deliveredAt?: Date;
      } = { status: mappedStatus };

      // Set shippedAt on first transition into SHIPPED, not on repeats.
      if (mappedStatus === "SHIPPED" && !order.shippedAt) {
        flipData.shippedAt = eventTimestamp;
      }
      // Same for deliveredAt.
      if (mappedStatus === "DELIVERED" && !order.deliveredAt) {
        flipData.deliveredAt = eventTimestamp;
      }

      const result = await prisma.order.updateMany({
        where: { id: order.id, status: { in: allowedSources } },
        data: flipData,
      });

      statusFlipped = result.count > 0;

      if (statusFlipped) {
        logger.info(
          {
            orderId: order.id,
            awb,
            fromStatus: order.status,
            toStatus: mappedStatus,
            rawStatus,
          },
          "[Shiprocket Webhook] Order.status flipped"
        );

        // Trigger user notifications on the two customer-visible transitions.
        if (mappedStatus === "SHIPPED") {
          // TODO: notifyUser — "your book has shipped" email
          // Wait for the email provider integration (later roadmap section).
        }
        if (mappedStatus === "DELIVERED") {
          // TODO: notifyUser — "your book has been delivered" email
        }
        if (mappedStatus === "SHIPROCKET_FAILED") {
          // TODO: notifyAdmin — internal alert for manual recovery
        }
      } else {
        logger.info(
          {
            orderId: order.id,
            awb,
            currentStatus: order.status,
            attemptedTarget: mappedStatus,
          },
          "[Shiprocket Webhook] Status transition not applied — current status not in allowed sources (terminal or already progressed)"
        );
      }
    }
  } else {
    logger.debug(
      { awb, rawStatus, normalized },
      "[Shiprocket Webhook] Raw status has no mapping — trackingStatus updated, Order.status unchanged"
    );
  }

  return { orderId: order.id, statusFlipped };
}