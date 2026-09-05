import { describe, it, expect } from "vitest";
import {
  generateEcKeyPair,
  signJws,
  verifyJws,
  canonicalJsonStringify,
  hashCheckoutJwt,
  jwkToKeyObject,
} from "../../src/authz/crypto.js";

describe("AP2 Cryptography Engine", () => {
  it("should canonically stringify JSON objects deterministically per RFC 8785", () => {
    const a = { z: 1, a: "hello", m: [3, 2, 1], nested: { b: 2, a: 1 } };
    const b = { nested: { a: 1, b: 2 }, a: "hello", m: [3, 2, 1], z: 1 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(canonicalJsonStringify(a)).toBe('{"a":"hello","m":[3,2,1],"nested":{"a":1,"b":2},"z":1}');
  });

  it("should generate ECDSA P-256 keypair with standard JWK", () => {
    const keyPair = generateEcKeyPair("merchant-key-1");
    expect(keyPair.publicJwk.kty).toBe("EC");
    expect(keyPair.publicJwk.crv).toBe("P-256");
    expect(keyPair.publicJwk.kid).toBe("merchant-key-1");
    expect(keyPair.publicJwk.x).toBeDefined();
    expect(keyPair.publicJwk.y).toBeDefined();
    expect(keyPair.publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(keyPair.privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("should sign and verify JWS token with ES256", () => {
    const keyPair = generateEcKeyPair("agent-session-key");
    const payload = {
      vct: "mandate.payment.1",
      transaction_id: "txn_123",
      amount: 59999,
      currency: "INR",
    };

    const jws = signJws(payload, keyPair.privateKey, { kid: "agent-session-key" });
    expect(jws.split(".").length).toBe(3);

    const verification = verifyJws(jws, keyPair.publicKey);
    expect(verification.valid).toBe(true);
    expect(verification.payload).toEqual(payload);
    expect(verification.header?.alg).toBe("ES256");
    expect(verification.header?.kid).toBe("agent-session-key");
  });

  it("should verify JWS token directly using Public JWK", () => {
    const keyPair = generateEcKeyPair("user-key");
    const payload = { vct: "mandate.payment.open.1", budget: 10000 };
    const jws = signJws(payload, keyPair.privateKey);

    const verification = verifyJws(jws, keyPair.publicJwk);
    expect(verification.valid).toBe(true);
    expect(verification.payload).toEqual(payload);
  });

  it("should detect tampered payload or signature in JWS", () => {
    const keyPair = generateEcKeyPair();
    const jws = signJws({ amount: 100 }, keyPair.privateKey);
    const [h, p, s] = jws.split(".");

    // Tamper with payload (change 100 to 999999)
    const tamperedPayload = Buffer.from(JSON.stringify({ amount: 999999 })).toString("base64url");
    const tamperedJws = `${h}.${tamperedPayload}.${s}`;

    const verification = verifyJws(tamperedJws, keyPair.publicKey);
    expect(verification.valid).toBe(false);
    expect(verification.error).toContain("verification failed");
  });

  it("should compute SHA-256 base64url checkout hash", () => {
    const checkoutJwt = "eyJhbGciOiJFUzI1NiJ9.sample_payload.sig";
    const hash = hashCheckoutJwt(checkoutJwt);
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(20);
    // Deterministic hash
    expect(hashCheckoutJwt(checkoutJwt)).toBe(hash);
  });
});
