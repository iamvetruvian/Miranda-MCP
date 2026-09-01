import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResponseMapper, RequestMapper } from "../../src/connector/mapper.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { IntegrationManifest } from "../../src/types/manifest.js";
import { Offer, TransactionState } from "../../src/types/index.js";

describe("ResponseMapper", () => {
  const mapper = new ResponseMapper();

  it("should extract nested properties using dot-path notation", () => {
    const source = {
      sku: "TECH-101",
      item: {
        title: "Mechanical Keyboard",
        specs: {
          switch: "Cherry MX Red",
        },
      },
    };

    const fieldMap = {
      offer_id: { from: "$.sku" },
      title: { from: "$.item.title" },
      "attributes.switch": { from: "$.item.specs.switch" },
    };

    const result = mapper.mapOne<Record<string, unknown>>(fieldMap, source);
    expect(result.offer_id).toBe("TECH-101");
    expect(result.title).toBe("Mechanical Keyboard");
    expect(result.attributes).toEqual({ switch: "Cherry MX Red" });
  });

  it("should apply multiply and divide transforms correctly", () => {
    const source = { price_inr: 499.5, discounted_from: 100000 };
    const fieldMap = {
      "price.amount": { from: "$.price_inr", transform: { type: "multiply" as const, value: 100 } },
      "price.original": { from: "$.discounted_from", transform: { type: "divide" as const, value: 100 } },
    };

    const result = mapper.mapOne<{ price: { amount: number; original: number } }>(fieldMap, source);
    expect(result.price.amount).toBe(49950);
    expect(result.price.original).toBe(1000);
  });

  it("should apply enum and boolean_to_enum transforms", () => {
    const source1 = { in_stock_flag: "YES", available_bool: true };
    const source2 = { in_stock_flag: "NO", available_bool: false };

    const fieldMap = {
      stock1: {
        from: "$.in_stock_flag",
        transform: {
          type: "enum" as const,
          enum_map: { YES: "in_stock", NO: "out_of_stock" },
        },
      },
      stock2: {
        from: "$.available_bool",
        transform: {
          type: "boolean_to_enum" as const,
          enum_map: { true: "in_stock", false: "out_of_stock" },
        },
      },
    };

    const res1 = mapper.mapOne<{ stock1: string; stock2: string }>(fieldMap, source1);
    expect(res1.stock1).toBe("in_stock");
    expect(res1.stock2).toBe("in_stock");

    const res2 = mapper.mapOne<{ stock1: string; stock2: string }>(fieldMap, source2);
    expect(res2.stock1).toBe("out_of_stock");
    expect(res2.stock2).toBe("out_of_stock");
  });

  it("should apply default and template transforms", () => {
    const source = { model: "ThinkPad X1" };
    const fieldMap = {
      currency: { from: null, transform: { type: "default" as const, value: "INR" } },
      formatted: { from: "$.model", transform: { type: "template" as const, value: "Model: {value}" } },
    };

    const result = mapper.mapOne<{ currency: string; formatted: string }>(fieldMap, source);
    expect(result.currency).toBe("INR");
    expect(result.formatted).toBe("Model: ThinkPad X1");
  });

  it("should map an array of items cleanly", () => {
    const sources = [
      { id: "1", name: "Alpha", cost: 10 },
      { id: "2", name: "Beta", cost: 20 },
    ];

    const fieldMap = {
      offer_id: { from: "$.id" },
      title: { from: "$.name" },
      "price.amount": { from: "$.cost", transform: { type: "multiply" as const, value: 100 } },
    };

    const results = mapper.mapArray<{ offer_id: string; title: string; price: { amount: number } }>(fieldMap, sources);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Alpha");
    expect(results[0].price.amount).toBe(1000);
    expect(results[1].title).toBe("Beta");
    expect(results[1].price.amount).toBe(2000);
  });
});

describe("RequestMapper", () => {
  const reqMapper = new RequestMapper();

  it("should map canonical request parameters to merchant request body format", () => {
    const canonicalParams = {
      product_id: "SKU-999",
      quantity: 3,
      query: "laptop",
    };

    const requestMapping = {
      "items[0].sku": { from: "$.product_id" },
      "items[0].count": { from: "$.quantity" },
      "search_term": { from: "$.query" },
    };

    const result = reqMapper.map(requestMapping, canonicalParams);
    expect(result).toEqual({
      items: [{ sku: "SKU-999", count: 3 }],
      search_term: "laptop",
    });
  });
});

describe("ConnectorRuntime", () => {
  const sampleManifest: IntegrationManifest = {
    merchant: {
      name: "TechBazaar",
      description: "Electronics Demo Store",
      commerce_domain: "retail",
      currency: "INR",
      base_url: "https://api.techbazaar.local",
    },
    auth: {
      type: "api_key",
      header: "X-Merchant-Key",
      token_env_var: "MOCK_KEY",
    },
    operations: {
      search: {
        method: "POST",
        path: "/api/v1/search",
        request_mapping: {
          search_query: { from: "$.query" },
          page_num: { from: "$.page" },
        },
        response_path: "$.data.products",
      },
      get_product: {
        method: "GET",
        path: "/api/v1/products/:product_id",
      },
      create_checkout: {
        method: "POST",
        path: "/api/v1/cart",
        request_mapping: {
          sku: { from: "$.product_id" },
          qty: { from: "$.quantity" },
        },
      },
      get_checkout: {
        method: "GET",
        path: "/api/v1/cart/:checkout_id",
      },
      confirm_order: {
        method: "POST",
        path: "/api/v1/orders",
        request_mapping: {
          cart_ref: { from: "$.checkout_id" },
          payment_ref: { from: "$.razorpay_payment_id" },
        },
      },
      get_order_status: {
        method: "GET",
        path: "/api/v1/orders/:order_id",
      },
    },
    filters: [
      { key: "category", label: "Category", type: "enum", options: [{ value: "laptop", label: "Laptop" }] },
    ],
    field_mappings: {
      offer: {
        offer_id: { from: "$.sku" },
        title: { from: "$.product_name" },
        description: { from: "$.desc" },
        "price.amount": { from: "$.price_inr", transform: { type: "multiply" as const, value: 100 } },
        "price.currency": { from: null, transform: { type: "default" as const, value: "INR" } },
        availability: {
          from: "$.stock_status",
          transform: {
            type: "enum" as const,
            enum_map: { AVAILABLE: "in_stock", OUT_OF_STOCK: "out_of_stock" },
          },
        },
        "attributes.brand": { from: "$.brand" },
      },
      checkout: {
        checkout_id: { from: "$.cart_id" },
        "total.amount": { from: "$.total_inr", transform: { type: "multiply" as const, value: 100 } },
        "total.currency": { from: null, transform: { type: "default" as const, value: "INR" } },
        available: { from: "$.all_in_stock" },
        expires_at: { from: "$.valid_until" },
      },
      order: {
        order_id: { from: "$.order_number" },
        status: { from: "$.order_state" },
      },
    },
    payment: {
      provider: "razorpay",
      razorpay_key_id_env: "RAZORPAY_KEY_ID",
      razorpay_key_secret_env: "RAZORPAY_KEY_SECRET",
    },
  };

  let runtime: ConnectorRuntime;

  beforeEach(() => {
    process.env.MOCK_KEY = "test-secret-key-123";
    runtime = new ConnectorRuntime(sampleManifest);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute search and normalize results into canonical SearchResult", async () => {
    const mockApiResponse = {
      status: "success",
      data: {
        products: [
          {
            sku: "LEN-YOGA-7",
            product_name: "Lenovo Yoga 7i",
            desc: "2-in-1 Touchscreen Laptop",
            price_inr: 82999,
            stock_status: "AVAILABLE",
            brand: "Lenovo",
          },
        ],
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    } as Response);

    const result = await runtime.search({ query: "yoga" });

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].offer_id).toBe("LEN-YOGA-7");
    expect(result.offers[0].title).toBe("Lenovo Yoga 7i");
    expect(result.offers[0].price).toEqual({ amount: 8299900, currency: "INR" });
    expect(result.offers[0].availability).toBe("in_stock");
    expect(result.offers[0].attributes.brand).toBe("Lenovo");
    expect(result.search_id).toMatch(/^srch_/);
  });

  it("should resolve getProduct with path parameters substituted correctly", async () => {
    const mockProduct = {
      sku: "DELL-XPS-13",
      product_name: "Dell XPS 13",
      desc: "Compact powerhouse",
      price_inr: 119999,
      stock_status: "AVAILABLE",
      brand: "Dell",
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockProduct,
    } as Response);

    const product = await runtime.getProduct("DELL-XPS-13");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.techbazaar.local/api/v1/products/DELL-XPS-13",
      expect.objectEmpty ? expect.anything() : expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-Merchant-Key": "test-secret-key-123",
        }),
      })
    );

    expect(product.offer_id).toBe("DELL-XPS-13");
    expect(product.price.amount).toBe(11999900);
  });

  it("should create checkout and calculate unit_price and total", async () => {
    const mockCheckoutResponse = {
      cart_id: "cart_abc123",
      total_inr: 165998,
      all_in_stock: true,
      valid_until: "2026-08-28T21:00:00Z",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockCheckoutResponse,
    } as Response);

    const checkout = await runtime.createCheckout("LEN-YOGA-7", 2);

    expect(checkout.checkout_id).toBe("cart_abc123");
    expect(checkout.total).toEqual({ amount: 16599800, currency: "INR" });
    expect(checkout.unit_price).toEqual({ amount: 8299900, currency: "INR" });
    expect(checkout.available).toBe(true);
  });

  it("should confirm order with merchant", async () => {
    const mockOrderResponse = {
      order_number: "ORD-998811",
      order_state: "CONFIRMED",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockOrderResponse,
    } as Response);

    const order = await runtime.confirmOrder("cart_abc123", "pay_test_001");

    expect(order.order_id).toBe("ORD-998811");
    expect(order.status).toBe("CONFIRMED");
  });

  it("should project Schema.org semantic metadata when semantics is configured in discovery", async () => {
    const semanticManifest = {
      ...sampleManifest,
      discovery: {
        semantics: {
          vocabulary: "schema.org" as const,
          offer_type: "Product",
          attribute_map: {
            brand: "brand",
            specs: "description",
          },
        },
      },
    };

    const semanticRuntime = new ConnectorRuntime(semanticManifest);

    const mockItem = {
      sku: "LEN-YOGA-7",
      product_name: "Lenovo Yoga 7 14",
      desc: "2-in-1 touchscreen laptop",
      price_inr: 82999,
      stock_status: "AVAILABLE",
      brand: "Lenovo",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockItem,
    } as Response);

    const offer = await semanticRuntime.getProduct("LEN-YOGA-7");
    expect(offer.semantic).toBeDefined();
    expect(offer.semantic?.type).toBe("Product");
    expect(offer.semantic?.properties.brand).toBe("Lenovo");
  });

  it("should inject sessionToken into outbound request headers when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        cart_id: "cart_session_123",
        total_inr: 500,
        all_in_stock: true,
      }),
    } as Response);

    await runtime.createCheckout("TECH-101", 1, undefined, undefined, "user_scoped_jwt_token");

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/cart"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Merchant-Key": "Bearer user_scoped_jwt_token",
        }),
      })
    );
  });
});
