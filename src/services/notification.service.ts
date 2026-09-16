import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { sendEmail } from "../lib/email.js";
import { NotFoundError } from "../utils/errors.js";
import { trackByAwb } from "../lib/shiprocket.js";

// ============================================================
// NOTIFICATION SERVICE — Layer 3
// ============================================================
//
// Five transactional emails to customers, triggered by events in the
// system. Not endpoints. Called from workers, webhook handlers, and
// admin flows via Layer 4 wiring.
//
// Every function follows the same shape:
//   1. Load the minimum data needed for the email
//   2. Build subject + HTML via a template function
//   3. Send via sendEmail (which handles retries)
//   4. Return { sent: true, messageId } or { sent: false, reason }
//
// Callers should wrap invocations in try/catch and swallow — email
// failure MUST NOT block business logic. See Decision D of the
// notifyUser design.

// ============================================================
// SHARED HELPERS
// ============================================================

/**
 * Wraps a per-email body in a consistent header + footer. Keeps all
 * emails visually consistent — brand tweaks land here in one place.
 *
 * Deliberately minimal for launch — no logo, no brand colors, just
 * clean typography. Client's brand assets get baked in later.
 */
function renderEmailShell(bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Unilake Book</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:32px 40px 16px 40px;border-bottom:1px solid #eee;">
                <div style="font-size:22px;font-weight:600;color:#1a1a1a;">Unilake Book</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 40px;font-size:16px;line-height:1.6;color:#333;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px;border-top:1px solid #eee;font-size:13px;color:#888;">
                <div>Questions? Reply to this email and our team will get back to you.</div>
                <div style="margin-top:8px;">© Unilake Book</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

/**
 * Resolves the trackingUrl for an order, fetching from Shiprocket
 * on-demand ONLY if it's not yet stored on the Order row. Persists
 * the fetched value so future emails / admin views are fast.
 *
 * Returns null if:
 *   - Order has no awbNumber (Phase B never ran — nothing to track)
 *   - Shiprocket returns a "pending" state (AWB assigned but no scans)
 *   - Shiprocket call fails (swallowed — email still sends without link)
 */
async function resolveTrackingUrl(orderId: string): Promise<string | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { trackingUrl: true, awbNumber: true },
  });

  if (!order) return null;
  if (order.trackingUrl) return order.trackingUrl;
  if (!order.awbNumber) return null;

  // Try to fetch and persist. Swallow errors so email still sends.
  try {
    const result = await trackByAwb({ awbCode: order.awbNumber });
    if (result.state === "tracked" && result.trackUrl) {
      await prisma.order.update({
        where: { id: orderId },
        data: { trackingUrl: result.trackUrl },
      });
      return result.trackUrl;
    }
    return null;
  } catch (err) {
    logger.warn(
      { orderId, awbNumber: order.awbNumber, err },
      "[Notification] resolveTrackingUrl — Shiprocket fetch failed, email will send without link"
    );
    return null;
  }
}

/**
 * Common return shape from every notify function. `sent: false` never
 * throws — the caller doesn't need to distinguish "email failed" from
 * "email intentionally skipped." Both are swallowed.
 */
type NotifyResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: string };

/**
 * Wraps sendEmail with the try/catch semantic the notification service
 * needs: never throw upward. Returns a structured result so callers can
 * log it if they want, but never surface it to the customer flow.
 */
async function safeSend(
  to: string,
  subject: string,
  html: string
): Promise<NotifyResult> {
  try {
    const result = await sendEmail({ to, subject, html });
    return { sent: true, messageId: result.messageId };
  } catch (err) {
    logger.error(
      { to, subject, err },
      "[Notification] Email send failed — swallowing to protect caller"
    );
    return {
      sent: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// EMAIL TEMPLATES (per-notification body builders)
// ============================================================

function renderGenerationSuccessBody(args: {
  childName: string;
  comicTitle: string;
}): string {
  return `
    <p>Hi,</p>
    <p><strong>${args.childName}'s comic is ready to preview!</strong></p>
    <p>The illustrations for <em>${args.comicTitle}</em> have been generated. Log in to see how it looks, make any tweaks, and place your order when you're happy.</p>
    <p>— The Unilake Book team</p>
  `.trim();
}

function renderGenerationFailedButPreviousExistsBody(args: {
  childName: string;
  comicTitle: string;
}): string {
  return `
    <p>Hi,</p>
    <p>The latest regeneration attempt for <strong>${args.childName}'s ${args.comicTitle}</strong> ran into a problem.</p>
    <p>Good news — your previous version is still there. You can view it, try regenerating again, or reply to this email if you'd like our team to look into it.</p>
    <p>— The Unilake Book team</p>
  `.trim();
}

function renderPdfReadyBody(args: {
  childName: string;
  comicTitle: string;
}): string {
  return `
    <p>Hi,</p>
    <p><strong>Great news — ${args.childName}'s book is being prepared for printing!</strong></p>
    <p>Your final PDF for <em>${args.comicTitle}</em> is ready and we've queued it for print. You'll get another email as soon as it ships.</p>
    <p>— The Unilake Book team</p>
  `.trim();
}

function renderOrderShippedBody(args: {
  childName: string;
  comicTitle: string;
  courierName: string | null;
  awbNumber: string | null;
  trackingUrl: string | null;
}): string {
  const trackingBlock = args.trackingUrl
    ? `<p><a href="${args.trackingUrl}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Track your shipment</a></p>`
    : `<p>You'll be able to track your shipment once the courier's first scan comes through.</p>`;

  const courierLine = args.courierName
    ? `<p>Courier: <strong>${args.courierName}</strong>${args.awbNumber ? ` &middot; AWB: <code>${args.awbNumber}</code>` : ""}</p>`
    : "";

  return `
    <p>Hi,</p>
    <p><strong>${args.childName}'s book is on the way!</strong></p>
    <p>Your copy of <em>${args.comicTitle}</em> has been picked up by the courier and is heading to you.</p>
    ${courierLine}
    ${trackingBlock}
    <p>— The Unilake Book team</p>
  `.trim();
}

function renderOrderDeliveredBody(args: {
  childName: string;
  comicTitle: string;
}): string {
  return `
    <p>Hi,</p>
    <p><strong>${args.childName}'s book has arrived!</strong></p>
    <p>We hope <em>${args.comicTitle}</em> brings a big smile. If anything's not right with your copy, just reply to this email — we'll sort it out.</p>
    <p>Would love to see a photo if you feel like sharing!</p>
    <p>— The Unilake Book team</p>
  `.trim();
}

// ============================================================
// PUBLIC API — the 5 notification functions
// ============================================================

/**
 * Fires after generation (or regeneration) completes successfully.
 * Called from the RunPod worker.
 */
export async function notifyGenerationSuccess(
  orderSessionId: string
): Promise<NotifyResult> {
  const session = await prisma.orderSession.findUnique({
    where: { id: orderSessionId },
    select: {
      notificationEmail: true,
      childName: true,
      comic: { select: { title: true } },
    },
  });

  if (!session) {
    logger.warn(
      { orderSessionId },
      "[Notification] notifyGenerationSuccess — session not found, skipping"
    );
    return { sent: false, reason: "session_not_found" };
  }
  if (!session.notificationEmail) {
    return { sent: false, reason: "no_recipient_email" };
  }

  const subject = `${session.childName}'s comic is ready to preview!`;
  const html = renderEmailShell(
    renderGenerationSuccessBody({
      childName: session.childName ?? "your",
      comicTitle: session.comic.title,
    })
  );

  return safeSend(session.notificationEmail, subject, html);
}

/**
 * Fires when a regeneration attempt fails, but the customer already has
 * a working previous generation. Called from the RunPod worker's failed
 * listener or the RunPod service, depending on which side detects it.
 *
 * If there's no prior successful generation, use a different notification
 * (or none — first-attempt failures may just show in the UI).
 */
export async function notifyGenerationFailedButPreviousExists(
  orderSessionId: string
): Promise<NotifyResult> {
  const session = await prisma.orderSession.findUnique({
    where: { id: orderSessionId },
    select: {
      notificationEmail: true,
      childName: true,
      comic: { select: { title: true } },
    },
  });

  if (!session) {
    logger.warn(
      { orderSessionId },
      "[Notification] notifyGenerationFailedButPreviousExists — session not found, skipping"
    );
    return { sent: false, reason: "session_not_found" };
  }
  if (!session.notificationEmail) {
    return { sent: false, reason: "no_recipient_email" };
  }

  const subject = `Regeneration hit a snag — your previous version is still there`;
  const html = renderEmailShell(
    renderGenerationFailedButPreviousExistsBody({
      childName: session.childName ?? "your child",
      comicTitle: session.comic.title,
    })
  );

  return safeSend(session.notificationEmail, subject, html);
}

/**
 * Fires when the PDF worker successfully compiles the final PDF.
 * Called from pdfWorker after the compile-and-upload succeeds.
 */
export async function notifyPdfReady(orderId: string): Promise<NotifyResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      notificationEmail: true,
      orderSession: {
        select: {
          childName: true,
          comic: { select: { title: true } },
        },
      },
    },
  });

  if (!order) {
    logger.warn(
      { orderId },
      "[Notification] notifyPdfReady — order not found, skipping"
    );
    return { sent: false, reason: "order_not_found" };
  }
  if (!order.notificationEmail) {
    return { sent: false, reason: "no_recipient_email" };
  }

  const subject = `${order.orderSession.childName}'s book is being prepared!`;
  const html = renderEmailShell(
    renderPdfReadyBody({
      childName: order.orderSession.childName ?? "your child",
      comicTitle: order.orderSession.comic.title,
    })
  );

  return safeSend(order.notificationEmail, subject, html);
}

/**
 * Fires when the Shiprocket webhook flips Order.status to SHIPPED.
 * Called from processShiprocketStatusUpdate.
 *
 * Includes a tracking link. If Order.trackingUrl is null (webhook fired
 * before refresh-tracking populated it), we fetch on-demand and persist
 * so future calls are fast.
 */
export async function notifyOrderShipped(orderId: string): Promise<NotifyResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      notificationEmail: true,
      courierName: true,
      awbNumber: true,
      orderSession: {
        select: {
          childName: true,
          comic: { select: { title: true } },
        },
      },
    },
  });

  if (!order) {
    logger.warn(
      { orderId },
      "[Notification] notifyOrderShipped — order not found, skipping"
    );
    return { sent: false, reason: "order_not_found" };
  }
  if (!order.notificationEmail) {
    return { sent: false, reason: "no_recipient_email" };
  }

  const trackingUrl = await resolveTrackingUrl(orderId);

  const subject = `${order.orderSession.childName}'s book has shipped!`;
  const html = renderEmailShell(
    renderOrderShippedBody({
      childName: order.orderSession.childName ?? "your child",
      comicTitle: order.orderSession.comic.title,
      courierName: order.courierName,
      awbNumber: order.awbNumber,
      trackingUrl,
    })
  );

  return safeSend(order.notificationEmail, subject, html);
}

/**
 * Fires when the Shiprocket webhook flips Order.status to DELIVERED.
 * Called from processShiprocketStatusUpdate.
 */
export async function notifyOrderDelivered(
  orderId: string
): Promise<NotifyResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      notificationEmail: true,
      orderSession: {
        select: {
          childName: true,
          comic: { select: { title: true } },
        },
      },
    },
  });

  if (!order) {
    logger.warn(
      { orderId },
      "[Notification] notifyOrderDelivered — order not found, skipping"
    );
    return { sent: false, reason: "order_not_found" };
  }
  if (!order.notificationEmail) {
    return { sent: false, reason: "no_recipient_email" };
  }

  const subject = `${order.orderSession.childName}'s book has arrived!`;
  const html = renderEmailShell(
    renderOrderDeliveredBody({
      childName: order.orderSession.childName ?? "your child",
      comicTitle: order.orderSession.comic.title,
    })
  );

  return safeSend(order.notificationEmail, subject, html);
}