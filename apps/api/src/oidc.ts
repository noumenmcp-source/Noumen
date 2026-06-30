import { randomUUID } from "node:crypto";

/**
 * Minimal OIDC Authorization-Code seam. The flow is provider-agnostic: a dev
 * {@link MockOidcProvider} runs with no external service, and a real IdP
 * (Auth0/Cognito/Dex/Google) plugs in by implementing {@link OidcProvider}
 * against its discovery + token + JWKS endpoints. Verified claims are mapped to
 * an existing tenant/user and exchanged for the platform's own bearer token, so
 * the rest of the API keeps using {@link import("./auth.js").AuthPrincipal}.
 */

/** The subset of verified ID-token claims the platform consumes. */
export interface OidcClaims {
  readonly sub: string;
  readonly email?: string;
}

export interface OidcProvider {
  /** URL to send the browser to for authentication. */
  authorizeUrl(state: string, redirectUri: string): string;
  /** Exchange the callback `code` for verified claims (real providers verify the ID token). */
  exchangeCode(code: string, redirectUri: string): Promise<OidcClaims>;
}

/**
 * Self-contained mock IdP for dev/tests: `authorizeUrl` loops straight back to
 * the callback with a known code, so the whole flow works offline. Replace with
 * a real provider in production.
 */
export class MockOidcProvider implements OidcProvider {
  constructor(private readonly claimsByCode: Readonly<Record<string, OidcClaims>> = { "mock-code": { sub: "mock-user", email: "dev@example.com" } }) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(redirectUri);
    url.searchParams.set("code", "mock-code");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<OidcClaims> {
    const claims = this.claimsByCode[code];
    if (!claims) throw new Error("invalid_code");
    return claims;
  }
}

/** Short-lived CSRF state store for the login round-trip. */
export class OidcStateStore {
  readonly #states = new Map<string, number>();
  constructor(private readonly ttlMs = 600_000, private readonly now: () => number = () => Date.now()) {}

  issue(): string {
    const state = randomUUID();
    this.#states.set(state, this.now() + this.ttlMs);
    return state;
  }

  /** One-time: consumes the state and reports whether it was valid + unexpired. */
  consume(state: string): boolean {
    const expiry = this.#states.get(state);
    if (expiry === undefined) return false;
    this.#states.delete(state);
    return expiry > this.now();
  }
}
