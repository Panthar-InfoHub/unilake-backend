import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { sendEmail } from "../lib/email.js";
import { config } from "../config/env.js";

// ============================================================
// NOTIFICATION SERVICE — Layer 3
// ============================================================
//
// Six transactional emails to the customer, one per milestone:
//
//   1. notifyPreviewReady      — free preview pages finished      → preview link
//   2. notifyPaymentReceived   — Razorpay payment captured        → preview link
//   3. notifyBookReady         — every paid page finished         → preview link
//   4. notifySentToPrint       — customer committed send-to-print → preview link
//   5. notifyAwbGenerated      — admin packed it, AWB assigned    → tracking link
//   6. notifyOrderDelivered    — Shiprocket reported delivery
//
// Not endpoints. Called fire-and-forget from workers, webhook handlers and
// admin flows. Every function follows the same shape:
//   1. Load the minimum data needed for the email
//   2. Build subject + HTML via a template function
//   3. Send via sendEmail (which handles retries)
//   4. Return { sent: true, messageId } or { sent: false, reason } — never throws
//
// Callers still attach a .catch() and swallow: email failure MUST NOT block
// business logic. See Decision D of the notifyUser design.
//
// Exactly-once is the CALLER's job — sendEmail is not idempotent. Each call
// site sits behind a status-guarded flip or webhook dedupe that only one
// invocation can win; see the comment at each call site.
//
// Recipient: OrderSession.notificationEmail, falling back to the Order's
// checkout-time snapshot. The session copy is deliberately left editable after
// payment ("never printed"), so it is the customer's latest choice.

// ============================================================
// SHARED HELPERS
// ============================================================

/**
 * Escapes text for safe interpolation into HTML (element content AND quoted
 * attribute values). Child names come straight from the personalize form, so
 * an unescaped `<` there would let a customer inject markup into an email we
 * send under our own domain.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subjects are plain text, but a newline in a header is never wanted. */
function cleanSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").trim();
}

/** "Aarav's" — or "Your child's" when the session has no name. Unescaped. */
function possessive(childName: string | null): string {
  const name = childName?.trim();
  return name ? `${name}'s` : "Your child's";
}

/** The customer's preview page for a session — where links 1–4 land. */
function previewUrl(sessionId: string): string {
  return `${config.frontendUrl}/personalize/${encodeURIComponent(sessionId)}/preview`;
}

/** The session's current address, else the Order's checkout-time copy. */
function resolveRecipient(
  sessionEmail: string | null | undefined,
  orderEmail?: string | null
): string | null {
  return sessionEmail?.trim() || orderEmail?.trim() || null;
}

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
    <title>Unilake Kids</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:32px 40px 16px 40px;border-bottom:1px solid #eee;">
                <div style="font-size:22px;font-weight:600;color:#1a1a1a;">Unilake Kids</div>
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
                <div style="margin-top:8px;">© Unilake Kids</div>
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
 * The one call-to-action style used by every email. Inline styles only —
 * Gmail strips <style> blocks.
 *
 * The button alone, no raw URL beneath it. Plain-text-only clients still get
 * the address: htmlToPlainText in lib/email.ts renders every link as
 * "label: url" when it builds the text part.
 */
function renderButton(href: string, label: string): string {
  return `
    <p style="margin:24px 0;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(label)}</a>
    </p>
  `.trim();
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
    const result = await sendEmail({ to, subject: cleanSubject(subject), html });
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

/** Everything the session-keyed emails (1–4) need, in one query. */
async function loadSessionContext(orderSessionId: string) {
  return prisma.orderSession.findUnique({
    where: { id: orderSessionId },
    select: {
      id: true,
      notificationEmail: true,
      childName: true,
      comic: { select: { title: true } },
      order: { select: { notificationEmail: true } },
    },
  });
}

/** Everything the order-keyed emails (5–6) need, in one query. */
async function loadOrderContext(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      notificationEmail: true,
      courierName: true,
      awbNumber: true,
      trackingUrl: true,
      orderSession: {
        select: {
          id: true,
          notificationEmail: true,
          childName: true,
          comic: { select: { title: true } },
        },
      },
    },
  });
}

// ============================================================
// EMAIL TEMPLATES (per-notification body builders)
// ============================================================
//
// Every interpolated value is escaped here, at the point of use — the
// callers pass raw strings.

type BodyArgs = { childName: string | null; comicTitle: string };

function renderPreviewReadyBody(args: BodyArgs & { link: string }): string {
  return `
    <p>Hi,</p>
    <p><strong>${escapeHtml(possessive(args.childName))} preview is ready!</strong></p>
    <p>The first pages of <em>${escapeHtml(args.comicTitle)}</em> have been created. Take a look, pick your favourite version of each page, and order the full book when you're happy.</p>
    ${renderButton(args.link, "See the preview")}
    <p>— The Unilake Kids team</p>
  `.trim();
}

function renderPaymentReceivedBody(args: BodyArgs & { link: string }): string {
  return `
    <p>Hi,</p>
    <p><strong>Thank you — we've received your payment.</strong></p>
    <p>We're now creating the rest of <em>${escapeHtml(args.comicTitle)}</em>. You can watch the pages appear as they're made — we'll email you again once the whole book is ready.</p>
    ${renderButton(args.link, "Watch the progress")}
    <p>— The Unilake Kids team</p>
  `.trim();
}

function renderBookReadyBody(args: BodyArgs & { link: string }): string {
  return `
    <p>Hi,</p>
    <p><strong>${escapeHtml(possessive(args.childName))} full book is ready!</strong></p>
    <p>Every page of <em>${escapeHtml(args.comicTitle)}</em> has been created. Go through the book, choose your favourite version of each page, and send it to print.</p>
    <p>Nothing will be printed until you press <strong>Send to Print</strong>.</p>
    ${renderButton(args.link, "Choose your pages")}
    <p>— The Unilake Kids team</p>
  `.trim();
}

function renderSentToPrintBody(args: BodyArgs & { link: string }): string {
  return `
    <p>Hi,</p>
    <p><strong>${escapeHtml(possessive(args.childName))} book is off to print!</strong></p>
    <p>We've received your final pages for <em>${escapeHtml(args.comicTitle)}</em> and are preparing them for printing. We'll email you again as soon as it's packed and ready to ship.</p>
    ${renderButton(args.link, "View your book")}
    <p>— The Unilake Kids team</p>
  `.trim();
}

function renderAwbGeneratedBody(
  args: BodyArgs & {
    courierName: string | null;
    awbNumber: string | null;
    trackingUrl: string | null;
  }
): string {
  const courierLine = args.courierName
    ? `<p>Courier: <strong>${escapeHtml(args.courierName)}</strong>${
        args.awbNumber ? ` &middot; AWB: <code>${escapeHtml(args.awbNumber)}</code>` : ""
      }</p>`
    : args.awbNumber
      ? `<p>AWB: <code>${escapeHtml(args.awbNumber)}</code></p>`
      : "";

  const trackingBlock = args.trackingUrl
    ? `${renderButton(args.trackingUrl, "Track your parcel")}
       <p style="font-size:14px;color:#666;">Tracking updates appear once the courier collects the parcel.</p>`
    : "";

  return `
    <p>Hi,</p>
    <p><strong>${escapeHtml(possessive(args.childName))} book is packed and ready to ship!</strong></p>
    <p>Your copy of <em>${escapeHtml(args.comicTitle)}</em> has been printed, packed, and booked with the courier for pickup.</p>
    ${courierLine}
    ${trackingBlock}
    <p>— The Unilake Kids team</p>
  `.trim();
}

function renderOrderDeliveredBody(args: BodyArgs): string {
  return `
    <p>Hi,</p>
    <p><strong>${escapeHtml(possessive(args.childName))} book has arrived!</strong></p>
    <p>We hope <em>${escapeHtml(args.comicTitle)}</em> brings a big smile. If anything's not right with your copy, just reply to this email — we'll sort it out.</p>
    <p>Would love to see a photo if you feel like sharing!</p>
    <p>— The Unilake Kids team</p>
  `.trim();
}

// ============================================================
// PUBLIC API — one function per milestone
// ============================================================

/**
 * 1. Free preview pages finished. Pre-payment, so there is no Order — the
 * session's address is the only one.
 * Caller: generationWorker, on maybeMarkPreviewComplete → "ready".
 */
export async function notifyPreviewReady(
  orderSessionId: string
): Promise<NotifyResult> {
  const session = await loadSessionContext(orderSessionId);
  if (!session) {
    logger.warn({ orderSessionId }, "[Notification] notifyPreviewReady — session not found, skipping");
    return { sent: false, reason: "session_not_found" };
  }

  const to = resolveRecipient(session.notificationEmail);
  if (!to) return { sent: false, reason: "no_recipient_email" };

  return safeSend(
    to,
    `${possessive(session.childName)} preview is ready!`,
    renderEmailShell(
      renderPreviewReadyBody({
        childName: session.childName,
        comicTitle: session.comic.title,
        link: previewUrl(session.id),
      })
    )
  );
}

/**
 * 2. Razorpay payment captured and paid-page generation queued.
 * Caller: webhook.service handlePaymentCaptured, after the GENERATING_PAID flip.
 */
export async function notifyPaymentReceived(
  orderSessionId: string
): Promise<NotifyResult> {
  const session = await loadSessionContext(orderSessionId);
  if (!session) {
    logger.warn({ orderSessionId }, "[Notification] notifyPaymentReceived — session not found, skipping");
    return { sent: false, reason: "session_not_found" };
  }

  const to = resolveRecipient(session.notificationEmail, session.order?.notificationEmail);
  if (!to) return { sent: false, reason: "no_recipient_email" };

  return safeSend(
    to,
    `Payment received — we're creating ${possessive(session.childName).replace(/^Your/, "your")} book`,
    renderEmailShell(
      renderPaymentReceivedBody({
        childName: session.childName,
        comicTitle: session.comic.title,
        link: previewUrl(session.id),
      })
    )
  );
}

/**
 * 3. Every paid page finished — the customer now picks variants.
 * Caller: generationWorker, on maybeMarkPaidReady → "ready" (both the success
 * path and the failure-with-earlier-success edge).
 */
export async function notifyBookReady(
  orderSessionId: string
): Promise<NotifyResult> {
  const session = await loadSessionContext(orderSessionId);
  if (!session) {
    logger.warn({ orderSessionId }, "[Notification] notifyBookReady — session not found, skipping");
    return { sent: false, reason: "session_not_found" };
  }

  const to = resolveRecipient(session.notificationEmail, session.order?.notificationEmail);
  if (!to) return { sent: false, reason: "no_recipient_email" };

  return safeSend(
    to,
    `${possessive(session.childName)} full book is ready — pick your favourites`,
    renderEmailShell(
      renderBookReadyBody({
        childName: session.childName,
        comicTitle: session.comic.title,
        link: previewUrl(session.id),
      })
    )
  );
}

/**
 * 4. Customer committed their selections with Send to Print.
 * Caller: session.service sendToPrint, fresh-commit path only.
 */
export async function notifySentToPrint(
  orderSessionId: string
): Promise<NotifyResult> {
  const session = await loadSessionContext(orderSessionId);
  if (!session) {
    logger.warn({ orderSessionId }, "[Notification] notifySentToPrint — session not found, skipping");
    return { sent: false, reason: "session_not_found" };
  }

  const to = resolveRecipient(session.notificationEmail, session.order?.notificationEmail);
  if (!to) return { sent: false, reason: "no_recipient_email" };

  return safeSend(
    to,
    `${possessive(session.childName)} book is off to print!`,
    renderEmailShell(
      renderSentToPrintBody({
        childName: session.childName,
        comicTitle: session.comic.title,
        link: previewUrl(session.id),
      })
    )
  );
}

/**
 * 5. Admin entered final dimensions; AWB assigned and pickup scheduled.
 * Reads Order.trackingUrl, which Phase B writes alongside the AWB.
 * Caller: shiprocket.service pushDimensionsAssignAwbAndSchedulePickup.
 */
export async function notifyAwbGenerated(orderId: string): Promise<NotifyResult> {
  const order = await loadOrderContext(orderId);
  if (!order) {
    logger.warn({ orderId }, "[Notification] notifyAwbGenerated — order not found, skipping");
    return { sent: false, reason: "order_not_found" };
  }

  const to = resolveRecipient(order.orderSession.notificationEmail, order.notificationEmail);
  if (!to) return { sent: false, reason: "no_recipient_email" };

  return safeSend(
    to,
    `${possessive(order.orderSession.childName)} book is packed and ready to ship`,
    renderEmailShell(
      renderAwbGeneratedBody({
        childName: order.orderSession.childName,
        comicTitle: order.orderSession.comic.title,
        courierName: order.courierName,
        awbNumber: order.awbNumber,
        trackingUrl: order.trackingUrl,
      })
    )
  );
}

/**
 * 6. Shiprocket webhook flipped Order.status to DELIVERED.
 * Caller: shiprocket.service processShiprocketStatusUpdate.
 */
export async function notifyOrderDelivered(
  orderId: string
): Promise<NotifyResult> {
  const order = await loadOrderContext(orderId);
  if (!order) {
    logger.warn({ orderId }, "[Notification] notifyOrderDelivered — order not found, skipping");
    return { sent: false, reason: "order_not_found" };
  }

  const to = resolveRecipient(order.orderSession.notificationEmail, order.notificationEmail);
  if (!to) return { sent: false, reason: "no_recipient_email" };

  return safeSend(
    to,
    `${possessive(order.orderSession.childName)} book has arrived!`,
    renderEmailShell(
      renderOrderDeliveredBody({
        childName: order.orderSession.childName,
        comicTitle: order.orderSession.comic.title,
      })
    )
  );
}
