import { NextResponse } from "next/server"
import { db } from "@/db"
import { carts } from "@/db/schema"
import { eq } from "drizzle-orm"

export async function GET(
  request: Request,
  { params }: { params: { checkoutId: string } }
) {
  try {
    const checkoutId = decodeURIComponent(params.checkoutId)
    const cart = await db.query.carts.findFirst({
      where: eq(carts.id, checkoutId),
    })

    const paymentIntentId = cart?.paymentIntentId || `pi_${checkoutId}`
    const clientSecret = cart?.clientSecret || `${paymentIntentId}_secret_demo`

    return NextResponse.json({
      id: checkoutId,
      checkout_id: checkoutId,
      paymentUrl: `http://localhost:3000/checkout/str_baker_skate?checkout_id=${checkoutId}`,
      amount: 65.00,
      currency: "USD",
      clientSecret,
      stripePaymentIntentId: paymentIntentId,
      stripePaymentIntentStatus: "requires_payment_method",
      status: "payment_pending",
    })
  } catch (err: any) {
    console.error("GET /api/checkout/[checkoutId] error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
