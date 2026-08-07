// will hold the HTTP client for RunPod

import { config } from "../../../config/env.js";
import { logger } from "../../../lib/logger.js";
import { AppError } from "../../../utils/errors.js";

const RUNPOD_BASE_URL = "https://api.runpod.ai/v2";

// Polling settings — DECISIONS locks these:
//   - Interval 5s: RunPod recommends >=1s, warm jobs take ~90s, so ~18 polls typical
//   - Max attempts: safety bound in case a job never resolves. 200 * 5s = ~17 min.
//     The endpoint's own executionTimeout is 600s so a real job should FAIL long
//     before we hit this — but we still bound the loop in case of a stuck response.
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 200;

type RunPodStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

// All four response shapes flattened into one type.
// Some fields only appear in certain states — hence the `?`.
type RunPodStatusResponse = {
  id: string;
  status: RunPodStatus;
  delayTime?: number;
  executionTime?: number;
  workerId?: string;
  output?: {
    images: Array<{
      data: string; // base64
      filename: string;
      type: "base64";
    }>;
  };
  error?: string;
};

type RunPodSubmitResponse = {
  id: string;
  status: string;
};

export type SubmitParams = {
  workflow: object; // the patched workflow from buildWorkflow()
  images: Array<{
    name: string; // MUST match filenames used in the workflow's LoadImage nodes
    image: string; // raw base64, no data URI prefix
  }>;
};

export type JobResult = {
  imageBuffer: Buffer; // the face-swapped result
  jobId: string; // for logging/traceability
  delayTimeMs: number;
  executionTimeMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send the job to RunPod's /run endpoint. Returns immediately with a jobId.
 * Does NOT wait for the job to complete — that's what pollUntilDone does.
 */

async function submit(params: SubmitParams): Promise<string> {
  const url = `${RUNPOD_BASE_URL}/${config.runpod.endpointId}/run`;

  const payload = {
    input: {
      workflow: params.workflow,
      images: params.images,
    },
  };

  logger.debug(
    { url, imageCount: params.images.length },
    "Submitting job to RunPod"
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.runpod.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(
      { status: res.status, body: body.substring(0, 500) },
      "RunPod /run rejected the submission"
    );
    throw new AppError(
      `RunPod submission failed with status ${res.status}: ${body.substring(0, 200)}`,
      502,
      "RUNPOD_SUBMIT_FAILED"
    );
  }

  const data = (await res.json()) as RunPodSubmitResponse;

  logger.info(
    { jobId: data.id, initialStatus: data.status },
    "RunPod job submitted"
  );
  return data.id;
}

/**
 * One-shot status check for a submitted job.
 */

async function fetchStatus(jobId: string): Promise<RunPodStatusResponse> {
  const url = `${RUNPOD_BASE_URL}/${config.runpod.endpointId}/status/${jobId}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.runpod.apiKey}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error(
      { jobId, status: res.status, body: body.substring(0, 500) },
      "RunPod /status returned non-OK"
    );
    throw new AppError(
      `RunPod status check failed with HTTP ${res.status}`,
      502,
      "RUNPOD_STATUS_FAILED"
    );
  }
  return (await res.json()) as RunPodStatusResponse;
}

/**
 * Poll RunPod's status endpoint every POLL_INTERVAL_MS until the job resolves.
 * Throws on FAILED, CANCELLED, or if we exhaust MAX_POLL_ATTEMPTS.
 */

async function pollUntilDone(jobId: string): Promise<RunPodStatusResponse> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetchStatus(jobId);

    if (response.status === "COMPLETED") {
      logger.info(
        {
          jobId,
          attempts: attempt,
          delayTimeMs: response.delayTime,
          executionTimeMs: response.executionTime,
        },
        "RunPod job completed"
      );
      return response;
    }
    if (response.status === "FAILED" || response.status === "CANCELLED") {
      const errorMessage = response.error ?? "Unknown RunPod failure";
      logger.error(
        { jobId, status: response.status, error: errorMessage },
        "RunPod job did not complete successfully"
      );
      throw new AppError(
        `RunPod job ${response.status.toLowerCase()}: ${errorMessage}`,
        502,
        "RUNPOD_JOB_FAILED"
      );
    }

    // Still IN_QUEUE or IN_PROGRESS — keep waiting
    logger.debug(
      { jobId, attempt, status: response.status },
      "RunPod job still running"
    );
    await sleep(POLL_INTERVAL_MS);
  }

  // Ran out of attempts
  logger.error(
    { jobId, maxAttempts: MAX_POLL_ATTEMPTS },
    "RunPod polling exhausted attempts without resolution"
  );
  throw new AppError(
    `RunPod job did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
    504,
    "RUNPOD_POLL_TIMEOUT"
  );
}

/**
 * Decode RunPod's base64 output back into a Buffer.
 * The response's images[0].data is raw base64 — no `data:` URI prefix.
 */
function decodeResultImage(response: RunPodStatusResponse): Buffer {
  const image = response.output?.images?.[0];
  if (!image?.data) {
    logger.error({ response }, "RunPod COMPLETED response missing image data");
    throw new AppError(
      "RunPod completed but returned no image in output.images[0].data",
      502,
      "RUNPOD_MALFORMED_OUTPUT",
    );
  }

  return Buffer.from(image.data, "base64");
}

/**
 * Submit a job to RunPod, poll until it finishes, and return the result image.
 * This is the ONLY function Part E should import from this file.
 */
export async function submitAndAwaitResult(params: SubmitParams): Promise<JobResult> {
  const jobId = await submit(params);
  const finalResponse = await pollUntilDone(jobId);
  const imageBuffer = decodeResultImage(finalResponse);

  return {
    imageBuffer,
    jobId,
    delayTimeMs: finalResponse.delayTime ?? 0,
    executionTimeMs: finalResponse.executionTime ?? 0,
  };
}
