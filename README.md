# Miranda MCP — Drop-In Agentic Commerce MCP Gateway

> **Make any merchant transactable by AI buyer agents end-to-end with zero code changes.**  
> Every money action is **explainable, bounded, and gated** with a tamper-evident, SHA-256 hash-chained audit trail and periodic cryptographic checkpoints.

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

## Complete MCP Tools Catalog (22 Tools)

| Tool | Category | Description |
|---|---|---|
| `search_products` | Discovery | Keyword & domain-parameter search with multi-filter refinements, pagination, and stateful `search_id`. |
| `get_product` | Discovery | Canonical product/showtime detail lookup by ID / SKU with ephemeral hold expiry. |
| `browse_categories` | Discovery | Browse the merchant's category hierarchy for category-driven navigation. |
| `autocomplete` | Discovery | Real-time typeahead search suggestions as the user types queries. |
| `check_availability` | Discovery | Live stock availability check across products, variants, date slots, or seat maps. |
| `get_merchant_info` | Discovery | Returns merchant profile, capability matrix, integration level, currency, and discovery schema. |
| `refine_search` | Discovery | Iteratively narrows search results using discovered dynamic facets while maintaining search session state. |
| `get_refinement_options` | Discovery | Paginates and filters large facet option lists (e.g. searching 50+ brands) with substring search. |
| `check_auth_status` | Authentication | Check user authentication state, active sessions, user profile details, and vaulted payment instruments. |
| `request_login` | Authentication | Initiate merchant OAuth2 authorization flow; returns an authorization URL for user browser login. |
| `logout` | Authentication | Invalidate and terminate the active user session on the merchant. |
| `create_mandate` | Authorization | Create an AP2 Intent Mandate for advance budgetary spending limits, domain restrictions, and policy constraints. |
| `add_to_cart` | Cart | Add an item or variant to a multi-item shopping cart (creates cart if omitted). |
| `get_cart` | Cart | Retrieve current contents, quantities, and calculated total of an active shopping cart. |
| `apply_coupon` | Cart | Apply promotional coupon codes or discount vouchers to an active checkout session. |
| `get_delivery_options` | Delivery | Retrieve available delivery and shipping options/rates for an active checkout. |
| `select_delivery_option` | Delivery | Choose a shipping or delivery option for an active checkout session. |
| `prepare_purchase` | Transaction | Resolves stock/hold, creates merchant checkout, evaluates policy gates, and initiates payment (autopay token or payment links). |
| `get_transaction_status` | Transaction | Polls real-time transaction state and automatically finalizes merchant order confirmation upon payment authorization. |
| `cancel_transaction` | Transaction | Cancels a transaction. Pre-payment: releases hold. Post-confirmation: executes refund and merchant cancellation. |
| `request_refund` | Transaction | Policy-gated money action for partial or full refunds of captured payments. |
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

### 3. Demo Ecommerce Platforms & AI Agent Setup

For testing and demonstration, two full-featured open-source ecommerce platforms are included in the `demo/merchants/` folder:
- **ProShop v2**: Adapted from [bradtraversy/proshop-v2](https://github.com/bradtraversy/proshop-v2) — an ecommerce platform built with the MERN stack. *(These are great projects, please star them! ⭐)*
- **Skateshop**: Adapted from [sadmann7/skateshop](https://github.com/sadmann7/skateshop) — an ecommerce skateshop built with Next.js 14, Stripe Connect, Clerk Auth, and Drizzle ORM. *(These are great projects, please star them! ⭐)*

The corresponding integration manifests for each store are available directly at the root of this project:
- `manifest.json` &rarr; ProShop integration manifest (runs on `http://localhost:5000`)
- `skateshop-manifest.json` &rarr; Skateshop integration manifest (runs on `http://localhost:3000`)

#### Setting Up the Demo Stores

##### Option A: ProShop v2 (`demo/merchants/proshop-v2`)
```bash
cd demo/merchants/proshop-v2

# Configure environment variables
cp .env.example .env
# Update .env with your MONGO_URI, JWT_SECRET, etc.

# Install dependencies (root and frontend)
npm install
npm install --prefix frontend

# (Optional) Seed the database with sample products and users
npm run data:import

# Start backend server (runs on http://localhost:5000)
npm run server
# Or start both frontend (:3000) and backend (:5000) concurrently:
# npm run dev
```

##### Option B: Skateshop (`demo/merchants/skateshop`)
```bash
cd demo/merchants/skateshop

# Configure environment variables
cp .env.example .env
# Update .env with your database credentials, Clerk keys, and Stripe keys

# Install dependencies with pnpm
pnpm install

# Push database schema
pnpm run db:push

# Start development server (runs on http://localhost:3000)
pnpm run dev
```

#### Configuring Your AI Agent

Add the corresponding configuration to your choice of AI agent (e.g. Claude Desktop, Cursor, Windsurf, Claude Code, or any MCP-compatible agent).

> **Note:** Replace `/path/to/Miranda` with the canonical absolute path to your cloned Miranda MCP repository on your machine (e.g. `/home/username/Miranda`). Ensure you have built the project (`npm run build`) beforehand to generate `dist/server.js`, and that the `data/` directory exists (`mkdir -p data`).

##### Skateshop MCP Configuration
```json
{
  "skateshop": {
    "type": "stdio",
    "command": "node",
    "args": [
      "/path/to/Miranda/dist/server.js",
      "/path/to/Miranda/skateshop-manifest.json"
    ],
    "env": {
      "WEBHOOK_PORT": "3101",
      "MERCHANTMCP_DB_PATH": "/path/to/Miranda/data/skateshop.db",
      "AUDIT_LOG_FILE": "/path/to/Miranda/data/skateshop-audit.jsonl",
      "DISABLE_WEBHOOK_SERVER": "true"
    }
  }
}
```

##### ProShop MCP Configuration
```json
{
  "proshop": {
    "type": "stdio",
    "command": "node",
    "args": [
      "/path/to/Miranda/dist/server.js",
      "/path/to/Miranda/manifest.json"
    ],
    "env": {
      "WEBHOOK_PORT": "3001",
      "MERCHANTMCP_DB_PATH": "/path/to/Miranda/data/proshop.db",
      "AUDIT_LOG_FILE": "/path/to/Miranda/data/proshop-audit.jsonl",
      "DISABLE_WEBHOOK_SERVER": "true"
    }
  }
}
```

##### Combined MCP Configuration (e.g. `claude_desktop_config.json` / `mcp_config.json`)
```json
{
  "mcpServers": {
    "skateshop": {
      "command": "node",
      "args": [
        "/path/to/Miranda/dist/server.js",
        "/path/to/Miranda/skateshop-manifest.json"
      ],
      "env": {
        "WEBHOOK_PORT": "3101",
        "MERCHANTMCP_DB_PATH": "/path/to/Miranda/data/skateshop.db",
        "AUDIT_LOG_FILE": "/path/to/Miranda/data/skateshop-audit.jsonl",
        "DISABLE_WEBHOOK_SERVER": "true"
      }
    },
    "proshop": {
      "command": "node",
      "args": [
        "/path/to/Miranda/dist/server.js",
        "/path/to/Miranda/manifest.json"
      ],
      "env": {
        "WEBHOOK_PORT": "3001",
        "MERCHANTMCP_DB_PATH": "/path/to/Miranda/data/proshop.db",
        "AUDIT_LOG_FILE": "/path/to/Miranda/data/proshop-audit.jsonl",
        "DISABLE_WEBHOOK_SERVER": "true"
      }
    }
  }
}
```

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
Miranda MCP/
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
