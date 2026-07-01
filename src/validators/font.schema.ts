import {z} from "zod";

export const getFontUploadUrlSchema = z.object({
  fileName: z.string().min(1),
  fileExtension: z.enum(["ttf", "otf", "woff", "woff2"]),
});

export const createFontSchema = z.object({
  name: z.string().min(1),
  fontKey: z.string().min(1),
});

export type GetFontUploadUrlInput = z.infer<typeof getFontUploadUrlSchema>;
export type CreateFontInput = z.infer<typeof createFontSchema>;