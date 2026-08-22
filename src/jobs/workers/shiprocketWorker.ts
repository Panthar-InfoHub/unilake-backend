import { Worker, type Job } from "bullmq";
import { redisClient } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

/**
 * STUB Shiprocket worker — replaced by feature #4.
 *
 * Assumes every Shiprocket order creation succeeds. Flips session
 * SHIPMENT_QUEUED -> COMPLETED so the state machine can be observed
 * end-to-end while the real integration is being built.
 *
 * Real worker (feature #4) will:
 *   - call Shiprocket API to create the order
 *   - save shiprocketOrderId on the Order row
 *   - flip Order.status GENERATED -> READY_TO_SHIP
 *   - flip session SHIPMENT_QUEUED -> COMPLETED on success
 *   - flip both to *_FAILED on final retry exhaustion
 */

export const shiprocketWorker = new Worker(
  "shiprocket",
  async (job: Job<{ orderSessionId: string }>) => {
    const { orderSessionId } = job.data;

    logger.info(
      { jobId: job.id, orderSessionId },
      "[Shiprocket Worker STUB] Picked up shipment job"
    );

    // Stub: flip session SHIPMENT_QUEUED -> COMPLETED.
    // Status guard is IN the query so a retry after our own flip is a no-op.
    const { count } = await prisma.orderSession.updateMany({
      where: { id: orderSessionId, status: "SHIPMENT_QUEUED" },
      data: { status: "COMPLETED" },
    });

    if (count === 0) {
      // Either session isn't at SHIPMENT_QUEUED (unusual — maybe a manual
      // status change or a retry after a prior success) or the session
      // doesn't exist. Log and no-op rather than crash.
      logger.warn(
        { orderSessionId, jobId: job.id },
        "[Shiprocket Worker STUB] Session not at SHIPMENT_QUEUED — no-op"
      );
      return { success: true, noop: true };
    }

    logger.info(
      { jobId: job.id, orderSessionId },
      "[Shiprocket Worker STUB] Session flipped to COMPLETED"
    );

    return { success: true };
  },
  { connection: redisClient, concurrency: 5 }
);

shiprocketWorker.on("failed", (job, err) => {
  logger.error(
    { jobId: job?.id, orderSessionId: job?.data?.orderSessionId, err },
    "[Shiprocket Worker STUB] Job failed"
  );
});