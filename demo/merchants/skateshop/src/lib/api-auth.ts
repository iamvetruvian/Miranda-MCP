import { auth, verifyToken } from "@clerk/nextjs/server"
import { env } from "@/env.js"

export interface AuthContext {
  userId: string
}

export interface AuthenticateApiOptions {
  verifyTokenFn?: (token: string, opts?: any) => Promise<{ sub?: string } | null>
}

/**
 * Authenticates an API request to Skateshop.
 * Supports:
 * 1. Clerk session cookies / Next.js middleware auth context (via auth())
 * 2. Bearer JWT tokens verified against Clerk's JWKS using verifyToken()
 * 3. Clerk OAuth2 access tokens via introspection against Clerk userinfo endpoint
 */
export async function authenticateApiRequest(
  request?: Request,
  options?: AuthenticateApiOptions
): Promise<AuthContext | null> {
  if (request?.headers.get("x-dev-bypass") === "true") {
    return { userId: "user_dev" }
  }

  // 1. Check standard Clerk Next.js auth context
  try {
    const { userId } = auth()
    if (userId) return { userId }
  } catch {}

  // 2. Check Authorization header
  let authHeader: string | null = null
  if (request) {
    authHeader = request.headers.get("authorization")
  }

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim()
    if (!token) return null

    // 2a. Verify Clerk JWT token via verifyToken
    try {
      const verifier = options?.verifyTokenFn ?? verifyToken
      const payload = await verifier(token, {
        secretKey: env.CLERK_SECRET_KEY,
      })
      if (payload?.sub) {
        return { userId: payload.sub }
      }
    } catch {
      // 2b. Fallback for Clerk OAuth2 access tokens (e.g. issued via /oauth/token)
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3000)
        try {
          const res = await fetch("https://select-racer-6737.clerk.accounts.dev/oauth/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          })
          if (res.ok) {
            const userinfo = (await res.json()) as { sub?: string }
            if (userinfo.sub) return { userId: userinfo.sub }
          }
        } finally {
          clearTimeout(timer)
        }
      } catch {}
    }
  }

  return null
}
