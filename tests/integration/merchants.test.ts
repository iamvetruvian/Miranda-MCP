import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import { startTechBazaarServer } from "../../demo/merchants/electronics-store/server.js";
import { startBookstoreServer } from "../../demo/merchants/bookstore/server.js";
import { createTicketingApp } from "../../demo/merchants/ticketing/server.js";
import { ConnectorRuntime } from "../../src/connector/runtime.js";
import { IntegrationManifest } from "../../src/types/manifest.js";

describe("Demo Merchants End-to-End Integration", () => {
  let techServer: http.Server;
  let bookServer: http.Server;
  let ticketServer: http.Server;
  const TECH_PORT = 4001;
  const BOOK_PORT = 4002;
  const TICKET_PORT = 4003;

  beforeAll(async () => {
    techServer = startTechBazaarServer(TECH_PORT);
    bookServer = startBookstoreServer(BOOK_PORT);
    ticketServer = createTicketingApp().listen(TICKET_PORT);
    // Give servers a moment to bind
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => techServer.close(() => resolve()));
    await new Promise<void>((resolve) => bookServer.close(() => resolve()));
    await new Promise<void>((resolve) => ticketServer.close(() => resolve()));
  });

  describe("TechBazaar (Electronics Store - POST Search & Rupees-to-Paise Mapping)", () => {
    let runtime: ConnectorRuntime;

    beforeAll(() => {
      const manifestPath = path.resolve(process.cwd(), "demo/merchants/electronics-store/merchant-config.json");
      const manifest: IntegrationManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      runtime = new ConnectorRuntime(manifest);
    });

    it("should search for laptops and normalize offers with paise amounts", async () => {
      const result = await runtime.search({ query: "laptop" });

      expect(result.offers.length).toBeGreaterThanOrEqual(3);
      expect(result.offers.every((o) => o.price.currency === "INR")).toBe(true);
      expect(result.offers.some((o) => o.offer_id === "LEN-LAP-001")).toBe(true);

      const lenovo = result.offers.find((o) => o.offer_id === "LEN-LAP-001")!;
      expect(lenovo.title).toContain("Lenovo IdeaPad");
      expect(lenovo.price.amount).toBe(6499900); // 64999 * 100
      expect(lenovo.availability).toBe("in_stock");
    });

    it("should return dynamic refinements alongside search results", async () => {
      const result = await runtime.search({ query: "laptop" });

      expect(result.refinements).toBeDefined();
      expect(result.refinements.length).toBeGreaterThanOrEqual(2);

      const brandRefinement = result.refinements.find((r) => r.key === "brand");
      expect(brandRefinement).toBeDefined();
      expect(brandRefinement?.options).toBeDefined();
      expect(brandRefinement?.options?.some((opt) => opt.value === "Lenovo" || opt.value === "Dell" || opt.value === "Apple")).toBe(true);

      const priceRefinement = result.refinements.find((r) => r.key === "price");
      expect(priceRefinement).toBeDefined();
      expect(priceRefinement?.type).toBe("range");
    });

    it("should filter electronics by brand", async () => {
      const result = await runtime.search({
        query: "",
        filters: { brand: "Apple" },
      });

      expect(result.offers.length).toBeGreaterThanOrEqual(2);
      expect(result.offers.every((o) => o.attributes.brand === "Apple")).toBe(true);
    });

    it("should fetch single product details", async () => {
      const offer = await runtime.getProduct("SAM-S24-ULTRA");

      expect(offer.offer_id).toBe("SAM-S24-ULTRA");
      expect(offer.title).toContain("Galaxy S24 Ultra");
      expect(offer.price.amount).toBe(12999900);
      expect(offer.availability).toBe("in_stock");
    });

    it("should create checkout and confirm order with TechBazaar", async () => {
      const checkout = await runtime.createCheckout("LEN-LAP-001", 1);

      expect(checkout.checkout_id).toMatch(/^tb_cart_/);
      expect(checkout.total.amount).toBe(6499900);
      expect(checkout.available).toBe(true);

      const order = await runtime.confirmOrder(checkout.checkout_id, "pay_test_tb_123");
      expect(order.order_id).toMatch(/^TB-ORD-/);
      expect(order.status).toBe("CONFIRMED");
    });
  });

  describe("PageTurner Books (Bookstore - GET Search & Paise Direct Mapping)", () => {
    let runtime: ConnectorRuntime;

    beforeAll(() => {
      const manifestPath = path.resolve(process.cwd(), "demo/merchants/bookstore/merchant-config.json");
      const manifest: IntegrationManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      runtime = new ConnectorRuntime(manifest);
    });

    it("should search for books by keyword using GET query parameters", async () => {
      const result = await runtime.search({ query: "Java" });

      expect(result.offers.length).toBeGreaterThanOrEqual(1);
      const effectiveJava = result.offers.find((b) => b.offer_id === "978-0134685991")!;
      expect(effectiveJava.title).toContain("Effective Java");
      expect(effectiveJava.price.amount).toBe(389900);
      expect(effectiveJava.availability).toBe("in_stock");
      expect(effectiveJava.attributes.author).toBe("Joshua Bloch");
    });

    it("should return static refinements for PageTurner Books", async () => {
      const result = await runtime.search({ query: "" });

      expect(result.refinements).toBeDefined();
      expect(result.refinements.length).toBeGreaterThanOrEqual(2);

      const genreRefinement = result.refinements.find((r) => r.key === "genre");
      expect(genreRefinement).toBeDefined();
      expect(genreRefinement?.options?.some((o) => o.value === "technology")).toBe(true);
    });

    it("should filter books by genre (technology)", async () => {
      const result = await runtime.search({
        query: "",
        filters: { genre: "technology" },
      });

      expect(result.offers.length).toBeGreaterThanOrEqual(3);
      expect(result.offers.every((b) => b.attributes.genre === "technology")).toBe(true);
    });

    it("should fetch single book by ISBN", async () => {
      const book = await runtime.getProduct("978-0201616224");

      expect(book.offer_id).toBe("978-0201616224");
      expect(book.title).toContain("The Pragmatic Programmer");
      expect(book.price.amount).toBe(425000);
    });

    it("should create cart and confirm purchase with PageTurner Books", async () => {
      const checkout = await runtime.createCheckout("978-0134685991", 2);

      expect(checkout.checkout_id).toMatch(/^pt_cart_/);
      expect(checkout.total.amount).toBe(389900 * 2);
      expect(checkout.available).toBe(true);

      const order = await runtime.confirmOrder(checkout.checkout_id, "pay_test_pt_999");
      expect(order.order_id).toMatch(/^PT-BOOK-ORD-/);
      expect(order.status).toBe("CONFIRMED");
    });
  });

  describe("TicketVerse (Cinema Ticketing — Domain Discovery, Ephemeral Offers & Full Lifecycle)", () => {
    let runtime: ConnectorRuntime;

    beforeAll(() => {
      const manifestPath = path.resolve(process.cwd(), "demo/merchants/ticketing/merchant-config.json");
      const manifest: IntegrationManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      runtime = new ConnectorRuntime(manifest);
    });

    it("should search for showtimes using domain parameters (city + date)", async () => {
      const result = await runtime.search({
        query: "Avengers",
        parameters: { city: "Mumbai", date: "2026-09-01" },
      });

      expect(result.offers.length).toBeGreaterThanOrEqual(2);
      expect(result.total_results).toBeGreaterThanOrEqual(2);
      expect(result.offers.every((o) => o.price.currency === "INR")).toBe(true);

      const imaxShow = result.offers.find((o) => o.offer_id === "show_avengers_mum_imax_2100")!;
      expect(imaxShow).toBeDefined();
      expect(imaxShow.title).toBe("Avengers: Doomsday");
      expect(imaxShow.price.amount).toBe(85000); // 850 INR * 100 paise
      expect(imaxShow.attributes.format).toBe("IMAX 2D");
      expect(imaxShow.attributes.cinema).toBe("PVR INOX Phoenix Palladium");
      expect(imaxShow.expires_at).toBeDefined();
    });

    it("should return dynamic cinema and format refinements for showtimes", async () => {
      const result = await runtime.search({
        query: "",
        parameters: { city: "Mumbai", date: "2026-09-01" },
      });

      expect(result.refinements).toBeDefined();
      expect(result.refinements.length).toBe(2);

      const formatRefinement = result.refinements.find((r) => r.key === "format");
      expect(formatRefinement).toBeDefined();
      expect(formatRefinement?.options?.some((o) => o.value === "IMAX 2D")).toBe(true);
    });

    it("should filter showtimes by screen format (IMAX 2D)", async () => {
      const result = await runtime.search({
        query: "",
        parameters: { city: "Mumbai", date: "2026-09-01" },
        filters: { format: "IMAX 2D" },
      });

      expect(result.offers.length).toBeGreaterThanOrEqual(2);
      expect(result.offers.every((o) => o.attributes.format === "IMAX 2D")).toBe(true);
    });

    it("should fetch single showtime offer with ephemeral hold expiry", async () => {
      const showtime = await runtime.getProduct("show_avengers_mum_imax_2100");

      expect(showtime.offer_id).toBe("show_avengers_mum_imax_2100");
      expect(showtime.title).toBe("Avengers: Doomsday");
      expect(showtime.price.amount).toBe(85000);
      expect(showtime.expires_at).toBeDefined();
      expect(new Date(showtime.expires_at!).getTime()).toBeGreaterThan(Date.now());
    });

    it("should create booking checkout, confirm order with PNR, and cancel order", async () => {
      // 1. Create booking checkout
      const checkout = await runtime.createCheckout("show_avengers_mum_imax_2100", 2, { seat_class: "Recliner" });

      expect(checkout.checkout_id).toMatch(/^tkt_book_/);
      expect(checkout.total.amount).toBe(250000); // 1250 * 2 * 100
      expect(checkout.available).toBe(true);
      expect(checkout.expires_at).toBeDefined();

      // 2. Confirm booking order
      const order = await runtime.confirmOrder(checkout.checkout_id, "pay_test_tkt_123");
      expect(order.order_id).toMatch(/^TKT-PNR-/);
      expect(order.status).toBe("CONFIRMED");

      // 3. Cancel booking order
      const cancelled = await runtime.cancelOrder(order.order_id, "User requested refund");
      expect(cancelled.order_id).toBe(order.order_id);
      expect(cancelled.status).toBe("CANCELLED");
    });
  });
});
