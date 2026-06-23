import { logger } from "../../lib/logger.js";
import { hdWorker } from "./hdWorker.js";
import { pdfWorker } from "./pdfWorker.js";
import { sdWorker } from "./sdWorker.js";

/**
 * Initializes all background workers and registers graceful shutdown handlers.
 */
export const initJobs = () => {
  logger.info("Initializing background job workers...");

  // Instantiate/activate the workers by referencing them
  const workers = [sdWorker, hdWorker, pdfWorker];

  logger.info(`All ${workers.length} workers are actively listening to their respective queues.`);

  // Setup graceful shutdown handlers so active jobs aren't brutally cut off during server restarts
  const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Closing background workers gracefully...`);
    
    // Close all workers in parallel
    await Promise.all(workers.map(worker => worker.close()));
    
    logger.info("All background workers closed cleanly.");
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
};