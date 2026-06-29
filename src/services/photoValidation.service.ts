export interface PhotoValidationResult {
  passed: boolean;
  score: number;
  checks: Record<string, boolean>;
}

export async function runPhotoValidation(photoKey: string): Promise<PhotoValidationResult> {
  // STUB — Day 4 replaces this with a real execFile call to the
  // Python OpenCV/MediaPipe/DeepFace pipeline. The shape returned
  // here is the locked contract Day 4's real version must match.
  await new Promise((resolve) => setTimeout(resolve, 300));

  return {
    passed: true,
    score: 0.92,
    checks: {
      faceDetected: true,
      singleFace: true,
      eyesOpen: true,
      goodLighting: true,
      notBlurry: true,
    },
  };
}