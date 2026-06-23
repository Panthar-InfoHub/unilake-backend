import { Worker, type Job } from "bullmq";
import { redisClient } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";

export const pdfWorker = new Worker(
  "pdf-compilation",
  async (job: Job) => {
    logger.info({ jobId: job.id, name: job.name }, "[PDF Worker] Picked up new job");
    
    await new Promise((resolve) => setTimeout(resolve, 500));

    logger.info({ jobId: job.id }, "[PDF Worker] Stub processing complete");
    return { success: true, message: "PDF compilation stub completed" };
  },
  { connection: redisClient, concurrency: 5 }
);

pdfWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "[PDF Worker] Job failed");
});