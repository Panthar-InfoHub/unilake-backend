import { prisma } from "../lib/prisma.js";
import { NotFoundError, ForbiddenError } from "../utils/errors.js";
import { logger } from "../lib/logger.js";
import {
  toPublicStatus,
  type PublicOrderStatus,
} from "../utils/orderStatusMapping.js";
import type { ListAdminOrdersQueryInput } from "../validators/order.schema.js";
import type { Prisma } from "../generated/prisma/client.js";

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
          comic: {
            select: { id: true, title: true, coverThumbnailUrls: true },
          },
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
          comic: {
            select: { id: true, title: true, coverThumbnailUrls: true },
          },
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

// ============================================================
// USER TRACKING (Section 6)
// ============================================================
//
// Returns the customer's view of their order's shipment status.
// Deliberately narrow: only fields safe for user consumption.
//
// Raw `trackingStatus` (Shiprocket's inconsistent-casing text) is admin-only
// per the Aug 29 decision — do NOT add it here. Admin endpoints (Section 7)
// return it separately alongside the mapped status.
//
// Ownership: Order has no userId of its own; it lives on OrderSession.
// A null userId (anonymous session that never attached a login) also fails
// the ownership check — treated as "not yours" rather than "no owner."

export type UserOrderTracking = {
  status: PublicOrderStatus;
  courierName: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  pickupScheduledDate: Date | null;
  trackingUpdatedAt: Date | null;
};

export async function getTrackingForUser(
  orderId: string,
  userId: string
): Promise<UserOrderTracking> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      courierName: true,
      shippedAt: true,
      deliveredAt: true,
      pickupScheduledDate: true,
      trackingUpdatedAt: true,
      orderSession: {
        select: { userId: true },
      },
    },
  });

  if (!order) {
    throw new NotFoundError("Order not found");
  }

  if (!order.orderSession.userId || order.orderSession.userId !== userId) {
    throw new ForbiddenError("You do not have permission to view this order");
  }

  return {
    status: toPublicStatus(order.status),
    courierName: order.courierName,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    pickupScheduledDate: order.pickupScheduledDate,
    trackingUpdatedAt: order.trackingUpdatedAt,
  };
}

// ============================================================
// ADMIN ORDER LIST (Section 7 — endpoint 1 of 8)
// ============================================================
//
// Paginated + searchable + filterable list of ALL orders for the admin
// panel. Row shape is deliberately narrow — enough to render the table
// row and decide which order to open. Full detail comes from the
// per-order endpoint (endpoint 2 of 8).
//
// Search is case-insensitive and matches across:
//   Order:         id, shippingName, notificationEmail, shippingPhone, awbNumber
//   OrderSession:  childName
//   Comic:         title
// The nested-relation OR clauses cost joins per search; acceptable at
// current scale, revisit in Section 8 if the admin table gets slow.

export async function listAdminOrders(filters: ListAdminOrdersQueryInput) {
  const where: Prisma.OrderWhereInput = {};

  if (filters.status !== undefined) {
    where.status = filters.status;
  }

  if (filters.search !== undefined) {
    const q = filters.search; // already trimmed + min-length checked in Zod
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { shippingName: { contains: q, mode: "insensitive" } },
      { notificationEmail: { contains: q, mode: "insensitive" } },
      { shippingPhone: { contains: q, mode: "insensitive" } },
      { awbNumber: { contains: q, mode: "insensitive" } },
      { orderSession: { childName: { contains: q, mode: "insensitive" } } },
      {
        orderSession: {
          comic: { title: { contains: q, mode: "insensitive" } },
        },
      },
    ];
  }

  const skip = (filters.page - 1) * filters.pageSize;
  const take = filters.pageSize;

  // Fire the two queries in parallel — count needs the same `where` as the list.
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      skip,
      take,
      orderBy: { [filters.sortBy]: filters.sortOrder },
      select: {
        id: true,
        createdAt: true,
        shippingName: true,
        notificationEmail: true,
        shippingPhone: true,
        amount: true,
        currency: true,
        status: true,
        trackingStatus: true,
        awbNumber: true,
        courierName: true,
        shippedAt: true,
        deliveredAt: true,
        orderSession: {
          select: {
            childName: true,
            comic: { select: { title: true } },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const rows = orders.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    customerName: o.shippingName,
    customerEmail: o.notificationEmail,
    customerPhone: o.shippingPhone,
    amount: o.amount.toString(),
    currency: o.currency,
    status: o.status,
    trackingStatus: o.trackingStatus,
    awbNumber: o.awbNumber,
    courierName: o.courierName,
    shippedAt: o.shippedAt,
    deliveredAt: o.deliveredAt,
    childName: o.orderSession.childName,
    comicTitle: o.orderSession.comic.title,
  }));

  return {
    orders: rows,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    },
  };
}

// ============================================================
// ADMIN ORDER DETAIL (Section 7 — endpoint 2 of 8)
// ============================================================
//
// Full-detail view for a single order. Everything the admin needs on
// one screen — customer + payment + shipping + shipment + webhook
// history — no separate calls required.
//
// Two decisions locked earlier this session:
//   1. Include attached User's name + email (from OrderSession.user).
//      Admin needs to distinguish "who paid" from "who receives" —
//      the shipping snapshot can differ (gift shipping).
//   2. WebhookEvent.payloadJson returned as-is, not trimmed. Admin
//      panel renders it collapsed; audit trail per Aug 29 decision.
//
// Returns raw trackingStatus alongside mapped publicStatus per the
// Aug 29 status-visibility split (admin sees both, user sees mapped).

export async function getAdminOrderDetail(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderSession: {
        select: {
          id: true,
          childName: true,
          pronounKey: true,
          age: true,
          user: {
            select: { id: true, name: true, email: true },
          },
          comic: {
            select: { id: true, title: true, coverThumbnailUrls: true },
          },
        },
      },
      webhookEvents: {
        orderBy: { processedAt: "desc" },
        select: {
          id: true,
          source: true,
          eventId: true,
          eventType: true,
          processedAt: true,
          payloadJson: true,
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundError("Order not found");
  }

  return {
    id: order.id,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,

    amount: order.amount.toString(),
    currency: order.currency,
    countryCode: order.countryCode,
    coverType: order.coverType,

    status: order.status,
    publicStatus: toPublicStatus(order.status),

    customer: {
      notificationEmail: order.notificationEmail,
      user: order.orderSession.user, // null if anonymous session never attached a login
    },

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

    payment: {
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId: order.razorpayPaymentId,
    },

    pdf: {
      pdfUrl: order.pdfUrl,
      pdfDownloadUrl: order.pdfDownloadUrl,
      pdfDownloadExpiry: order.pdfDownloadExpiry,
    },

    shipment: {
      shiprocketOrderId: order.shiprocketOrderId,
      shiprocketShipmentId: order.shiprocketShipmentId,
      awbNumber: order.awbNumber,
      courierId: order.courierId,
      courierName: order.courierName,
      trackingStatus: order.trackingStatus, // raw — admin only
      trackingUrl: order.trackingUrl,
      trackingUpdatedAt: order.trackingUpdatedAt,
      isInternational: order.isInternational,
    },

    dimensions: {
      finalLength: order.finalLength,
      finalBreadth: order.finalBreadth,
      finalHeight: order.finalHeight,
      finalWeight: order.finalWeight,
    },

    timestamps: {
      awbGeneratedAt: order.awbGeneratedAt,
      labelGeneratedAt: order.labelGeneratedAt,
      pickupScheduledDate: order.pickupScheduledDate,
      pickupGeneratedAt: order.pickupGeneratedAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
    },

    session: {
      id: order.orderSession.id,
      childName: order.orderSession.childName,
      pronounKey: order.orderSession.pronounKey,
      age: order.orderSession.age,
      comic: order.orderSession.comic,
    },

    webhookEvents: order.webhookEvents,
  };
}
