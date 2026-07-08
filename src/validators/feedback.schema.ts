import { z } from "zod";

export const createFeedbackSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().trim().min(1, "Phone number is required"),
  message: z.string().trim().min(1, "Message is required"),
});

export const feedbackFilterQuerySchema = z.object({
  status: z
    .enum(["OPEN", "VIEWED", "RESOLVED", "DISMISSED"], {
      message: "Invalid status. Must be OPEN, VIEWED, RESOLVED, or DISMISSED.",
    })
    .optional(),
});

export const updateFeedbackStatusSchema = z.object({
  status: z.enum(["OPEN", "VIEWED", "RESOLVED", "DISMISSED"], {
    message: "Status must be OPEN, VIEWED, RESOLVED, or DISMISSED",
  }),
});