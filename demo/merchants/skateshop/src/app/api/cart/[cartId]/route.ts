import { NextResponse } from "next/server"
import { db } from "@/db"
import { carts, products } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { authenticateApiRequest } from "@/lib/api-auth"

export async function GET(
  request: Request,
  { params }: { params: { cartId: string } }
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

    let cartId = decodeURIComponent(params.cartId)
    if (cartId.length > 30) cartId = cartId.slice(0, 30)
    const cart = await db.query.carts.findFirst({
      where: eq(carts.id, cartId),
    })

    if (!cart) {
      return NextResponse.json({
        id: cartId,
        cart_id: cartId,
        items: [],
        total: 0,
      })
    }

    const rawItems = cart.items || []
    if (rawItems.length === 0) {
      return NextResponse.json({
        id: cart.id,
        cart_id: cart.id,
        items: [],
        total: 0,
      })
    }

    const productIds = rawItems.map((it) => it.productId)
    const productRecords = await db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        images: products.images,
      })
      .from(products)
      .where(inArray(products.id, productIds))

    const productMap = new Map(productRecords.map((p) => [p.id, p]))

    let total = 0
    const enrichedItems = rawItems.map((it) => {
      const p = productMap.get(it.productId)
      const priceNum = p ? Number(p.price) : 0
      total += priceNum * it.quantity
      return {
        productId: it.productId,
        quantity: it.quantity,
        name: p?.name || "Unknown Product",
        price: Math.round(priceNum * 100),
        images: p?.images || [],
      }
    })

    return NextResponse.json({
      id: cart.id,
      cart_id: cart.id,
      items: enrichedItems,
      total: Math.round(total * 100),
    })
  } catch (err: any) {
    console.error("GET /api/cart/[cartId] error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
