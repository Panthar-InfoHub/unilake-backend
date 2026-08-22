import { getRoom } from "./rooms.js";
import { logger } from "../lib/logger.js";

export function emitPageReady(
  sessionId: string,
  payload: {
    pageNumber: number;
    variantIndex: number;
    /** Print-resolution PNG. Multi-megabyte — do not render this in a browser. */
    imageUrl: string;
    /**
     * Web-sized WebP derivative — this is what a client should display.
     * Null when the derivative could not be built, in which case fall back
     * to `imageUrl`.
     */
    displayImageUrl: string | null;
    pageVersionId: string;
  }
) {
  const sockets = getRoom(sessionId);

  if (!sockets) {
    logger.debug(
      { sessionId },
      "EmitPageReady : No sockets is connected, skipping"
    );
    return;
  }

  const message = JSON.stringify({ type: "page:ready", ...payload });

  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

export function emitPageError(
  sessionId: string,
  payload: {
    pageNumber: number;
    variantIndex: number;
    errorMessage: string;
  }
) {
  const sockets = getRoom(sessionId);

  if (!sockets) {
    logger.debug({ sessionId }, "emitPageError: no sockets connected, skipping");
    return;
  }

  const message = JSON.stringify({ type: "page:error", ...payload });

  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

export function emitSessionPreviewReady(sessionId: string) {
  const sockets = getRoom(sessionId);

  if (!sockets) {
    logger.debug(
      { sessionId },
      "emitSessionPreviewReady: no sockets connected, skipping",
    );
    return;
  }

  const message = JSON.stringify({ type: "session:preview-ready" });

  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

export function emitSessionPaidReady(sessionId: string) {
  const sockets = getRoom(sessionId);

  if (!sockets) {
    logger.debug(
      { sessionId },
      "emitSessionPaidReady: no sockets connected, skipping",
    );
    return;
  }

  const message = JSON.stringify({ type: "session:paid-ready" });

  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}