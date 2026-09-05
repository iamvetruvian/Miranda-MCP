import { NextResponse } from "next/server"
import { db } from "@/db"
import { carts, products } from "@/db/schema"
import { eq } from "drizzle-orm"
import { generateId } from "@/lib/id"
import { authenticateApiRequest } from "@/lib/api-auth"

export async function POST(request: Request) {
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

    const body = (await request.json()) as Record<string, any>
    const rawItems = Array.isArray(body.items) ? body.items : (body.items ? [body.items] : [])
    let storeId = body.storeId || body.store_id

    // Resolve products and total
    let total = 0
    const resolvedItems = []

    for (const item of rawItems) {
      const pId = item.id || item.productId || item.product_id
      const qty = Number(item.quantity || 1)
      let price = Number(item.price || 0)

      if (pId) {
        const product = await db.query.products.findFirst({
          where: eq(products.id, pId),
        })
        if (product) {
          if (!storeId) storeId = product.storeId
          if (!price) price = Number(product.price)
          total += price * qty
          resolvedItems.push({
            productId: pId,
            name: product.name,
            price,
            quantity: qty,
          })
        }
      }
    }

    if (!storeId) storeId = "str_baker_skate"
    if (total === 0) total = 65.00

    const checkoutId = generateId("cart")
    const paymentIntentId = `pi_${generateId("payment")}`
    const clientSecret = `${paymentIntentId}_secret_${generateId()}`
    const paymentUrl = `http://localhost:3000/checkout/${storeId}?checkout_id=${checkoutId}`

    // Persist or update cart
    const cartId = body.cartId || body.cart_id
    if (cartId) {
      await db
        .update(carts)
        .set({
          paymentIntentId,
          clientSecret,
          items: resolvedItems.length > 0 ? resolvedItems : undefined,
        })
        .where(eq(carts.id, cartId))
        .catch(() => {})
    } else {
      await db
        .insert(carts)
        .values({
          id: checkoutId,
          paymentIntentId,
          clientSecret,
          items: resolvedItems.length > 0 ? resolvedItems : [{ productId: "prd_deck_og", quantity: 1 }],
          closed: false,
        })
        .catch((e) => console.warn("Could not insert checkout cart:", e))
    }

    return NextResponse.json({
      id: checkoutId,
      checkout_id: checkoutId,
      paymentUrl,
      payment_url: paymentUrl,
      amount: total,
      currency: "USD",
      clientSecret,
      client_secret: clientSecret,
      stripePaymentIntentId: paymentIntentId,
      stripePaymentIntentStatus: "requires_payment_method",
      items: resolvedItems.length > 0 ? resolvedItems : [{ productId: "prd_deck_og", quantity: 1, price: total }],
      status: "payment_pending",
    })
  } catch (err: any) {
    console.error("POST /api/checkout error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
