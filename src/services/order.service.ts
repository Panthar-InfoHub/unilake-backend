import { prisma } from "../lib/prisma.js";
import { NotFoundError, ForbiddenError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import { toPublicStatus } from "../utils/orderStatusMapping.js";

/**
 * List all orders belonging to a user, most recent first.
 * Called from the customer-facing "My Orders" page.
 *
 * We return a curated shape — no razorpayPaymentId, no webhook internals,
 * no admin-only fields like shiprocketOrderId or awbNumber. Just what the
 * customer needs to see on the list card.
 */

export async function listUserOrders(userId: string) {
  const orders = await prisma.order.findMany({
    where: {
      orderSession: { userId },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      coverType: true,
      createdAt: true,
      trackingStatus: true,
      orderSession: {
        select: {
          id: true,
          comic: { select: { id: true, title: true, coverThumbnailUrls: true } },
        },
      },
    },
  });
  return orders.map((order) => ({
    id: order.id,
    sessionId: order.orderSession.id,
    comic: order.orderSession.comic,
    coverType: order.coverType,
    amount: order.amount.toString(),
    currency: order.currency,
    publicStatus: toPublicStatus(order.status),
    trackingStatus: order.trackingStatus,
    createdAt: order.createdAt,
  }));
}


/**
 * Get a single order by id, with ownership check.
 * Returns the customer-facing shape — includes shipping snapshot and PDF url
 * (needed for "Reprint" / "Download PDF"), excludes admin/gateway internals.
 */

export async function getUserOrder(orderId: string, userId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderSession: {
        select: {
          id: true,
          userId: true,
          comic: { select: { id: true, title: true, coverThumbnailUrls: true } },
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundError("Order not found");
  }

  if (order.orderSession.userId !== userId) {
    logger.warn(
      { orderId, userId, ownerUserId: order.orderSession.userId },
      "Ownership check failed on order fetch"
    );
    throw new ForbiddenError("You do not have permission to view this order");
  }

  return {
    id: order.id,
    sessionId: order.orderSession.id,
    comic: order.orderSession.comic,
    coverType: order.coverType,
    amount: order.amount.toString(),
    currency: order.currency,
    publicStatus: toPublicStatus(order.status),
    shipping: {
      name: order.shippingName,
      line1: order.shippingLine1,
      line2: order.shippingLine2,
      city: order.shippingCity,
      state: order.shippingState,
      zip: order.shippingZip,
      country: order.shippingCountry,
      phone: order.shippingPhone,
    },
    pdfDownloadUrl: order.pdfDownloadUrl,
    pdfDownloadExpiry: order.pdfDownloadExpiry,
    trackingStatus: order.trackingStatus,
    courierName: order.courierName,
    awbNumber: order.awbNumber,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}