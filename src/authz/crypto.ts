/**
 * AP2 Cryptographic Utilities
 * Implements ECDSA P-256 (ES256) asymmetric signing, verification,
 * JSON Canonicalization Scheme (RFC 8785 JCS), JWK import/export,
 * and JWS (RFC 7515) compact representation.
 */

import crypto from "crypto";

export interface PublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid?: string;
  use?: string;
  alg?: string;
}

export interface EcKeyPair {
  publicKey: crypto.KeyObject;
  privateKey: crypto.KeyObject;
  publicKeyPem: string;
  privateKeyPem: string;
  publicJwk: PublicJwk;
}

/**
 * Base64url encode a string or Buffer.
 */
export function base64urlEncode(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

/**
 * Base64url decode into a Buffer.
 */
export function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

/**
 * Base64url decode into a parsed JSON object.
 */
export function base64urlDecodeJson<T = Record<string, unknown>>(str: string): T {
  return JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
}

/**
 * Deterministically serialize a JSON object according to JSON Canonicalization Scheme (RFC 8785).
 * All object keys are sorted lexicographically by Unicode code point.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => (item === undefined ? "null" : canonicalJsonStringify(item))).join(",") + "]";
  }
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined && typeof rec[k] !== "function" && typeof rec[k] !== "symbol")
    .sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJsonStringify(rec[k])}`
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Generate a new ECDSA P-256 (prime256v1) key pair for AP2 asymmetric signing.
 */
export function generateEcKeyPair(kid?: string): EcKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const jwkExport = publicKey.export({ format: "jwk" }) as unknown as PublicJwk;

  const publicJwk: PublicJwk = {
    kty: "EC",
    crv: "P-256",
    x: jwkExport.x,
    y: jwkExport.y,
    ...(kid ? { kid } : {}),
  };

  return {
    publicKey,
    privateKey,
    publicKeyPem,
    privateKeyPem,
    publicJwk,
  };
}

/**
 * Convert a public JWK to a Node.js crypto.KeyObject.
 */
export function jwkToKeyObject(jwk: PublicJwk | Record<string, unknown>): crypto.KeyObject {
  return crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: jwk.x,
      y: jwk.y,
    } as any,
    format: "jwk",
  });
}

/**
 * Sign a payload using ECDSA P-256 with SHA-256 (ES256) in compact JWS format.
 * Format: <header_b64>.<payload_b64>.<signature_b64>
 * Uses raw IEEE P1363 (R || S, 64-byte) signature encoding per JWS RFC 7515 / RFC 7518.
 */
export function signJws(
  payload: Record<string, unknown> | string,
  privateKey: crypto.KeyObject | string,
  options?: {
    kid?: string;
    typ?: string;
    headerOverrides?: Record<string, unknown>;
  }
): string {
  const header = {
    alg: "ES256",
    typ: options?.typ || "JWT",
    ...(options?.kid ? { kid: options.kid } : {}),
    ...options?.headerOverrides,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const payloadStr =
    typeof payload === "string" ? payload : canonicalJsonStringify(payload);
  const encodedPayload = base64urlEncode(payloadStr);

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const keyObj =
    typeof privateKey === "string"
      ? crypto.createPrivateKey(privateKey)
      : privateKey;

  const signature = crypto.sign("SHA256", Buffer.from(signingInput, "utf8"), {
    key: keyObj,
    dsaEncoding: "ieee-p1363",
  });

  const encodedSignature = base64urlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Cryptographically verify a compact JWS token using an ECDSA P-256 public key.
 */
export function verifyJws<T = Record<string, unknown>>(
  jwsString: string,
  publicKey: crypto.KeyObject | string | PublicJwk | Record<string, unknown>
): { valid: boolean; payload?: T; header?: Record<string, unknown>; error?: string } {
  try {
    const parts = jwsString.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Malformed JWS token (must have 3 parts separated by dots)" };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = base64urlDecodeJson<Record<string, unknown>>(encodedHeader);
    const payload = base64urlDecodeJson<T>(encodedPayload);

    if (header.alg !== "ES256") {
      return { valid: false, error: `Unsupported algorithm: expected ES256, got ${header.alg}` };
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = base64urlDecode(encodedSignature);

    let keyObj: crypto.KeyObject;
    if (typeof publicKey === "string") {
      keyObj = crypto.createPublicKey(publicKey);
    } else if ("kty" in publicKey && publicKey.kty === "EC") {
      keyObj = jwkToKeyObject(publicKey);
    } else {
      keyObj = publicKey as crypto.KeyObject;
    }

    const valid = crypto.verify(
      "SHA256",
      Buffer.from(signingInput, "utf8"),
      { key: keyObj, dsaEncoding: "ieee-p1363" },
      signature
    );

    if (!valid) {
      return { valid: false, error: "JWS signature verification failed (tampered or invalid key)" };
    }

    return { valid: true, payload, header };
  } catch (err) {
    return { valid: false, error: `JWS verification error: ${(err as Error).message}` };
  }
}

/**
 * Compute cryptographic SHA-256 hash over an authoritative merchant Checkout JWT.
 * Returns base64url-encoded hash string per AP2 standard.
 */
export function hashCheckoutJwt(checkoutJwt: string): string {
  return crypto.createHash("sha256").update(checkoutJwt).digest("base64url");
}
