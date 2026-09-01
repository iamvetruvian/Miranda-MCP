# MerchantMCP — Drop-In Agentic Commerce MCP Gateway

> **Make any merchant transactable by AI buyer agents end-to-end with zero code changes.**  
> Every money action is **explainable, bounded, and gated** with a tamper-evident, SHA-256 hash-chained audit trail and periodic cryptographic checkpoints.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    BUYER AGENT                          │
└───────────────────────────┬─────────────────────────────┘
                            │ Model Context Protocol (MCP)
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   MERCHANT MCP SERVER                   │
│                                                         │
│   ┌───────────────────┐        ┌───────────────────┐    │
│   │  Discovery Tools  │        │ Transaction Tools │    │
│   │ (Search/Refine)   │        │ (Purchase/Refund) │    │
│   └─────────┬─────────┘        └─────────┬─────────┘    │
│             │                            │              │
│             ▼                            ▼              │
│   ┌───────────────────┐        ┌───────────────────┐    │
│   │ Connector Runtime │        │   Policy Engine   │    │
│   │ (Manifest Engine) │        │ (Bounded & Gated) │    │
│   └─────────┬─────────┘        └─────────┬─────────┘    │
│             │                            │              │
│             │                            ▼              │
│             │                  ┌───────────────────┐    │
│             │                  │  Payment Adapter  │    │
│             │                  │ (Razorpay Rails)  │    │
│             │                  └─────────┬─────────┘    │
│             │                            │              │
│             ▼                            ▼              │
│   ┌────────────────────────────────────────────────┐    │
│   │   Append-Only Audit Ledger (SHA-256 Chain +    │    │
│   │            HMAC Signed Checkpoints)            │    │
│   └────────────────────────────────────────────────┘    │
└─────────────┬────────────────────────────┬──────────────┘
              │ Localhost / Private VPC    │
              ▼                            ▼
   ┌──────────────────────┐     ┌──────────────────────┐
   │ Merchant Commerce    │     │ Razorpay Gateway /   │
   │ APIs (Catalog/Order) │     │ Ingestion Webhook    │
   └──────────────────────┘     └──────────────────────┘
```

---

## Key Features

1. **Drop-In Zero-Code Merchant Integration**:
   - Merchants keep their existing backend, catalog, database, and order management system.
   - Onboarding requires only a declarative JSON **Integration Manifest** (`merchant-config.json`) defining endpoint paths and field mappings.
   - Data transformations: `multiply` (rupees to paise), `divide`, `enum`, `boolean_to_enum`, `default`, `template`.

2. **Universal Offer & Domain-Agnostic Discovery**:
   - Domain-neutral commerce representation (`Offer`) accommodating physical retail, digital goods, cinema ticketing, rides, bookings, and services.
   - Merchants declare domain-specific discovery parameters (e.g. `city`, `date`, `origin`, `destination`) in `discovery.input_schema`.
   - Ephemeral offer quotes (`expires_at`) are automatically validated and expired offers are rejected before checkout creation.
   - Optional Schema.org semantic projections (`Offer.semantic`) for buyer agent card rendering without polluting financial invariants.

3. **Deterministic Capability Negotiation**:
   - Evaluates the merchant manifest at startup and derives the compatibility matrix: `discovery`, `transaction`, `order_status`, `refunds`, `cancellation`, `dynamic_refinements`, `refinement_options`.
   - Classifies the integration level: `incompatible`, `discoverable`, `transactable`, `fully_manageable`.
   - Fails fast on startup if required transactional operations are missing.

4. **Deterministic Policy Engine (Bounded & Gated)**:
   - Evaluates hard rules before any money-moving operation:
     - **`AmountBoundsGate`**: Upper ceiling limits (default ₹5,00,000) and strict reconciliation against authoritative checkout totals.
     - **`CurrencyConsistencyGate`**: Enforces strict match between checkout currency and merchant declared base currency.
     - **`CheckoutBindingGate`**: Verifies unexpired, merchant-verified stock availability.
     - **`TransactionStateGate`**: Enforces strict lifecycle preconditions.
     - **`RefundBoundsGate`**: Prevents over-refunding beyond captured amounts.
     - **`IdempotencyGate`**: Prevents duplicate charges or replayed refund requests.
   - Issues short-lived, single-use cryptographic `gate_token`s required by the payment adapter.

5. **Full Refund & Cancellation Lifecycle**:
   - Pre-payment: releases holds and transitions to `CANCELLED` (no money moved).
   - Post-confirmation: initiates Razorpay refund, executes optional merchant `cancel_order`, and updates transaction state (`REFUND_PENDING` &rarr; `REFUNDED`).
   - Webhook reconciliation deduplicates retries and updates cumulative `refunded_amount`.

6. **Tamper-Evident Audit Ledger, Checkpoints & Decision Receipts**:
   - Every tool call, policy evaluation, payment event, refund, and state transition produces an append-only audit event.
   - Cryptographically linked via SHA-256 hash chaining (`previous_event_hash` linkage from `GENESIS`).
   - Periodic HMAC-SHA256 signed **Audit Checkpoints** anchoring the ledger state.
   - Generates printable, human-readable **AI Purchase Decision Receipts** with breakdown of claims, authoritative facts, policy evaluations, and refund orchestration.

---

## Complete MCP Tools Catalog (10 Tools)

| Tool | Category | Description |
|---|---|---|
| `search_products` | Discovery | Keyword & domain-parameter search with multi-filter refinements, pagination, and stateful `search_id`. |
| `get_product` | Discovery | Canonical product/showtime detail lookup by ID / SKU with ephemeral hold expiry. |
| `get_merchant_info` | Discovery | Returns merchant profile, capability matrix, integration level, currency, and discovery schema. |
| `refine_search` | Discovery | Iteratively narrows search results using discovered dynamic facets while maintaining search session state. |
| `get_refinement_options` | Discovery | Paginates and filters large facet option lists (e.g. searching 50+ brands) with substring search. |
| `prepare_purchase` | Transaction | Resolves stock/hold, creates merchant checkout, evaluates policy gates, generates Razorpay order & payment link. |
| `get_transaction_status` | Transaction | Polls real-time transaction state and automatically finalizes merchant order confirmation upon payment authorization. |
| `cancel_transaction` | Transaction | Cancels a transaction. Pre-payment: releases hold. Post-confirmation: executes refund and merchant cancellation. |
| `request_refund` | Transaction | Policy-gated money action for partial or full refunds of captured payments on Razorpay rails. |
| `get_transaction_audit` | Audit | Returns the full audit timeline, verifies cryptographic hash chain integrity, and renders the Decision Receipt. |

---

## Quick Start & Verification

### 1. Install Dependencies & Build
```bash
npm install
npm run build
```

### 2. Run Test Suite (135 Automated Tests across 16 Test Files)
```bash
npm test
```

### 3. Run Live End-to-End Interactive Demo
```bash
npm run demo
```

The demo launches three mock merchant backends simultaneously (`TechBazaar Electronics` on `:4001`, `PageTurner Books` on `:4002`, and `TicketVerse Cinemas` on `:4003`) and demonstrates:
- **Scenario 1 (Happy Path - TechBazaar)**: Autonomous discovery, dynamic brand/price refinement, purchase, payment link generation, webhook authorization, order confirmation, and Decision Receipt for a Lenovo laptop under ₹70,000.
- **Scenario 2 (Happy Path - PageTurner Books)**: Autonomous discovery and purchase of *The Pragmatic Programmer* on a GET-based REST API bookstore.
- **Scenario 3 (Graceful Failure Handling)**: Attempting to buy an out-of-stock item (Nvidia RTX 4090) with complete rejection audit trail.
- **Scenario 4 (Non-Retail Cinema Ticketing & Refund)**: Parameterized showtime discovery (Mumbai, 2026-09-01), seat hold reservation, booking confirmation with PNR, and full policy-gated post-confirmation refund on Razorpay rails.
- **Scenario 5 (Refinement Option Pagination)**: Paginating brand facet options matching `"sam"` via `get_refinement_options`.

---

## Example Non-Retail Integration Manifest

```json
{
  "merchant": {
    "name": "TicketVerse",
    "description": "Multiplex cinema ticketing — movie showtime discovery and seat booking",
    "commerce_domain": "ticketing",
    "currency": "INR",
    "base_url": "http://localhost:4003"
  },
  "discovery": {
    "input_schema": [
      { "name": "city", "type": "string", "required": true, "description": "City to search showtimes in" },
      { "name": "date", "type": "date", "required": true, "description": "Show date (YYYY-MM-DD)" }
    ]
  },
  "operations": {
    "search": {
      "method": "POST",
      "path": "/api/showtimes/search",
      "request_mapping": {
        "movie": { "from": "$.query" },
        "city": { "from": "$.parameters.city" },
        "show_date": { "from": "$.parameters.date" },
        "selected_filters": { "from": "$.filters" }
      },
      "response_path": "$.showtimes",
      "total_path": "$.total"
    },
    "get_product": { "method": "GET", "path": "/api/showtimes/:product_id" },
    "create_checkout": { "method": "POST", "path": "/api/bookings" },
    "confirm_order": { "method": "POST", "path": "/api/bookings/:checkout_id/confirm" },
    "cancel_order": { "method": "POST", "path": "/api/bookings/:order_id/cancel" }
  },
  "payment": {
    "provider": "razorpay",
    "razorpay_key_id_env": "RAZORPAY_KEY_ID",
    "razorpay_key_secret_env": "RAZORPAY_KEY_SECRET"
  }
}
```

---

## Project Structure

```
MerchantMCP/
├── src/
│   ├── server.ts                    # Main MCP server factory, SSE transport & fail-fast validation
│   ├── types/
│   │   ├── index.ts                 # Canonical types (Offer, Transaction, AuditEvent, Policy, DiscoveryParam)
│   │   └── manifest.ts              # Integration Manifest, FieldMap DSL, RefinementConfig, Semantics
│   ├── connector/
│   │   ├── runtime.ts               # Manifest interpreter, parameters, total_path, Schema.org semantics
│   │   ├── mapper.ts                # RequestMapper, ResponseMapper (dot-path & transforms)
│   │   ├── refinements.ts           # Dynamic facet extraction & option truncation
│   │   ├── capabilities.ts          # Deterministic capability matrix & level classification
│   │   └── validator.ts             # Zod validation schemas
│   ├── audit/
│   │   ├── ledger.ts                # Append-only SHA-256 hash-chained ledger & HMAC signed checkpoints
│   │   ├── events.ts                # Audit event factory functions
│   │   └── receipt.ts               # Human-readable decision receipt generator with refunds & checkpoints
│   ├── policy/
│   │   ├── engine.ts                # Gate evaluator & single-use gate_token generator
│   │   └── gates.ts                 # AmountBounds, Currency, CheckoutBinding, State, Refund, Idempotency gates
│   ├── transaction/
│   │   ├── manager.ts               # Transaction lifecycle, refunds binding & state transitions
│   │   └── states.ts                # VALID_TRANSITIONS adjacency matrix (incl. REFUND_PENDING, REFUNDED)
│   ├── payment/
│   │   ├── provider.ts              # PaymentProvider interface
│   │   ├── razorpay.ts              # RazorpayAdapter (Live + Simulation modes, refundPayment)
│   │   └── webhook.ts               # Razorpay HMAC-verified webhook server with refund reconciliation
│   └── tools/
│       ├── discovery.ts             # search_products, get_product, get_merchant_info
│       ├── refinement.ts            # refine_search, get_refinement_options, searchStates TTL pruning
│       └── transaction.ts           # prepare_purchase, get_transaction_status, cancel_transaction, request_refund, get_transaction_audit
├── demo/
│   ├── merchants/
│   │   ├── electronics-store/       # TechBazaar mock merchant (POST /api/search)
│   │   ├── bookstore/               # PageTurner Books mock merchant (GET /v2/books)
│   │   └── ticketing/               # TicketVerse cinema mock merchant (showtimes, bookings, cancellation)
│   └── buyer-agent/
│       ├── agent.ts                 # BuyerAgent class with 5 scenarios
│       └── demo.ts                  # Interactive live demo script
├── tests/
│   ├── unit/                        # 13 Unit test suites (types, connector, audit, policy, states, payment, server, capabilities, refinements, refunds, discovery, checkpoints)
│   └── integration/                 # 3 Integration test suites (merchants, e2e, ticketing)
├── package.json
└── tsconfig.json
```
