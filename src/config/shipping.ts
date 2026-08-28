// Placeholder package dimensions used when creating the Shiprocket order at
// send-to-print time. Real dimensions come from the admin at packaging before
// generating the awb number we will call the siprocket update order api, which updates the
// Shiprocket order before AWB assignment. See section 4 in the Shiprocket
// integration plan for the two-stage flow rationale.
export const DEFAULT_PACKAGE_LENGTH_CM = 25;
export const DEFAULT_PACKAGE_BREADTH_CM = 20;
export const DEFAULT_PACKAGE_HEIGHT_CM = 1;
export const DEFAULT_PACKAGE_WEIGHT_KG = 0.25;

// Bounds for admin-entered final dimensions. Shiprocket rejects zero/negative
// values silently; a max cap keeps typos (e.g. entering weight in grams as 250
// instead of 0.25) from creating unshippable orders.
export const MIN_DIMENSION_CM = 0.5;
export const MAX_DIMENSION_CM = 200;
export const MIN_WEIGHT_KG = 0.05;
export const MAX_WEIGHT_KG = 30;

// HSN code for printed books (India customs classification). Not used for
// domestic shipments — kept here for the international branch that gets added
// later. See DECISIONS.md if/when international is enabled.
export const HSN_CODE_PRINTED_BOOK = "4901";

// Shiprocket status string → internal OrderStatus enum. Shiprocket sends the
// raw string in webhooks; we store it verbatim in `trackingStatus` (audit trail)
// AND flip `Order.status` per this mapping. Any status not in this map is stored
// but does NOT change Order.status — safe default, no accidental state changes.
import type { OrderStatus } from "../generated/prisma/client.js";

export const SHIPROCKET_STATUS_MAP: Record<string, OrderStatus> = {
  // Sent / picked up → SHIPPED
  "PICKED UP": "SHIPPED",
  "IN TRANSIT": "SHIPPED",
  "OUT FOR DELIVERY": "SHIPPED",
  // Terminal success
  DELIVERED: "DELIVERED",
  // Failure branches
  CANCELED: "SHIPROCKET_FAILED",
  CANCELLED: "SHIPROCKET_FAILED",
  RTO: "SHIPROCKET_FAILED",
  "RTO INITIATED": "SHIPROCKET_FAILED",
  "RTO DELIVERED": "SHIPROCKET_FAILED",
  LOST: "SHIPROCKET_FAILED",
};