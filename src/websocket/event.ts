import { getRoom } from "./rooms.js";
import { logger } from "../lib/logger.js";

export function emitPageReady(
  sessionId: string,
  payload: {
    pageNumber: number;
    variantIndex: number;
    imageUrl: string;
    pageVersionId: string;
  }
) {
  const sockets = getRoom(sessionId);

  if (!sockets) {
    logger.info(
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
    logger.info({ sessionId }, "emitPageError: no sockets connected, skipping");
    return;
  }

  const message = JSON.stringify({ type: "page:error", ...payload });

  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}
