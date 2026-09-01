/**
 * Extended Mapper Transforms Unit Tests
 * Tests concat, split, substring, regex_extract, to_number, to_string,
 * flatten, coalesce, conditional, date_format, and foreach transformations.
 */

import { describe, it, expect } from "vitest";
import { ResponseMapper } from "../../src/connector/mapper.js";

describe("ResponseMapper Extended Transforms", () => {
  const mapper = new ResponseMapper();

  it("should perform concat transform on array or fields in context", () => {
    // Array value
    const res1 = mapper.applyTransform(["Super", "Mario", "Bros"], {
      type: "concat",
      separator: " - ",
    });
    expect(res1).toBe("Super - Mario - Bros");

    // Root context fields
    const root = { first: "John", last: "Doe" };
    const res2 = mapper.applyTransform(null, {
      type: "concat",
      fields: ["$.first", "$.last"],
      separator: " ",
    }, root);
    expect(res2).toBe("John Doe");
  });

  it("should perform split transform into string array", () => {
    const res = mapper.applyTransform("tag1, tag2, tag3", {
      type: "split",
      separator: ",",
    });
    expect(res).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("should perform substring slicing", () => {
    const res = mapper.applyTransform("SKU_PROD_12345", {
      type: "substring",
      start: 4,
      length: 4,
    });
    expect(res).toBe("PROD");
  });

  it("should perform regex_extract with match group", () => {
    const res = mapper.applyTransform("Order #98765 confirmed", {
      type: "regex_extract",
      regex: "#(\\d+)",
    });
    expect(res).toBe("98765");
  });

  it("should perform to_number and to_string casting", () => {
    const num = mapper.applyTransform("49900", { type: "to_number" });
    expect(num).toBe(49900);

    const str = mapper.applyTransform(1234, { type: "to_string" });
    expect(str).toBe("1234");
  });

  it("should perform flatten on nested array", () => {
    const res = mapper.applyTransform([[1, 2], [3, 4]], { type: "flatten" });
    expect(res).toEqual([1, 2, 3, 4]);
  });

  it("should perform coalesce across multiple fallback fields", () => {
    const root = { primary_img: null, fallback_img: "https://img.local/item.jpg" };
    const res = mapper.applyTransform(null, {
      type: "coalesce",
      fields: ["$.primary_img", "$.fallback_img"],
      value: "https://img.local/default.jpg",
    }, root);
    expect(res).toBe("https://img.local/item.jpg");
  });

  it("should evaluate conditional transforms with operators (eq, gte, in)", () => {
    const root = { stock_level: 15, status_code: "ACT" };

    // gte condition
    const resGte = mapper.applyTransform(null, {
      type: "conditional",
      condition: {
        field: "$.stock_level",
        operator: "gte",
        value: 10,
        then: "in_stock",
        else: "low_stock",
      },
    }, root);
    expect(resGte).toBe("in_stock");

    // in condition
    const resIn = mapper.applyTransform(null, {
      type: "conditional",
      condition: {
        field: "$.status_code",
        operator: "in",
        value: ["ACT", "LIVE"],
        then: "active",
        else: "inactive",
      },
    }, root);
    expect(resIn).toBe("active");
  });

  it("should format date into ISO string", () => {
    const res = mapper.applyTransform("2026-08-30 14:30:00 UTC", { type: "date_format" });
    expect(res).toBe("2026-08-30T14:30:00.000Z");
  });

  it("should evaluate array-based conditions transform with when/then/otherwise", () => {
    const root = { delivery_type: "express", tier: "gold" };

    const res = mapper.applyTransform("express", {
      type: "conditional",
      conditions: [
        { when: { equals: "standard" }, then: 5000 },
        { when: { equals: "express" }, then: 15000 },
      ],
      otherwise: 0,
    }, root);
    expect(res).toBe(15000);
  });

  it("should parse custom date formats like DD/MM/YYYY and output unix seconds or ms", () => {
    const resSec = mapper.applyTransform("25/12/2026", {
      type: "date_format",
      input_format: "DD/MM/YYYY",
      output_format: "unix_seconds",
    });
    expect(resSec).toBe(1798156800); // 2026-12-25T00:00:00.000Z in seconds

    const resIso = mapper.applyTransform("25/12/2026", {
      type: "date_format",
      input_format: "DD/MM/YYYY",
      output_format: "iso8601",
    });
    expect(resIso).toBe("2026-12-25T00:00:00.000Z");
  });

  it("should extract deep value using json_path transform", () => {
    const data = { store: { inventory: { count: 42 } } };
    const res = mapper.applyTransform(data, {
      type: "json_path",
      value: "$.store.inventory.count",
    });
    expect(res).toBe(42);
  });

  it("should support paths array in concat and coalesce", () => {
    const root = { street: "123 Main St", city: "Bengaluru", pincode: "560001" };
    const address = mapper.applyTransform(null, {
      type: "concat",
      paths: ["$.street", "$.city", "$.pincode"],
      separator: ", ",
    }, root);
    expect(address).toBe("123 Main St, Bengaluru, 560001");

    const fallbackRoot = { primary_code: null, alt_code: null };
    const fallbackRes = mapper.applyTransform(null, {
      type: "coalesce",
      paths: ["$.primary_code", "$.alt_code"],
      fallback: "DEFAULT_CODE",
    }, fallbackRoot);
    expect(fallbackRes).toBe("DEFAULT_CODE");
  });

  it("should map nested arrays with foreach transform", () => {
    const items = [
      { id: "1", val: 100 },
      { id: "2", val: 200 },
    ];
    const res = mapper.applyTransform(items, {
      type: "foreach",
      value: {
        item_id: { from: "$.id" },
        price: { from: "$.val", transform: { type: "multiply", value: 100 } },
      },
    });
    expect(res).toEqual([
      { item_id: "1", price: 10000 },
      { item_id: "2", price: 20000 },
    ]);
  });
});
