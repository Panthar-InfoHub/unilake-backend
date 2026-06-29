import { z } from "zod";

export const createSessionSchema = z.object({
  comicId: z.string().uuid(),
});

export const updateSessionSchema = z.object({
  childName: z.string().min(1).max(50).optional(),
  age: z.number().int().min(0).max(18).optional(),
  pronounKey: z.enum(['HE', 'SHE', 'THEY']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});


export const photoUploadUrlSchema = z.object({
  fileExtension: z.enum(['jpg', 'jpeg', 'png', 'webp'], {
    message: "Invalid file extension. Must be strictly jpg, jpeg, png, or webp.",
  }),
});

export const photoValidateSchema = z.object({
  key: z.string({ message: "Upload key is required." }).min(1, "Upload key cannot be empty."),
});


export type PhotoValidateInput = z.infer<typeof photoValidateSchema>;
export type PhotoUploadUrlInput = z.infer<typeof photoUploadUrlSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;