import { z } from "zod";

export const createSessionSchema = z.object({
  comicId: z
    .string({ message: "Comic ID is required." })
    .uuid("Invalid Comic ID format. Must be a valid UUID."),
    
  childName: z
    .string({ message: "Child name is required." })
    .min(1, "Child name cannot be empty.")
    .max(50, "Child name must be 50 characters or less."),

  age: z
    .number({ message: "Age is required." })
    .int("Age must be a whole number.")
    .min(0, "Age cannot be negative.")
    .max(18, "Age must be 18 or younger."),
    
  pronounKey: z.enum(["HE", "SHE", "THEY"] as const, {
    message: "Pronoun key is required and must be strictly HE, SHE, or THEY.",
  }),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;