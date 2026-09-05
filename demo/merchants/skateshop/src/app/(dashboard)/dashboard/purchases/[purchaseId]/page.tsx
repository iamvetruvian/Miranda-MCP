import { type Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/db"
import { addresses, orders, stores } from "@/db/schema"
import { env } from "@/env.js"
import { eq } from "drizzle-orm"

import { getOrderLineItems } from "@/lib/actions/order"
import { cn, formatDate, formatId, formatPrice } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Icons } from "@/components/icons"
import { Shell } from "@/components/shell"

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: "Purchase Details",
  description: "View your purchase details",
}

interface PurchasePageProps {
  params: {
    purchaseId: string
  }
}

export default async function PurchasePage({ params }: PurchasePageProps) {
  const orderId = decodeURIComponent(params.purchaseId)

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  })

  if (!order) {
    notFound()
  }

  const [store, address, orderLineItems] = await Promise.all([
    order.storeId
      ? db.query.stores.findFirst({
          where: eq(stores.id, order.storeId),
        })
      : null,
    order.addressId
      ? db.query.addresses.findFirst({
          where: eq(addresses.id, order.addressId),
        })
      : null,
    getOrderLineItems({
      items: order.items as any,
      storeId: order.storeId,
    }),
  ])

  const isSucceeded = order.stripePaymentIntentStatus === "succeeded"
  const isCanceled = order.stripePaymentIntentStatus === "canceled"

  const totalItemsCount = orderLineItems.reduce(
    (acc, item) => acc + (item.quantity ?? 1),
    0
  )

  return (
    <Shell variant="sidebar">
      <div className="flex flex-col gap-6">
        {/* Navigation & Header */}
        <div className="flex flex-col gap-3">
          <Link
            href="/dashboard/purchases"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <Icons.chevronLeft className="size-4" />
            Back to Purchases
          </Link>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Purchase {formatId(orderId)}
                </h1>
                <Badge
                  variant={isSucceeded ? "default" : "secondary"}
                  className={cn(
                    "capitalize px-2.5 py-0.5 text-xs font-semibold",
                    isSucceeded &&
                      "bg-emerald-600 hover:bg-emerald-600 text-white dark:bg-emerald-600",
                    isCanceled &&
                      "bg-red-600 hover:bg-red-600 text-white dark:bg-red-600"
                  )}
                >
                  {isSucceeded
                    ? "Paid"
                    : isCanceled
                      ? "Canceled"
                      : order.stripePaymentIntentStatus}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Placed on{" "}
                {order.createdAt
                  ? formatDate(order.createdAt, {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Recently"}
              </p>
            </div>
          </div>
        </div>

        {/* 2-Column Responsive Layout */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Column (Left 2 cols on desktop) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* Items Purchased Card */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Items Purchased</CardTitle>
                <CardDescription>
                  {totalItemsCount} item{totalItemsCount === 1 ? "" : "s"} from{" "}
                  <span className="font-medium text-foreground">
                    {store?.name ?? "Store"}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {orderLineItems.length > 0 ? (
                  <div className="divide-y divide-border">
                    {orderLineItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                      >
                        <div className="flex items-start space-x-4">
                          <div className="relative aspect-square size-16 min-w-16 overflow-hidden rounded-md border bg-secondary">
                            {item.images?.length ? (
                              <Image
                                src={
                                  item.images[0]?.url ??
                                  "/images/product-placeholder.webp"
                                }
                                alt={item.images[0]?.name ?? item.name}
                                sizes="64px"
                                fill
                                className="object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center">
                                <Icons.placeholder
                                  className="size-6 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col space-y-1">
                            <Link
                              href={`/product/${item.id}`}
                              className="font-medium hover:underline text-sm leading-tight"
                            >
                              {item.name}
                            </Link>
                            <span className="text-xs text-muted-foreground">
                              Qty: {item.quantity}
                            </span>
                            {item.category && (
                              <span className="text-xs capitalize text-muted-foreground">
                                {item.category}
                                {item.subcategory
                                  ? ` / ${item.subcategory}`
                                  : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end space-y-1 text-right">
                          <span className="text-sm font-semibold">
                            {formatPrice(
                              (
                                Number(item.price) * (item.quantity ?? 1)
                              ).toFixed(2)
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatPrice(item.price)} each
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4">
                    No items found for this order.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Shipping and Customer Cards Grid */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icons.store className="size-4 text-muted-foreground" />
                    Delivery Address
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    {order.name || "Customer"}
                  </p>
                  {address?.line1 ? <p>{address.line1}</p> : null}
                  {address?.line2 ? <p>{address.line2}</p> : null}
                  {address?.city || address?.state || address?.postalCode ? (
                    <p>
                      {[address?.city, address?.state, address?.postalCode]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                  {address?.country ? <p>{address.country}</p> : null}
                  {!address?.line1 && (
                    <p className="text-xs italic text-muted-foreground">
                      Standard shipping to customer
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icons.avatar className="size-4 text-muted-foreground" />
                    Customer Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-3">
                  <div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block">
                      Name
                    </span>
                    <span className="text-foreground font-medium">
                      {order.name || "Customer"}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block">
                      Email
                    </span>
                    <span className="text-foreground font-medium break-all">
                      {order.email}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Right Column: Order Summary */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Order Summary</CardTitle>
                <CardDescription>Payment breakdown & receipt</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="text-foreground font-medium">
                    {formatPrice(order.amount)}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Shipping</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    Free
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Estimated Tax</span>
                  <span className="text-foreground font-medium">
                    Included
                  </span>
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between text-base font-bold text-foreground">
                  <span>Total Paid</span>
                  <span className="text-xl font-bold">
                    {formatPrice(order.amount)}
                  </span>
                </div>

                <Separator className="my-2" />

                <div className="space-y-2.5 pt-2 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold uppercase tracking-wider text-muted-foreground block mb-0.5">
                      Payment Method
                    </span>
                    <span className="text-foreground font-medium">
                      Stripe Card Checkout
                    </span>
                  </div>

                  {order.stripePaymentIntentId && (
                    <div>
                      <span className="font-semibold uppercase tracking-wider text-muted-foreground block mb-0.5">
                        Payment Intent ID
                      </span>
                      <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded break-all text-foreground">
                        {order.stripePaymentIntentId}
                      </code>
                    </div>
                  )}

                  {store?.name && (
                    <div>
                      <span className="font-semibold uppercase tracking-wider text-muted-foreground block mb-0.5">
                        Merchant
                      </span>
                      <span className="text-foreground font-medium">
                        {store.name}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-2 pt-2">
                <Link
                  href="/products"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full text-center"
                  )}
                >
                  Continue Shopping
                </Link>
                <Link
                  href="/dashboard/purchases"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "w-full text-center"
                  )}
                >
                  View All Purchases
                </Link>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </Shell>
  )
}
