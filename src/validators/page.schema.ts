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

export const updatePageSchema = z.object({
  hasFace: z.boolean().optional(),
  mirrorFace: z.boolean().optional(),
  faceDirection: z.enum(["front", "three-quarter", "side"]).nullable().optional(),
  isPreviewPage: z.boolean().optional(),
  pagePrompt: z.string().min(1).nullable().optional(),
  artworkUrl: z.string().min(1).optional(),
  maskUrl: z.string().min(1).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type GetPageArtworkUploadUrlInput = z.infer<typeof getPageArtworkUploadUrlSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
