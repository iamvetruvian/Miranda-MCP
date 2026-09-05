import { NextResponse } from "next/server"
import { db } from "@/db"
import { categories, products, stores, subcategories } from "@/db/schema"
import { eq } from "drizzle-orm"

export async function GET(
  request: Request,
  { params }: { params: { productId: string } }
) {
  try {
    const productId = decodeURIComponent(params.productId)

    const items = await db
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        images: products.images,
        category: categories.name,
        subcategory: subcategories.name,
        price: products.price,
        inventory: products.inventory,
        rating: products.rating,
        storeId: products.storeId,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        stripeAccountId: stores.stripeAccountId,
      })
      .from(products)
      .leftJoin(stores, eq(products.storeId, stores.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(subcategories, eq(products.subcategoryId, subcategories.id))
      .where(eq(products.id, productId))
      .limit(1)

    const item = items[0]
    if (!item) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    let parsedImages = item.images
    if (typeof parsedImages === "string") {
      try {
        parsedImages = JSON.parse(parsedImages)
      } catch {
        parsedImages = null
      }
    }
    if (!Array.isArray(parsedImages) || parsedImages.length === 0) {
      parsedImages = [{ id: "default", name: item.name, url: "/images/product-placeholder.webp" }]
    } else {
      parsedImages = parsedImages.map((img: any, idx: number) => ({
        id: img?.id || `img_${idx}`,
        name: img?.name || item.name,
        url: img?.url || "/images/product-placeholder.webp",
      }))
    }

    return NextResponse.json({
      ...item,
      images: parsedImages,
    })
  } catch (err: any) {
    console.error("GET /api/products/[productId] error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
