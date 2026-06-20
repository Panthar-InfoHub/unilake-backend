import { Worker, type Job } from "bullmq";
import { redisClient } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";

export const sdWorker = new Worker(
  "sd-generation",
  async (job: Job) => {
    logger.info(
      { jobId: job.id, name: job.name },
      "[SD Worker] Picked up new job"
    );
    logger.debug({ payload: job.data }, "[SD Worker] Job payload data");

    // Placeholder: Simulate a slight delay to mimic network routing
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Future logic goes here: Fetch from R2, send to ComfyUI, wait for webhook/polling

    logger.info({ jobId: job.id }, "[SD Worker] Stub processing complete");
    return { success: true, message: "SD generation stub completed" };
  },
  { connection: redisClient as any, concurrency: 3 }
);

// Monitor for unexpected failures
sdWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "❌ [SD Worker] Job failed");
});
