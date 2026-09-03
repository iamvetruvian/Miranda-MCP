




I want you to find any iPhones on Proshop using the Proshop MCP

Worked for 36s

Thought
·
a few seconds
I'll search Proshop for iPhones now.

MCP
Proshop
·
Search products
Result
{
  "search_id": "srch_6ca7e12d-c9c5-4e1c-94bd-daf120ba445c",
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
The search returned 1 result: iPhone 13 Pro 256GB at ₹59,999 INR. Let me maybe get the full product details to give a complete answer. That could be useful. Let me fetch product details with get_product.
The search found one match — let me pull the full product details for it.

MCP
Proshop
·
Get product
Result
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
Description
Retrieve full, canonical details of a specific product/offer by its ID.

Parameters
{
  "product_id": "6a95d2acbdbb84526fb232c2"
}

Thought
·
a few seconds
The search found exactly one iPhone on Proshop. Let me report the findings clearly.
Proshop has exactly one iPhone in its catalog: the iPhone 13 Pro 256GB.

Price: ₹59,999 INR
Availability: In stock (7 units)
Rating: 4 stars from 8 reviews
Category/Brand: Electronics / Apple
Description highlights: Triple-camera system, improved battery life
Product ID: 6a95d2acbdbb84526fb232c2
That's the full list — the search returned no other iPhone models. If you'd like, I can add this one to a cart or start a checkout for it.

Buy me one

Worked for 56s

Thought
·
a few seconds
The user wants me to buy the iPhone 13 Pro 256GB on Proshop. Let me think about the flow:

1. Add to cart (or go straight to prepare_purchase which verifies stock, creates checkout, etc.)
2. The prepare_purchase tool is the authoritative purchase flow. CRITICAL instructions: if payment URLs (one_time_payment_url, autopay_mandate_url) or consent_url are returned, I must NOT open or automate them; present them directly to the human user.

Should I create a mandate first? The create_mandate tool creates an AP2 Intent Mandate authorizing purchases within bounds. The prepare_purchase has an optional authorization_reference parameter. It might be needed for autonomous checkout. But since this is a one-time purchase, likely the flow will generate a hosted payment link for the user.

The user said "Buy me one" — that's explicit authorization for this purchase at ₹59,999. I could create a mandate with max_amount. The price is 59999 paise? No wait — currency INR, amount 59999. The create_mandate says max_amount is in currency sub-units (paise/cents), e.g. 8000000 for ₹80,000. But the product price shows amount 59999 with currency INR — that's presumably ₹59,999 stored in paise? 59999 paise would be ₹599.99. Hmm, the product price amount is 59999 INR — ambiguous whether it's ₹59,999 or 59999 paise = ₹599.99.

Given typical test data (this looks like the classic "proshop" demo store), iPhone 13 Pro at 59999 INR means ₹59,999. So in paise that would be 5999900. For the mandate, I'd set max_amount generously, e.g., 8000000 paise (₹80,000) to cover the price plus any taxes/fees.

Do I need a mandate at all? The prepare_purchase can work without it — it may then return a one_time_payment_url for the user to pay. Let me just try prepare_purchase directly with selection_reason. If it requires authorization_reference, I can create a mandate then.

Also, should I ask the user for confirmation? The user explicitly said "Buy me one" — that's durable authorization for this exact purchase. Proceed.

Regarding autonomous checkout: prepare_purchase might complete payment autonomously only with recurring token + AP2 mandate. Since we don't have a recurring token from a previous purchase, it will likely generate payment links. Per instructions, I must present both one-time payment link and autopay mandate link to the user and explain the difference.

Let me proceed: call prepare_purchase with product_id 6a95d2acbdbb84526fb232c2, quantity 1, selection_reason "User asked to buy one iPhone 13 Pro 256GB after searching".

I might also need customer data — not required per schema. Let me try.
I'll start the checkout for the iPhone 13 Pro now.

MCP
Proshop
·
Prepare purchase
Result
{
  "transaction_id": "txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
  "state": "PAYMENT_PENDING",
  "checkout": {
    "checkout_id": "6a9882fec84db32c99d99be0",
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
    "payment_url": "http://localhost:3002/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
    "one_time_payment_url": "http://localhost:3002/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
    "autopay_mandate_url": "http://localhost:3178/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Autopay%20Mandate%3A%20iPhone%2013%20Pro%20256GB%20Memory&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8&mode=mandate",
    "razorpay_order_id": "order_TXIOJCLzhhB2k2",
    "instructions_for_agent": "CRITICAL: Do NOT attempt to visit, open, or automate these payment links yourself via browser tools. You MUST present these links directly to the human user in your chat response so the user can choose and complete payment in their own browser.",
    "methods": {
      "payment_link": {
        "url": "http://localhost:3002/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
        "description": "Hosted Razorpay payment link for manual one-time payment"
      },
      "one_time": {
        "url": "http://localhost:3002/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
        "description": "Single one-time payment for this order only (no autopay mandate)"
      },
      "autopay_mandate": {
        "url": "http://localhost:3178/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Autopay%20Mandate%3A%20iPhone%2013%20Pro%20256GB%20Memory&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8&mode=mandate",
        "description": "Payment + Autopay mandate authorization for future autonomous agent purchases"
      },
      "checkout_sdk": {
        "razorpay_key_id": "rzp_test_TVVFU5yXYmeSCq",
        "razorpay_order_id": "order_TXIOJCLzhhB2k2",
        "amount": 68999,
        "currency": "INR",
        "merchant_name": "ProShop Electronics",
        "description": "Purchase: iPhone 13 Pro 256GB Memory (x1)",
        "instructions": "Use these parameters to render Razorpay Standard Checkout in a web/native host"
      }
    },
    "message": "Do NOT open these links yourself. Present BOTH payment options clearly to the user in your response: 1) One-Time Payment: Pay for this order once via one_time_payment_url without setting up autopay. 2) Autopay Mandate: Pay and authorize an autopay mandate via autopay_mandate_url so future purchases can be completed autonomously by the agent without manual checkout links. Ask the user which option they prefer."
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
        "detail": "Valid checkout binding \"6a9882fec84db32c99d99be0\" confirmed and unexpired"
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
        "detail": "Manual hosted payment link — mandate reference not required"
      },
      {
        "gate": "MandateBoundsGate",
        "result": "PASS",
        "detail": "No mandate reference to check bounds for (handled by MandateGate)"
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
Initiate an authoritative purchase and checkout flow for a product. Verifies stock with the merchant, creates an immutable checkout, executes policy evaluations, and either completes payment autonomously via a recurring token + AP2 mandate or generates hosted payment links.

CRITICAL AGENT INSTRUCTIONS:
1. When payment URLs (one_time_payment_url, autopay_mandate_url) or consent_url are returned, you must NEVER attempt to open, browse, or automate them yourself using browser tools.
2. You MUST present these URLs directly to the human user in your chat response so the user can make their payment or authorize the mandate in their own browser.
3. On first purchase, present BOTH the one-time payment link and the autopay mandate link to the user and explain the difference clearly.

Parameters
{
  "product_id": "6a95d2acbdbb84526fb232c2",
  "quantity": 1,
  "selection_reason": "User searched Proshop for iPhones and asked to buy one iPhone 13 Pro 256GB at ₹59,999 INR."
}

Thought
·
a few seconds
The checkout is created. The transaction is in PAYMENT_PENDING state. The total came out to ₹68,999 INR (not ₹59,999 as listed — interesting, the unit price in checkout is 68999. Actually the AmountBoundsGate says "Checkout total of 689.99 INR" which suggests the amount is in paise: 68999 paise = ₹689.99. Hmm. The product listing said 59999 INR, checkout says 68999 INR. The gate detail says 689.99 INR, meaning the amount 68999 is in paise. So the actual price is ₹689.99? That's odd for an iPhone but this is a test merchant (razorpay test keys, localhost URLs).

Either way: the checkout total is 68999 (in the currency's sub-units, i.e., paise) = ₹689.99, per the policy gate. The displayed price fields say INR 68999. I should report what I see: the listing said ₹59,999, checkout came to ₹689.99 per the bounds gate. Hmm, this discrepancy is worth noting to the user. Actually let me be careful: the checkout JSON says unit_price amount 68999 currency INR, total 68999 INR. The Razorpay checkout SDK params also say amount 68999, currency INR. Razorpay amounts are in paise, so ₹689.99. The policy gate explicitly says 689.99 INR. So the real charge will be ₹689.99.

Interesting — the listed price was 59999 (₹599.99 presumably) and checkout is 68999 (₹689.99). Maybe taxes/fees added? 599.99 → 689.99 is +₹90. Could be tax. Whatever — I should present the checkout total to the user.

Per the tool instructions, I must NOT open the payment links myself. I must present both options (one-time payment and autopay mandate) to the user and ask which they prefer. I cannot complete the payment myself without a recurring token + mandate. The user needs to choose and complete payment in their browser.

I should present:
1. Transaction ID, order ID
2. Total amount: ₹689.99 (68999 paise) — note the difference from the listed ₹59,999/₹599.99. Actually the listing said "59999 INR" which by the same paise logic is ₹599.99. So the listing was ₹599.99 and the checkout total is ₹689.99 — likely with tax/shipping. I'll note the total.
3. Two payment links with explanation of the difference
4. Note that after they pay, I can verify the transaction status.

Since the payment requires user action, I'm blocked on user input — that's a legitimate stopping point. I could use AskUserQuestion to ask which payment option they prefer, but the instructions say to present links in the chat response. AskUserQuestion options wouldn't display the URLs well. Better to just present in the final message with both links and let the user click. The mandate message says "Ask the user which option they prefer." I'll present both clearly and ask.

Note: I must present the URLs as-is (localhost URLs). I'll format them as markdown links.
The checkout is created and waiting on your payment — I can't click the payment links myself, so here they are for you to complete it in your browser.

Order summary (transaction txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8, Razorpay order order_TXIOJCLzhhB2k2):

Item: iPhone 13 Pro 256GB (x1)
Checkout total: ₹689.99 INR — note this is higher than the listed price (₹599.99); the checkout shows the final chargeable amount
Status: Payment pending, stock verified, all policy checks passed
You have two ways to pay — please pick one:

One-time payment (recommended for a simple purchase): pay for this order only, no strings attached. Pay ₹689.99 now
Autopay mandate: pays for this order and authorizes a recurring autopay mandate, so I could complete future Proshop purchases autonomously without asking you to click a payment link each time. Only choose this if you're comfortable granting that standing authorization. Pay & authorize autopay mandate
Once you've completed payment, tell me and I'll confirm the order went through — or just say "check status" anytime.

Pay & authorize autopay mandate
Website
pay
Website
Done

Worked for 21s

Thought
·
a few seconds
The user says "Done" — they've completed the payment (presumably via one of the links). I should verify the transaction status using get_transaction_status with the transaction ID txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8.
Let me verify the payment went through.

MCP
Proshop
·
Get transaction status
Result
{
  "transaction_id": "txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
  "state": "ORDER_CONFIRMED",
  "created_at": "2026-09-02T20:11:42.770Z",
  "agent_claim": {
    "product_id": "6a95d2acbdbb84526fb232c2",
    "quantity": 1,
    "selection_reason": "User searched Proshop for iPhones and asked to buy one iPhone 13 Pro 256GB at ₹59,999 INR."
  },
  "checkout": {
    "checkout_id": "6a9882fec84db32c99d99be0",
    "sku": "6a95d2acbdbb84526fb232c2",
    "total": {
      "amount": 68999,
      "currency": "INR"
    }
  },
  "payment": {
    "status": "captured",
    "payment_id": "pay_TXIRByp24b3uic",
    "payment_url": "http://localhost:3002/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
    "one_time_payment_url": "http://localhost:3002/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Purchase%3A%20iPhone%2013%20Pro%20256GB%20Memory%20(x1)&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8",
    "autopay_mandate_url": "http://localhost:3178/pay?order_id=order_TXIOJCLzhhB2k2&amount=68999&currency=INR&desc=Autopay%20Mandate%3A%20iPhone%2013%20Pro%20256GB%20Memory&txn_id=txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8&mode=mandate"
  },
  "order": {
    "order_id": "6a9882fec84db32c99d99be0",
    "status": "confirmed",
    "confirmed_at": "2026-09-02T20:14:46.577Z"
  },
  "ucp": {
    "checkout_status": "completed"
  }
}
Description
Poll or retrieve the real-time status of an ongoing transaction. Automatically finalizes order confirmation when payment authorization is received. CRITICAL: If a payment_url, one_time_payment_url, autopay_mandate_url, or consent_url is returned, the agent must NOT open or automate it; present it directly to the human user in the response.

Parameters
{
  "transaction_id": "txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8"
}

Thought
·
a few seconds
The payment is captured and the order is confirmed. Let me give the user a clear confirmation. I could also pull the audit trail, but that's probably unnecessary. The key facts:

- State: ORDER_CONFIRMED
- Payment: captured, payment_id pay_TXIRByp24b3uic
- Order confirmed at 2026-09-02T20:14:46 UTC
- Total: ₹689.99 (68999 paise)

Done. Report clearly.
Your order is confirmed — payment was captured successfully. 🎉

Order status: Confirmed (order 6a9882fec84db32c99d99be0)
Payment: Captured — payment ID pay_TXIRByp24b3uic
Item: iPhone 13 Pro 256GB (x1)
Total charged: ₹689.99 INR
Confirmed at: 2026-09-02 20:14 UTC
Transaction: txn_f1c096b2-3b81-4697-aa62-9075a6ab9fa8
That's everything — the iPhone 13 Pro is officially yours. If anything looks off with the charge or you change your mind, I can pull up the transaction audit trail or request a refund.

Can you buy me airpods too?

Worked for 46s

Thought
·
a few seconds
The user wants me to buy AirPods too. Let me search for AirPods on Proshop first, then present what I find and proceed with the purchase.

The user said "buy me airpods too" — that's explicit authorization. But I should search first to see what's available. If there are multiple options, I might need to pick one or ask. Let me search first.
Let me search Proshop for AirPods.

MCP
Proshop
·
Search products
Result
{
  "search_id": "srch_4ec77420-2b02-4598-929a-ff5f567b80ee",
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

Thought
·
a few seconds
Found one AirPods product: "Airpods Wireless Bluetooth Headphones" at 8999 INR (₹89.99 per the paise convention we established — the checkout for the iPhone listed 59999 and the gate said 689.99 for 68999, so 8999 paise = ₹89.99... wait, let me reconsider.

Actually earlier: listing said 59999 INR for iPhone, checkout total was 68999, and the policy gate said "Checkout total of 689.99 INR". So amounts are in paise. 8999 paise = ₹89.99. The checkout may add something similar to the iPhone (59999 → 68999, +9000 paise = ₹90). So AirPods might come out to 8999 + 9000 = 17999? Not sure — I'll see what the checkout says.

The user asked me to buy it. There's only one option, so no ambiguity. Proceed with prepare_purchase directly, like last time. The user already went through the payment flow once; I'll present the payment link again. This is a new transaction so it'll need a new payment. Let me initiate.
Found one: Airpods Wireless Bluetooth Headphones (₹89.99, in stock, 4.5★). Starting the checkout now.

MCP
Proshop
·
Prepare purchase
Result
{
  "transaction_id": "txn_879a3a01-4077-44d4-941e-0e1df1fc044b",
  "state": "PAYMENT_PENDING",
  "checkout": {
    "checkout_id": "6a988400c84db32c99d99bec",
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
    "payment_url": "http://localhost:3002/pay?order_id=order_TXISqA3rDwLjPP&amount=11349&currency=INR&desc=Purchase%3A%20Airpods%20Wireless%20Bluetooth%20Headphones%20(x1)&txn_id=txn_879a3a01-4077-44d4-941e-0e1df1fc044b",
    "one_time_payment_url": "http://localhost:3002/pay?order_id=order_TXISqA3rDwLjPP&amount=11349&currency=INR&desc=Purchase%3A%20Airpods%20Wireless%20Bluetooth%20Headphones%20(x1)&txn_id=txn_879a3a01-4077-44d4-941e-0e1df1fc044b",
    "autopay_mandate_url": "http://localhost:3178/pay?order_id=order_TXISqA3rDwLjPP&amount=11349&currency=INR&desc=Autopay%20Mandate%3A%20Airpods%20Wireless%20Bluetooth%20Headphones&txn_id=txn_879a3a01-4077-44d4-941e-0e1df1fc044b&mode=mandate",
    "razorpay_order_id": "order_TXISqA3rDwLjPP",
    "instructions_for_agent": "CRITICAL: Do NOT attempt to visit, open, or automate these payment links yourself via browser tools. You MUST present these links directly to the human user in your chat response so the user can choose and complete payment in their own browser.",
    "methods": {
      "payment_link": {
        "url": "http://localhost:3002/pay?order_id=order_TXISqA3rDwLjPP&amount=11349&currency=INR&desc=Purchase%3A%20Airpods%20Wireless%20Bluetooth%20Headphones%20(x1)&txn_id=txn_879a3a01-4077-44d4-941e-0e1df1fc044b",
        "description": "Hosted Razorpay payment link for manual one-time payment"
      },
      "one_time": {
        "url": "http://localhost:3002/pay?order_id=order_TXISqA3rDwLjPP&amount=11349&currency=INR&desc=Purchase%3A%20Airpods%20Wireless%20Bluetooth%20Headphones%20(x1)&txn_id=txn_879a3a01-4077-44d4-941e-0e1df1fc044b",
        "description": "Single one-time payment for this order only (no autopay mandate)"
      },
      "autopay_mandate": {
        "url": "http://localhost:3178/pay?order_id=order_TXISqA3rDwLjPP&amount=11349&currency=INR&desc=Autopay%20Mandate%3A%20Airpods%20Wireless%20Bluetooth%20Headphones&txn_id=txn_879a3a01-4077-44d4-941e-0e1df1fc044b&mode=mandate",
        "description": "Payment + Autopay mandate authorization for future autonomous agent purchases"
      },
      "checkout_sdk": {
        "razorpay_key_id": "rzp_test_TVVFU5yXYmeSCq",
        "razorpay_order_id": "order_TXISqA3rDwLjPP",
        "amount": 11349,
        "currency": "INR",
        "merchant_name": "ProShop Electronics",
        "description": "Purchase: Airpods Wireless Bluetooth Headphones (x1)",
        "instructions": "Use these parameters to render Razorpay Standard Checkout in a web/native host"
      }
    },
    "message": "Do NOT open these links yourself. Present BOTH payment options clearly to the user in your response: 1) One-Time Payment: Pay for this order once via one_time_payment_url without setting up autopay. 2) Autopay Mandate: Pay and authorize an autopay mandate via autopay_mandate_url so future purchases can be completed autonomously by the agent without manual checkout links. Ask the user which option they prefer."
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
        "detail": "Valid checkout binding \"6a988400c84db32c99d99bec\" confirmed and unexpired"
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
        "detail": "Manual hosted payment link — mandate reference not required"
      },
      {
        "gate": "MandateBoundsGate",
        "result": "PASS",
        "detail": "No mandate reference to check bounds for (handled by MandateGate)"
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
Initiate an authoritative purchase and checkout flow for a product. Verifies stock with the merchant, creates an immutable checkout, executes policy evaluations, and either completes payment autonomously via a recurring token + AP2 mandate or generates hosted payment links.

CRITICAL AGENT INSTRUCTIONS:
1. When payment URLs (one_time_payment_url, autopay_mandate_url) or consent_url are returned, you must NEVER attempt to open, browse, or automate them yourself using browser tools.
2. You MUST present these URLs directly to the human user in your chat response so the user can make their payment or authorize the mandate in their own browser.
3. On first purchase, present BOTH the one-time payment link and the autopay mandate link to the user and explain the difference clearly.

Parameters
{
  "product_id": "6a95d2acbdbb84526fb232c1",
  "quantity": 1,
  "selection_reason": "User asked to buy AirPods after previously purchasing an iPhone on Proshop; this is the only AirPods listing available (₹89.99 INR, in stock)."
}

Thought
·
a few seconds
Checkout created for AirPods. Total is 11349 paise = ₹113.49 (per the policy gate detail: "Checkout total of 113.49 INR"). Listing was 8999 (₹89.99), checkout total ₹113.49 — again some markup/tax.

Present the two payment options again. The user used one-time payment last time presumably. I'll present both links per instructions.
The AirPods checkout is ready and waiting on your payment. Here are the details:

Order summary (transaction txn_879a3a01-4077-44d4-941e-0e1df1fc044b, Razorpay order order_TXISqA3rDwLjPP):

Item: Airpods Wireless Bluetooth Headphones (x1)
Checkout total: ₹113.49 INR (listed price was ₹89.99 — the checkout shows the final chargeable amount, same pattern as last time)
Status: Payment pending, stock verified, all policy checks passed
Two payment options — pick whichever you prefer:

One-time payment — pay for this order only: Pay ₹113.49 now
Autopay mandate — pays for this order and authorizes autopay for future purchases so I can check out autonomously next time (only if you want that standing authorization): Pay & authorize autopay mandate
Let me know once you've paid and I'll confirm the order.