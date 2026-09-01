/**
 * Connector Schema Validators
 * Validates that mapped responses meet canonical structure and domain invariants.
 */

import { z } from "zod";

export const MoneySchema = z.object({
  amount: z.number().int().nonnegative({ message: "Money amount must be a non-negative integer in sub-units" }),
  currency: z.string().min(1, { message: "Currency code is required" }),
});

export const OfferSchema = z.object({
  offer_id: z.string().min(1, { message: "offer_id must be a non-empty string" }),
  title: z.string().min(1, { message: "title must be a non-empty string" }),
  description: z.string().default(""),
  price: MoneySchema,
  availability: z.union([
    z.enum(["in_stock", "out_of_stock", "limited", "available", "sold_out"]),
    z.string(),
  ]),
  attributes: z.record(z.unknown()).default({}),
  images: z.array(z.string()).optional(),
  expires_at: z.string().optional(),
  semantic: z.object({ type: z.string(), properties: z.record(z.unknown()) }).optional(),
  variants: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        required: z.boolean(),
        options: z.array(
          z.object({
            value: z.string(),
            label: z.string(),
            available: z.boolean().optional(),
          })
        ),
        affects_price: z.boolean().optional(),
        affects_availability: z.boolean().optional(),
      })
    )
    .optional(),
  pricing_info: z
    .object({
      model: z.string(),
      tiers: z
        .array(
          z.object({
            min_quantity: z.number(),
            max_quantity: z.number().optional(),
            per_unit_amount: z.number().optional(),
          })
        )
        .optional(),
      subscription_periods: z.array(z.string()).optional(),
      prices_include_tax: z.boolean().optional(),
      tax_display: z.string().optional(),
    })
    .optional(),
  add_ons: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        price: MoneySchema,
        description: z.string().optional(),
      })
    )
    .optional(),
  stock_count: z.number().optional(),
  media: z
    .object({
      images: z.array(z.string()).optional(),
      video_url: z.string().optional(),
      thumbnail: z.string().optional(),
    })
    .optional(),
});

export const CheckoutResponseSchema = z.object({
  checkout_id: z.string().min(1, { message: "checkout_id is required" }),
  sku: z.string().optional(),
  title: z.string().optional(),
  unit_price: MoneySchema.optional(),
  total: MoneySchema,
  available: z.boolean(),
  expires_at: z.string().optional(),
});

export const OrderConfirmationSchema = z.object({
  order_id: z.string().min(1, { message: "order_id is required" }),
  status: z.string().min(1, { message: "order status is required" }),
  confirmed_at: z.string().optional(),
});
