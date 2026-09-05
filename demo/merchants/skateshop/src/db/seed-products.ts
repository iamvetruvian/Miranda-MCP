import { db } from "@/db"
import { categories, products, stores, subcategories } from "@/db/schema"
import { eq } from "drizzle-orm"

async function runSeed() {
  console.log("⏳ Seeding stores and sample products...")

  // Clear existing
  await db.delete(products)
  await db.delete(stores)

  const store1Id = "str_baker_skate"
  const store2Id = "str_street_culture"

  await db.insert(stores).values([
    {
      id: store1Id,
      userId: "user_demo_1",
      name: "Baker Skate Co.",
      slug: "baker-skate-co",
      description: "Authentic street skateboards, hardware and accessories.",
      plan: "standard",
      stripeAccountId: "acct_demo_1",
    },
    {
      id: store2Id,
      userId: "user_demo_2",
      name: "Street Culture Goods",
      slug: "street-culture-goods",
      description: "Premium apparel, skate footwear and streetwear gear.",
      plan: "pro",
      stripeAccountId: "acct_demo_2",
    },
  ])
  console.log("✅ Stores seeded!")

  const allCategories = await db.select().from(categories)
  const allSubcategories = await db.select().from(subcategories)

  const catMap = new Map(allCategories.map((c) => [c.slug, c.id]))
  const subMap = new Map(allSubcategories.map((s) => [s.slug, s.id]))

  const sampleProducts = [
    // Skateboards
    {
      id: "prd_deck_og",
      name: "Baker Brand Logo OG Deck 8.25",
      description:
        "Traditional 7-ply North American maple deck with mellow concave.",
      cat: "skateboards",
      sub: "decks",
      price: "65.00",
      image: "/images/categories/deck-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_deck_element",
      name: "Element Section Complete Skateboard 8.0",
      description:
        "Ready to ride right out of the box with premium trucks and wheels.",
      cat: "skateboards",
      sub: "decks",
      price: "110.00",
      image: "/images/categories/skateboard-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_wheels_spitfire",
      name: "Spitfire Formula Four Classic Wheels 54mm",
      description:
        "Unmatched flatspot resistance and smooth slide performance.",
      cat: "skateboards",
      sub: "wheels",
      price: "42.00",
      image: "/images/categories/wheel-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_trucks_indy",
      name: "Independent Stage 11 Hollow Trucks 149",
      description:
        "Lightweight hollow axle and kingpin for superior turning response.",
      cat: "skateboards",
      sub: "trucks",
      price: "58.00",
      image: "/images/categories/truck-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_bearings_bones",
      name: "Bones Reds Precision Bearings (8-Pack)",
      description:
        "Inspected twice before release for the best combination of speed and durability.",
      cat: "skateboards",
      sub: "bearings",
      price: "24.00",
      image: "/images/categories/bearing-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_griptape_mob",
      name: "Mob Perforated Grip Tape Sheet 9x33",
      description:
        "Micro-perforations prevent air bubbles during grip tape installation.",
      cat: "skateboards",
      sub: "griptape",
      price: "12.00",
      image: "/images/categories/griptape-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_hardware_diamond",
      name: "Diamond Hella Tight Hardware 1-inch",
      description:
        "High-grade steel bolts with nylon locknuts for maximum security.",
      cat: "skateboards",
      sub: "hardware",
      price: "8.00",
      image: "/images/categories/hardware-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_tool_silver",
      name: "Silver All-In-One Ratchet Skate Tool",
      description:
        "Universal skateboard tool featuring a precision reversible ratchet.",
      cat: "skateboards",
      sub: "tools",
      price: "22.00",
      image: "/images/categories/tool-one.webp",
      storeId: store1Id,
    },

    // Clothing
    {
      id: "prd_hoodie_thrasher",
      name: "Thrasher Flame Logo Heavyweight Pullover",
      description: "Iconic flame print across chest with fleece-lined interior.",
      cat: "clothing",
      sub: "hoodies",
      price: "75.00",
      image: "/images/categories/clothing-one.webp",
      storeId: store2Id,
    },
    {
      id: "prd_tee_spitfire",
      name: "Spitfire Bighead Classic Cotton Tee",
      description: "100% pre-shrunk cotton with screen-printed chest graphic.",
      cat: "clothing",
      sub: "t-shirts",
      price: "34.00",
      image: "/images/categories/clothing-one.webp",
      storeId: store2Id,
    },
    {
      id: "prd_pants_volcom",
      name: "Volcom Frickin Modern Stretch Chino Pants",
      description:
        "Durable stretch twill designed to withstand everyday skateboarding.",
      cat: "clothing",
      sub: "pants",
      price: "68.00",
      image: "/images/categories/clothing-one.webp",
      storeId: store2Id,
    },
    {
      id: "prd_hat_stussy",
      name: "Stussy Stock Low Pro Strapback Cap",
      description: "Unstructured 6-panel cap with embroidered signature logo.",
      cat: "clothing",
      sub: "hats",
      price: "42.00",
      image: "/images/categories/clothing-one.webp",
      storeId: store2Id,
    },

    // Shoes
    {
      id: "prd_shoe_dunk",
      name: "Nike SB Dunk Low Pro Summit White",
      description:
        "Zoom Air unit in the heel and a padded tongue for skate sessions.",
      cat: "shoes",
      sub: "low-tops",
      price: "115.00",
      image: "/images/categories/shoes-one.webp",
      storeId: store2Id,
    },
    {
      id: "prd_shoe_halfcab",
      name: "Vans Skate Half Cab 33 DX",
      description:
        "Upgraded DURACAP underlays and POPCUSH cushioning for board feel.",
      cat: "shoes",
      sub: "high-tops",
      price: "85.00",
      image: "/images/categories/shoes-two.webp",
      storeId: store2Id,
    },
    {
      id: "prd_shoe_slipon",
      name: "Vans Skate Slip-On Black/White Checkerboard",
      description:
        "Redesigned uppers and molded heel counter for locked-in fit.",
      cat: "shoes",
      sub: "slip-ons",
      price: "70.00",
      image: "/images/categories/shoes-one.webp",
      storeId: store2Id,
    },
    {
      id: "prd_shoe_busenitz",
      name: "Adidas Skateboarding Busenitz Pro",
      description:
        "GEOFIT collar and recessed eyelets inspired by classic football boots.",
      cat: "shoes",
      sub: "pros",
      price: "95.00",
      image: "/images/categories/shoes-two.webp",
      storeId: store2Id,
    },

    // Accessories
    {
      id: "prd_acc_courthouse",
      name: "Nike SB Courthouse Daypack Backpack",
      description:
        "Dedicated external skateboard straps and water-resistant bottom panel.",
      cat: "accessories",
      sub: "backpacks",
      price: "55.00",
      image: "/images/categories/backpack-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_acc_carhartt",
      name: "Carhartt WIP Essentials Heavy Shoulder Bag",
      description:
        "Water-repellent recycled canvas with dual main compartments.",
      cat: "accessories",
      sub: "backpacks",
      price: "48.00",
      image: "/images/categories/backpack-two.webp",
      storeId: store2Id,
    },
    {
      id: "prd_acc_socks",
      name: "Santa Cruz Classic Dot Athletic Socks (3-Pack)",
      description:
        "Cushioned footbed and ribbed arch support for maximum impact absorption.",
      cat: "accessories",
      sub: "socks",
      price: "20.00",
      image: "/images/categories/backpack-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_acc_wax",
      name: "Shake Junt Curbs & Ledges Skate Wax",
      description:
        "Formulated for ultra-slick slides and grinds on rough concrete.",
      cat: "accessories",
      sub: "wax",
      price: "10.00",
      image: "/images/categories/backpack-two.webp",
      storeId: store1Id,
    },
    {
      id: "prd_acc_tool",
      name: "Unit All-In-One Heavy Duty Skate Tool",
      description:
        "Universal skate tool with 3 socket sizes and slide-out screwdriver.",
      cat: "accessories",
      sub: "skate-tools",
      price: "18.00",
      image: "/images/categories/tool-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_acc_bushings",
      name: "Bones HardCore Medium Bushings 91A",
      description:
        "Patented chemically bonded core for responsive and smooth turning.",
      cat: "accessories",
      sub: "bushings",
      price: "14.00",
      image: "/images/categories/bearing-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_acc_risers",
      name: "Independent 1/8 Shock & Riser Pads",
      description:
        "Reduces stress cracks and prevents wheel bite on larger wheel setups.",
      cat: "accessories",
      sub: "shock-riser-pads",
      price: "8.00",
      image: "/images/categories/hardware-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_acc_rails",
      name: "Pig Wheels Pig Rails Rib Bones",
      description:
        "Ultra high-molecular polyethylene rails with self-tapping wood screws.",
      cat: "accessories",
      sub: "skate-rails",
      price: "16.00",
      image: "/images/categories/deck-one.webp",
      storeId: store1Id,
    },
    {
      id: "prd_cloth_shorts",
      name: "Volcom Solver Denim Skate Shorts",
      description:
        "Modern fit denim shorts with indestructible dual front and back pockets.",
      cat: "clothing",
      sub: "shorts",
      price: "55.00",
      image: "/images/categories/clothing-one.webp",
      storeId: store2Id,
    },
    {
      id: "prd_shoe_classics",
      name: "Vans Authentic Core Classic Canvas",
      description:
        "The original heritage low-top silhouette with waffle rubber outsoles.",
      cat: "shoes",
      sub: "classics",
      price: "60.00",
      image: "/images/categories/shoes-two.webp",
      storeId: store2Id,
    },
  ]

  const productRows = sampleProducts.map((p) => {
    const categoryId = catMap.get(p.cat)
    const subcategoryId = subMap.get(p.sub) ?? null

    if (!categoryId) {
      throw new Error(`Category not found: ${p.cat}`)
    }

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      images: [
        {
          id: `img_${p.id}`,
          name: `${p.name}.webp`,
          url: p.image,
        },
      ],
      categoryId,
      subcategoryId,
      price: p.price,
      originalPrice: p.price,
      inventory: 50,
      rating: 5,
      status: "active" as const,
      storeId: p.storeId,
    }
  })

  console.log(`📝 Inserting ${productRows.length} products...`)
  await db.insert(products).values(productRows)
  console.log("✅ Sample products seeded successfully!")
  process.exit(0)
}

runSeed().catch((err) => {
  console.error("❌ Seed failed:", err)
  process.exit(1)
})
