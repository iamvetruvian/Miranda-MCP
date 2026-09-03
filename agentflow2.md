




I want you to find any iPhones on Proshop using the Proshop MCP

Worked for 18s
I'll search Proshop for iPhones.

MCP
Proshop
·
Search products
Result
{
  "search_id": "srch_ab1ec8d5-40ba-46b3-9c8b-0e8651577279",
  "offers": [
    {
      "offer_id": "6a95d2acbdbb84526fb232c2",
      "title": "iPhone 13 Pro 256GB Memory",
      "description": "Introducing the iPhone 13 Pro. A transformative triple-camera system that adds tons of capability without complexity. An unprecedented leap in battery life",
      "price": {
        "amount": 59999,
        "currency": "INR"
      },
      "availability": "in_stock",
      "attributes": {
        "brand": "Apple",
        "category": "Electronics",
        "rating": 4,
        "numReviews": 8,
        "countInStock": 7,
        "image": "/images/phone.jpg"
      }
    }
  ],
  "total_results": 1,
  "refinements": [
    {
      "key": "brand",
      "label": "Brand",
      "type": "enum",
      "multi_select": true,
      "options": [
        {
          "value": "Apple",
          "label": "Apple",
          "count": 1
        }
      ],
      "option_count": 1,
      "has_more": false
    },
    {
      "key": "category",
      "label": "Category",
      "type": "enum",
      "multi_select": true,
      "options": [
        {
          "value": "Electronics",
          "label": "Electronics",
          "count": 1
        }
      ],
      "option_count": 1,
      "has_more": false
    }
  ],
  "sort_options": [
    {
      "key": "relevance",
      "label": "Relevance"
    },
    {
      "key": "top_rated",
      "label": "Top Rated"
    }
  ],
  "page_info": {
    "page": 1,
    "page_size": 8,
    "has_more": false
  }
}
Description
Search the merchant's catalog. Returns matching offers (any commerce domain: products, rides, tickets, bookings...), pricing, availability, and dynamically discovered refinements. Supply `parameters` as declared in get_merchant_info → discovery_schema for non-retail domains.

Parameters
{
  "query": "iPhone"
}

Thought
·
a few seconds
One result. Report it.
Proshop has exactly one iPhone in its catalog:

iPhone 13 Pro 256GB — ₹59,999 (INR), in stock (7 units)
Triple-camera system, noted for battery life
Apple brand, Electronics category
Rated 4 out of 5 from 8 reviews
That's the only match — no other iPhone models or variants are listed. If you'd like, I can pull the full product details or add it to a cart.

Can you buy me one?

Worked for 1m 9s

Thought
·
a few seconds
The user wants to buy an iPhone 13 Pro. The purchase flow: prepare_purchase. First purchase typically goes to hosted payment link (Mode B) — it will return a consent_url. Also there's a check_auth_status maybe. Let me just call prepare_purchase. Actually, should I confirm first? The user explicitly asked "Can you buy me one?" — that's explicit authorization. Proceed.

Note: payment via hosted link requires user action; I can't complete payment autonomously without saved token. Let me check auth status first, then prepare purchase.
I'll start the checkout for the iPhone 13 Pro. First let me check if there's an active Proshop session.

MCP
Proshop
·
Check auth status
Result
{
  "authenticated": true,
  "session_id": "sess_c934a4c2-9c2c-47f5-86db-0c9b1f533850",
  "user_id": "6a95d2acbdbb84526fb232be",
  "user_name": "John Doe",
  "session_expires_at": "2026-10-01T10:16:11.928Z",
  "token_expires_at": "2026-10-01T10:16:11.928Z"
}
Description
Check current user authentication status with this merchant. Returns whether an active user session exists, user profile info, or an authorization URL if unauthenticated.

Parameters
{}

Thought
·
a few seconds
You're signed in as John Doe, so I'll proceed with the purchase.

MCP
Proshop
·
Prepare purchase
Result
{
  "transaction_id": "txn_dbc2832d-5575-4b95-89cf-ebeb7b4fe38f",
  "state": "PAYMENT_PENDING",
  "checkout": {
    "checkout_id": "6a98294b38b321df7c6575ed",
    "sku": "6a95d2acbdbb84526fb232c2",
    "unit_price": {
      "amount": 68999,
      "currency": "INR"
    },
    "total": {
      "amount": 68999,
      "currency": "INR"
    }
  },
  "payment": {
    "status": "user_action_required",
    "payment_url": "http://localhost:3002/pay?order_id=order_TXBs1ylpyjZsCI&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_dbc2832d-5575-4b95-89cf-ebeb7b4fe38f",
    "razorpay_order_id": "order_TXBs1ylpyjZsCI",
    "methods": {
      "payment_link": {
        "url": "http://localhost:3002/pay?order_id=order_TXBs1ylpyjZsCI&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_dbc2832d-5575-4b95-89cf-ebeb7b4fe38f",
        "description": "Open this hosted URL in browser to complete payment"
      },
      "checkout_sdk": {
        "razorpay_key_id": "rzp_test_TVVFU5yXYmeSCq",
        "razorpay_order_id": "order_TXBs1ylpyjZsCI",
        "amount": 68999,
        "currency": "INR",
        "merchant_name": "ProShop Electronics",
        "description": "Purchase: iPhone 13 Pro 256GB Memory (x1)",
        "instructions": "Use these parameters to render Razorpay Standard Checkout in a web/native host"
      }
    },
    "message": "Choose payment_link (open URL) or checkout_sdk (render native Razorpay Checkout)."
  },
  "policy": {
    "decision": "ALLOW",
    "checks": [
      {
        "gate": "RateLimitGate",
        "result": "PASS",
        "detail": "Rate limit check passed (59 tokens remaining)"
      },
      {
        "gate": "AbuseDetectionGate",
        "result": "PASS",
        "detail": "Abuse detection check passed: session in good standing"
      },
      {
        "gate": "AmountBoundsGate",
        "result": "PASS",
        "detail": "Checkout total of 689.99 INR is within authorized bounds"
      },
      {
        "gate": "CheckoutBindingGate",
        "result": "PASS",
        "detail": "Valid checkout binding \"6a98294b38b321df7c6575ed\" confirmed and unexpired"
      },
      {
        "gate": "TransactionStateGate",
        "result": "PASS",
        "detail": "Transaction state \"CHECKOUT_CREATED\" is valid for action \"CREATE_PAYMENT\""
      },
      {
        "gate": "RefundBoundsGate",
        "result": "PASS",
        "detail": "Not a refund action (\"CREATE_PAYMENT\")"
      },
      {
        "gate": "MandateGate",
        "result": "PASS",
        "detail": "Authorization layer disabled (auth_mode=none)"
      },
      {
        "gate": "MandateBoundsGate",
        "result": "PASS",
        "detail": "Authorization layer disabled (auth_mode=none)"
      },
      {
        "gate": "CurrencyConsistencyGate",
        "result": "PASS",
        "detail": "Currency \"INR\" matches merchant declaration"
      },
      {
        "gate": "IdempotencyGate",
        "result": "PASS",
        "detail": "Idempotency check passed for action \"CREATE_PAYMENT\""
      }
    ]
  },
  "ucp": {
    "checkout_status": "ready_for_complete"
  }
}
Description
Initiate an authoritative purchase and checkout flow for a product. Verifies stock with the merchant, creates an immutable checkout, executes policy evaluations, and completes payment autonomously via a saved recurring token + AP2 mandate or generates a hosted payment link.

AUTONOMOUS PAYMENT & MANDATE INSTRUCTIONS FOR BUYER AGENTS:
1. First Purchase (Manual Link + Token Registration): On first purchase, the user pays via a hosted payment link where they authorize an AutoPay/recurring mandate at their bank. The customer ID is automatically derived from the active user session.
2. Subsequent Purchases (Autonomous AP2 Checkout): The MCP automatically recognizes the user's saved recurring token from their session. You can call `create_mandate` first and pass `authorization_reference` here for instant zero-click checkout. If you omit `authorization_reference`, the tool returns a `consent_url` (Mode B JIT Consent) asking the user to approve the specific transaction amount.

Parameters
{
  "product_id": "6a95d2acbdbb84526fb232c2",
  "quantity": 1,
  "selection_reason": "User explicitly requested to buy one iPhone 13 Pro 256GB after searching the Proshop catalog; it is the only iPhone listed and is in stock.",
  "session_id": "sess_c934a4c2-9c2c-47f5-86db-0c9b1f533850"
}

Thought
·
a few seconds
The order is created but I need you to complete the payment — I can't do that step for you. Here's where things stand:

Item: iPhone 13 Pro 256GB × 1
Total: ₹68,999 INR — note this is higher than the ₹59,999 shown in search results, so the catalog price appears to have changed since the search (or the listed price excluded fees). I proceeded since you asked me to buy it, but flag it if that's not what you expected.
Transaction ID: txn_dbc2832d-5575-4b95-89cf-ebeb7b4fe38f
Status: Payment pending, all policy checks passed
To pay, open this hosted payment link in your browser: pay

Once you've paid, tell me and I'll confirm the transaction went through — or if you'd rather cancel (no money has moved yet), I can do that too.

pay
Website
payed

Worked for 48s

Thought
·
a few seconds
User says paid. Poll transaction status to confirm.
Let me verify the payment went through.

MCP
Proshop
·
Get transaction status
Result
{
  "transaction_id": "txn_dbc2832d-5575-4b95-89cf-ebeb7b4fe38f",
  "state": "ORDER_CONFIRMED",
  "created_at": "2026-09-02T13:48:59.656Z",
  "agent_claim": {
    "product_id": "6a95d2acbdbb84526fb232c2",
    "quantity": 1,
    "selection_reason": "User explicitly requested to buy one iPhone 13 Pro 256GB after searching the Proshop catalog; it is the only iPhone listed and is in stock."
  },
  "checkout": {
    "checkout_id": "6a98294b38b321df7c6575ed",
    "sku": "6a95d2acbdbb84526fb232c2",
    "total": {
      "amount": 68999,
      "currency": "INR"
    }
  },
  "payment": {
    "status": "captured",
    "payment_id": "pay_TXBt8UTZximIYN",
    "payment_url": "http://localhost:3002/pay?order_id=order_TXBs1ylpyjZsCI&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_dbc2832d-5575-4b95-89cf-ebeb7b4fe38f"
  },
  "order": {
    "order_id": "6a98294b38b321df7c6575ed",
    "status": "confirmed",
    "confirmed_at": "2026-09-02T13:51:08.621Z"
  },
  "ucp": {
    "checkout_status": "completed"
  }
}
Description
Poll or retrieve the real-time status of an ongoing transaction. Automatically finalizes order confirmation when payment authorization is received.

Parameters
{
  "transaction_id": "txn_dbc2832d-5575-4b95-89cf-ebeb7b4fe38f"
}
Payment confirmed — your order is complete. 🎉

Order status: Confirmed (2026-09-02 13:51 UTC)
Payment: Captured — ₹68,999 INR (payment ID pay_TXBt8UTZximIYN)
Item: iPhone 13 Pro 256GB × 1
Order ID: 6a98294b38b321df7c6575ed
If you ever need it, I can pull the full audit trail for this transaction or request a refund.

Can you buy any airpods from the proshop too?

Worked for 43s

Thought
·
a few seconds
Search for AirPods first.
Let me search Proshop for AirPods first.

MCP
Proshop
·
Search products
Result
{
  "search_id": "srch_392d4444-75fe-472e-8baa-7cb61933760f",
  "offers": [
    {
      "offer_id": "6a95d2acbdbb84526fb232c1",
      "title": "Airpods Wireless Bluetooth Headphones",
      "description": "Bluetooth technology lets you connect it with compatible devices wirelessly High-quality AAC audio offers immersive listening experience Built-in microphone allows you to take calls while working",
      "price": {
        "amount": 8999,
        "currency": "INR"
      },
      "availability": "in_stock",
      "attributes": {
        "brand": "Apple",
        "category": "Electronics",
        "rating": 4.5,
        "numReviews": 12,
        "countInStock": 10,
        "image": "/images/airpods.jpg"
      }
    }
  ],
  "total_results": 1,
  "refinements": [
    {
      "key": "brand",
      "label": "Brand",
      "type": "enum",
      "multi_select": true,
      "options": [
        {
          "value": "Apple",
          "label": "Apple",
          "count": 1
        }
      ],
      "option_count": 1,
      "has_more": false
    },
    {
      "key": "category",
      "label": "Category",
      "type": "enum",
      "multi_select": true,
      "options": [
        {
          "value": "Electronics",
          "label": "Electronics",
          "count": 1
        }
      ],
      "option_count": 1,
      "has_more": false
    }
  ],
  "sort_options": [
    {
      "key": "relevance",
      "label": "Relevance"
    },
    {
      "key": "top_rated",
      "label": "Top Rated"
    }
  ],
  "page_info": {
    "page": 1,
    "page_size": 8,
    "has_more": false
  }
}
Description
Search the merchant's catalog. Returns matching offers (any commerce domain: products, rides, tickets, bookings...), pricing, availability, and dynamically discovered refinements. Supply `parameters` as declared in get_merchant_info → discovery_schema for non-retail domains.

Parameters
{
  "query": "AirPods"
}
Found one — AirPods Wireless Bluetooth Headphones, ₹8,999, in stock. Proceeding with the purchase now.

MCP
Proshop
·
Prepare purchase
Result
{
  "transaction_id": "txn_c320af0d-9de6-421e-b3f0-7e00bdfe73f6",
  "state": "PAYMENT_PENDING",
  "checkout": {
    "checkout_id": "6a982a2e38b321df7c6575f9",
    "sku": "6a95d2acbdbb84526fb232c1",
    "unit_price": {
      "amount": 11349,
      "currency": "INR"
    },
    "total": {
      "amount": 11349,
      "currency": "INR"
    }
  },
  "payment": {
    "status": "user_action_required",
    "payment_url": "http://localhost:3002/pay?order_id=order_TXBw1wQ5Zs2L8E&amount=11349&currency=INR&desc=Purchase%3A%20Airpods%20Wireless%20Bluetooth%20Headphones%20(x1)&txn_id=txn_c320af0d-9de6-421e-b3f0-7e00bdfe73f6",
    "razorpay_order_id": "order_TXBw1wQ5Zs2L8E",
    "methods": {
      "payment_link": {
        "url": "http://localhost:3002/pay?order_id=order_TXBw1wQ5Zs2L8E&amount=11349&currency=INR&desc=Purchase%3A%20Airpods%20Wireless%20Bluetooth%20Headphones%20(x1)&txn_id=txn_c320af0d-9de6-421e-b3f0-7e00bdfe73f6",
        "description": "Open this hosted URL in browser to complete payment"
      },
      "checkout_sdk": {
        "razorpay_key_id": "rzp_test_TVVFU5yXYmeSCq",
        "razorpay_order_id": "order_TXBw1wQ5Zs2L8E",
        "amount": 11349,
        "currency": "INR",
        "merchant_name": "ProShop Electronics",
        "description": "Purchase: Airpods Wireless Bluetooth Headphones (x1)",
        "instructions": "Use these parameters to render Razorpay Standard Checkout in a web/native host"
      }
    },
    "message": "Choose payment_link (open URL) or checkout_sdk (render native Razorpay Checkout)."
  },
  "policy": {
    "decision": "ALLOW",
    "checks": [
      {
        "gate": "RateLimitGate",
        "result": "PASS",
        "detail": "Rate limit check passed (59 tokens remaining)"
      },
      {
        "gate": "AbuseDetectionGate",
        "result": "PASS",
        "detail": "Abuse detection check passed: session in good standing"
      },
      {
        "gate": "AmountBoundsGate",
        "result": "PASS",
        "detail": "Checkout total of 113.49 INR is within authorized bounds"
      },
      {
        "gate": "CheckoutBindingGate",
        "result": "PASS",
        "detail": "Valid checkout binding \"6a982a2e38b321df7c6575f9\" confirmed and unexpired"
      },
      {
        "gate": "TransactionStateGate",
        "result": "PASS",
        "detail": "Transaction state \"CHECKOUT_CREATED\" is valid for action \"CREATE_PAYMENT\""
      },
      {
        "gate": "RefundBoundsGate",
        "result": "PASS",
        "detail": "Not a refund action (\"CREATE_PAYMENT\")"
      },
      {
        "gate": "MandateGate",
        "result": "PASS",
        "detail": "Authorization layer disabled (auth_mode=none)"
      },
      {
        "gate": "MandateBoundsGate",
        "result": "PASS",
        "detail": "Authorization layer disabled (auth_mode=none)"
      },
      {
        "gate": "CurrencyConsistencyGate",
        "result": "PASS",
        "detail": "Currency \"INR\" matches merchant declaration"
      },
      {
        "gate": "IdempotencyGate",
        "result": "PASS",
        "detail": "Idempotency check passed for action \"CREATE_PAYMENT\""
      }
    ]
  },
  "ucp": {
    "checkout_status": "ready_for_complete"
  }
}
Description
Initiate an authoritative purchase and checkout flow for a product. Verifies stock with the merchant, creates an immutable checkout, executes policy evaluations, and completes payment autonomously via a saved recurring token + AP2 mandate or generates a hosted payment link.

AUTONOMOUS PAYMENT & MANDATE INSTRUCTIONS FOR BUYER AGENTS:
1. First Purchase (Manual Link + Token Registration): On first purchase, the user pays via a hosted payment link where they authorize an AutoPay/recurring mandate at their bank. The customer ID is automatically derived from the active user session.
2. Subsequent Purchases (Autonomous AP2 Checkout): The MCP automatically recognizes the user's saved recurring token from their session. You can call `create_mandate` first and pass `authorization_reference` here for instant zero-click checkout. If you omit `authorization_reference`, the tool returns a `consent_url` (Mode B JIT Consent) asking the user to approve the specific transaction amount.

Parameters
{
  "product_id": "6a95d2acbdbb84526fb232c1",
  "quantity": 1,
  "selection_reason": "User explicitly requested to buy AirPods from Proshop; this is the only AirPods product listed, in stock at 8999 INR.",
  "session_id": "sess_c934a4c2-9c2c-47f5-86db-0c9b1f533850"
}
The AirPods checkout is ready, but just like with the iPhone, you'll need to complete the payment yourself:

Item: AirPods Wireless Bluetooth Headphones × 1
Total: ₹11,349 INR — again higher than the ₹8,999 listed in search results, so the same price discrepancy applies.
Transaction ID: txn_c320af0d-9de6-421e-b3f0-7e00bdfe73f6
Status: Payment pending, all policy checks passed
Pay via this link: pay

Let me know once you've paid and I'll confirm the order. If ₹11,349 isn't what you expected, I can cancel now before any money moves.