import { z } from "zod";

export const createAddressSchema = z.object({
  label: z.string().min(1).max(50).optional(),
  name: z.string().min(1, "Recipient name is required").max(100),
  line1: z.string().min(1, "Address line 1 is required").max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1, "City is required").max(100),
  state: z.string().min(1, "State is required").max(100),
  zip: z.string().min(1, "ZIP/postal code is required").max(20),
  country: z.string().length(2, "Must be a 2-letter ISO country code"),
  phone: z.string().min(5, "Phone number too short").max(20, "Phone number too long"),
});

export const updateAddressSchema = z.object({
  label: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  line1: z.string().min(1).max(200).optional(),
  line2: z.string().max(200).nullable().optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(100).optional(),
  zip: z.string().min(1).max(20).optional(),
  country: z.string().length(2, "Must be a 2-letter ISO country code").optional(),
  phone: z.string().min(5).max(20).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided",
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;