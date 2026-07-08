import { z } from "zod";

export const getTeamMemberUploadUrlSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  contentType: z
    .string()
    .regex(
      /^image\/(png|jpeg|jpg|webp)$/,
      "Only PNG, JPEG, and WEBP images are allowed"
    ),
});

export const createTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  role: z.string().trim().min(1, "Role is required"),
  description: z.string().trim().min(1).optional(),
  imageKey: z.string().min(1).optional(),
  linkedinUrl: z.string().url("Invalid LinkedIn URL").optional(),
  instagramUrl: z.string().url("Invalid Instagram URL").optional(),
  twitterUrl: z.string().url("Invalid Twitter/X URL").optional(),
});


export const updateTeamMemberSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    imageKey: z.string().min(1).optional(),
    linkedinUrl: z.string().url("Invalid LinkedIn URL").optional(),
    instagramUrl: z.string().url("Invalid Instagram URL").optional(),
    twitterUrl: z.string().url("Invalid Twitter/X URL").optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided to update",
  });