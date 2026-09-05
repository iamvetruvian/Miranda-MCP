import * as z from "zod"

export const getOrderLineItemsSchema = z.object({
  storeId: z.string().optional(),
  items: z.union([z.string(), z.array(z.any())]).optional().nullable(),
})

export const verifyOrderSchema = z.object({
  deliveryPostalCode: z.string().min(1, {
    message: "Please enter a valid postal code",
  }),
})
