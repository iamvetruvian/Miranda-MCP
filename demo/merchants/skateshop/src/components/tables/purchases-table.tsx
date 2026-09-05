"use client"

import * as React from "react"
import Link from "next/link"
import { type Order } from "@/db/schema"
import type { StripePaymentStatus } from "@/types"
import { DotsHorizontalIcon } from "@radix-ui/react-icons"
import { type ColumnDef } from "@tanstack/react-table"
import { useDataTable } from "@/hooks/use-data-table"

import {
  getStripePaymentStatusColor,
} from "@/lib/checkout"
import { cn, formatDate, formatId, formatPrice } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"

export type AwaitedOrder = Pick<
  Order,
  "id" | "email" | "items" | "amount" | "createdAt" | "storeId"
> & {
  status: Order["stripePaymentIntentStatus"]
  store: string | null
}

interface PurchasesTableProps {
  promise: Promise<{
    data: AwaitedOrder[]
    pageCount: number
  }>
}

export function PurchasesTable({ promise }: PurchasesTableProps) {
  const { data, pageCount } = React.use(promise)

  // Memoize the columns so they don't re-render on every render
  const columns = React.useMemo<ColumnDef<AwaitedOrder, unknown>[]>(
    () => [
      {
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Order ID" />
        ),
        cell: ({ cell }) => {
          return <span>{formatId(String(cell.getValue()))}</span>
        },
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Payment Status" />
        ),
        cell: ({ cell }) => {
          return (
            <Badge
              variant="outline"
              className={cn(
                "pointer-events-none text-sm capitalize text-white",
                getStripePaymentStatusColor({
                  status: cell.getValue() as StripePaymentStatus,
                  shade: 600,
                })
              )}
            >
              {String(cell.getValue())}
            </Badge>
          )
        },
      },
      {
        accessorKey: "store",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Store Name" />
        ),
        cell: ({ cell }) => (
          <span>{String(cell.getValue() || "Baker Skate Co.")}</span>
        ),
      },
      {
        accessorKey: "items",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Quantity" />
        ),
        cell: ({ cell }) => {
          const val = cell.getValue()
          const items = Array.isArray(val)
            ? val
            : typeof val === "string"
              ? (() => {
                  try {
                    return JSON.parse(val)
                  } catch {
                    return []
                  }
                })()
              : []

          const totalQty = (items as any[]).reduce(
            (acc: number, item: any) => acc + Number(item.quantity || 1),
            0
          )

          return <span>{totalQty || 1}</span>
        },
      },
      {
        accessorKey: "amount",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Amount" />
        ),
        cell: ({ cell }) => formatPrice(Number(cell.getValue()) || 0),
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created At" />
        ),
        cell: ({ cell }) => {
          const val = cell.getValue()
          return formatDate(val instanceof Date ? val : new Date(String(val)))
        },
        enableColumnFilter: false,
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Open menu"
                variant="ghost"
                className="flex size-8 p-0 data-[state=open]:bg-muted"
              >
                <DotsHorizontalIcon className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[160px]">
              <DropdownMenuItem asChild>
                <Link href={`/dashboard/purchases/${row.original.id}`}>
                  Purchase details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/products?store_ids=${row.original.storeId}`}>
                  View store
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    []
  )

  const { table } = useDataTable({
    data,
    columns,
    pageCount,
  })

  return <DataTable table={table} />
}
