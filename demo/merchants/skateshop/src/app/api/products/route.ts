import { NextResponse } from "next/server"
import { db } from "@/db"
import { categories, products, stores, subcategories } from "@/db/schema"
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q") || searchParams.get("query") || ""
    const page = Math.max(1, Number(searchParams.get("page") || 1))
    const perPage = Math.max(1, Math.min(50, Number(searchParams.get("per_page") || 10)))
    const offset = (page - 1) * perPage
    const sort = searchParams.get("sort") || "createdAt.desc"
    const category = searchParams.get("categories") || searchParams.get("category")
    const priceRange = searchParams.get("price_range")

    const conditions = []
    if (q.trim()) {
      conditions.push(
        or(
          ilike(products.name, `%${q.trim()}%`),
          ilike(products.description, `%${q.trim()}%`)
        )
      )
    }
    if (category) {
      const catSlugs = category.split(".")
      conditions.push(
        or(
          inArray(products.categoryId, catSlugs),
          inArray(categories.slug, catSlugs)
        )
      )
    }
    if (priceRange) {
      const [min, max] = priceRange.split("-").map(Number)
      if (!isNaN(min)) conditions.push(gte(products.price, String(min)))
      if (!isNaN(max)) conditions.push(lte(products.price, String(max)))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const [rawColumn, order] = sort.split(".")
    const column = (rawColumn in products ? rawColumn : "createdAt") as keyof typeof products.$inferSelect

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
      .limit(perPage)
      .offset(offset)
      .leftJoin(stores, eq(products.storeId, stores.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(subcategories, eq(products.subcategoryId, subcategories.id))
      .where(whereClause)
      .orderBy(order === "asc" ? asc(products[column]) : desc(products[column]))

    const totalRes = await db
      .select({ count: count(products.id) })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(whereClause)

    const total = totalRes[0]?.count ?? items.length
    const pageCount = Math.ceil(total / perPage)

    // Normalize images so images[0].url is always valid
    const formattedData = items.map((item) => {
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
      return {
        ...item,
        images: parsedImages,
      }
    })

    return NextResponse.json({
      data: formattedData,
      pageCount,
      total,
    })
  } catch (err: any) {
    console.error("GET /api/products error:", err)
    return NextResponse.json({ error: err.message, data: [], pageCount: 0 }, { status: 500 })
  }
}
