import { NextResponse } from "next/server"
import { db } from "@/db"
import { orders } from "@/db/schema"
import { eq } from "drizzle-orm"
import { authenticateApiRequest } from "@/lib/api-auth"
import { stripe } from "@/lib/stripe"

export async function POST(
  request: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    const authCtx = await authenticateApiRequest(request)
    if (!authCtx) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          category: "auth_failed",
          message: "Authentication required or token invalid for Skateshop",
        },
        { status: 401 }
      )
    }

    const orderId = decodeURIComponent(params.orderId)
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    })

    if (order?.stripePaymentIntentId && order.stripePaymentIntentId.startsWith("pi_") && !order.stripePaymentIntentId.includes("sim")) {
      try {
        await stripe.refunds.create({
          payment_intent: order.stripePaymentIntentId,
        })
      } catch (refundErr) {
        console.warn("Could not create Stripe refund on order cancel:", refundErr)
      }
    }

    await db
      .update(orders)
      .set({ stripePaymentIntentStatus: "canceled" })
      .where(eq(orders.id, orderId))
      .catch(() => {})

    return NextResponse.json({
      id: orderId,
      order_id: orderId,
      status: "cancelled",
      stripePaymentIntentStatus: "canceled",
      message: "Order successfully cancelled and refunded",
    })
  } catch (err: any) {
    console.error("POST /api/orders/[orderId]/cancel error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
