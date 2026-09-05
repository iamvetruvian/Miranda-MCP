import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { db } from "@/db"
import { carts, products } from "@/db/schema"
import { eq, inArray } from "drizzle-orm"
import { generateId } from "@/lib/id"
import { authenticateApiRequest } from "@/lib/api-auth"

async function resolveCartResponse(cart: typeof carts.$inferSelect) {
  const rawItems = cart.items || []
  if (rawItems.length === 0) {
    return {
      id: cart.id,
      cart_id: cart.id,
      items: [],
      total: 0,
    }
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

  return {
    id: cart.id,
    cart_id: cart.id,
    items: enrichedItems,
    total: Math.round(total * 100),
  }
}

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url)
    const cartId =
      searchParams.get("cart_id") ||
      searchParams.get("cartId") ||
      cookies().get("cartId")?.value

    if (!cartId) {
      return NextResponse.json({
        id: "",
        cart_id: "",
        items: [],
        total: 0,
      })
    }

    const cart = await db.query.carts.findFirst({
      where: eq(carts.id, cartId),
    })

    if (!cart || cart.closed) {
      return NextResponse.json({
        id: cartId,
        cart_id: cartId,
        items: [],
        total: 0,
      })
    }

    const res = await resolveCartResponse(cart)
    return NextResponse.json(res)
  } catch (err: any) {
    console.error("GET /api/cart error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

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

    const body = await request.json()
    const productId = body.productId || body.id || body.product_id
    const quantity = Math.max(1, Number(body.quantity || 1))

    if (!productId) {
      return NextResponse.json({ error: "Missing productId" }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    let cartId =
      body.cart_id ||
      body.cartId ||
      searchParams.get("cart_id") ||
      cookies().get("cartId")?.value

    if (cartId && cartId.length > 30) {
      cartId = cartId.slice(0, 30)
    }

    let cart = cartId
      ? await db.query.carts.findFirst({ where: eq(carts.id, cartId) })
      : null

    if (!cart || cart.closed) {
      cartId = cartId || generateId("cart")
      const inserted = await db
        .insert(carts)
        .values({
          id: cartId,
          items: [{ productId, quantity }],
        })
        .returning()
      cart = inserted[0]
    } else {
      const existingItems = cart.items || []
      const existingIdx = existingItems.findIndex((it) => it.productId === productId)
      if (existingIdx > -1) {
        existingItems[existingIdx].quantity += quantity
      } else {
        existingItems.push({ productId, quantity })
      }
      const updated = await db
        .update(carts)
        .set({ items: existingItems })
        .where(eq(carts.id, cart.id))
        .returning()
      cart = updated[0]
    }

    const resData = await resolveCartResponse(cart)
    const response = NextResponse.json(resData)
    response.cookies.set("cartId", cart.id, { path: "/", httpOnly: false })
    return response
  } catch (err: any) {
    console.error("POST /api/cart error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const productId = body.productId || body.id || body.product_id
    const quantity = Number(body.quantity ?? 1)
    const { searchParams } = new URL(request.url)
    const cartId =
      body.cart_id ||
      body.cartId ||
      searchParams.get("cart_id") ||
      cookies().get("cartId")?.value

    if (!cartId) {
      return NextResponse.json({ error: "Missing cartId" }, { status: 400 })
    }

    const cart = await db.query.carts.findFirst({ where: eq(carts.id, cartId) })
    if (!cart) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 })
    }

    let items = cart.items || []
    if (quantity <= 0) {
      items = items.filter((it) => it.productId !== productId)
    } else {
      const idx = items.findIndex((it) => it.productId === productId)
      if (idx > -1) {
        items[idx].quantity = quantity
      } else {
        items.push({ productId, quantity })
      }
    }

    const updated = await db
      .update(carts)
      .set({ items })
      .where(eq(carts.id, cart.id))
      .returning()

    const resData = await resolveCartResponse(updated[0])
    return NextResponse.json(resData)
  } catch (err: any) {
    console.error("PATCH /api/cart error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    let body: any = {}
    try {
      body = await request.json()
    } catch { }

    const cartId =
      body.cart_id ||
      body.cartId ||
      searchParams.get("cart_id") ||
      cookies().get("cartId")?.value

    const productId = body.productId || body.id || searchParams.get("productId")

    if (!cartId) {
      return NextResponse.json({ error: "Missing cartId" }, { status: 400 })
    }

    const cart = await db.query.carts.findFirst({ where: eq(carts.id, cartId) })
    if (!cart) {
      return NextResponse.json({ success: true, items: [] })
    }

    if (productId) {
      const items = (cart.items || []).filter((it) => it.productId !== productId)
      const updated = await db
        .update(carts)
        .set({ items })
        .where(eq(carts.id, cart.id))
        .returning()
      const resData = await resolveCartResponse(updated[0])
      return NextResponse.json(resData)
    } else {
      await db.delete(carts).where(eq(carts.id, cart.id))
      return NextResponse.json({ success: true, id: cart.id, items: [], total: 0 })
    }
  } catch (err: any) {
    console.error("DELETE /api/cart error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
