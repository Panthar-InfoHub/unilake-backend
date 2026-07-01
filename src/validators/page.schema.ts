import {z} from "zod"


export const createPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  artworkUrl: z.string().min(1).optional(),
  maskUrl: z.string().min(1).optional(),
  hasFace: z.boolean().default(false),
  mirrorFace: z.boolean().default(false),
  faceDirection: z.enum(["front", "three-quarter", "side"]).optional(),
  isPreviewPage: z.boolean().default(false),
  pagePrompt: z.string().min(1).optional(),
});

export const getPageArtworkUploadUrlSchema = z.object({
  fileExtension: z.enum(["jpg", "jpeg", "png", "webp"]),
  fileType: z.enum(["artwork", "masks"]),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type GetPageArtworkUploadUrlInput = z.infer<typeof getPageArtworkUploadUrlSchema>;
