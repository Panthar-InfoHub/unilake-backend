import type { OrderStatus } from "../generated/prisma/client.js";

/**
 * Customer-facing order status.
 *
 * We collapse the 9 internal states into 5 vague stages the customer sees
 * on their "My Orders" page. Rationale:
 *  - Internal states like SHIPROCKET_FAILED are ops concerns, not customer concerns.
 *  - CONFIRMED / SHIPROCKET_FAILED / READY_TO_SHIP all mean the same thing to the
 *    user: "we're preparing your book."
 *  - Renaming a public stage should never require a schema migration; it's just
 *    a one-line change in this file.
 */


export type PublicOrderStatus = 
| "Awaiting payment"
  | "Comic being created"
  | "Awaiting your selection"
  | "Printing"
  | "Shipped"
  | "Delivered"
  | "Cancelled";

const MAPPING: Record<OrderStatus, PublicOrderStatus> = {
  CREATED: "Awaiting payment",
  PAID: "Comic being created",
  GENERATED: "Awaiting your selection",
  CONFIRMED: "Printing",
  SHIPROCKET_FAILED: "Printing",
  READY_TO_SHIP: "Printing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};
export function toPublicStatus(status: OrderStatus): PublicOrderStatus {
  return MAPPING[status];
}