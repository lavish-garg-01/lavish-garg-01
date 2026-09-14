import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

/** Separate from candidate authentication; tokens are opaque, expiring and revocable. */
export class AdminAuth {
  private readonly salt = randomBytes(32);
  private readonly passwordHash: Buffer;
  private readonly sessions = new Map<string, number>();
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(readonly email: string, password: string, private readonly now = Date.now) {
    this.passwordHash = scryptSync(password, this.salt, 32);
  }
  retryAfterSeconds(ip: string): number {
    const now = this.now();
    for (const [key, attempt] of this.attempts) if (attempt.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(ip);
    if (attempt && attempt.count >= 10) return Math.max(1, Math.ceil((attempt.until - now) / 1000));
    if (!attempt && this.attempts.size >= 1000) return Math.max(1, Math.ceil((Math.min(...Array.from(this.attempts.values(), value => value.until)) - now) / 1000));
    return 0;
  }
  login(email: string, password: string, ip: string): string | null {
    if (this.retryAfterSeconds(ip)) return null;
    const now = this.now();
    for (const [key, attempt] of this.attempts) if (attempt.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(ip) ?? { count: 0, until: now + 15 * 60_000 };
    attempt.count++; this.attempts.set(ip, attempt);
    const valid = timingSafeEqual(scryptSync(password, this.salt, 32), this.passwordHash);
    if (!valid || email.trim().toLowerCase() !== this.email.toLowerCase()) return null;
    this.attempts.delete(ip);
    for (const [key, expires] of this.sessions) if (expires <= now) this.sessions.delete(key);
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(this.key(token), now + 8 * 60 * 60_000);
    return token;
  }
  private key(token: string) { return createHash("sha256").update(token).digest("hex"); }
  verify(authorization?: string): boolean {
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    return Boolean(token && (this.sessions.get(this.key(token)) ?? 0) > this.now());
  }
  logout(authorization?: string) { const token = authorization?.slice(7); if (token) this.sessions.delete(this.key(token)); }
}

export async function registerAdminAuth(app: FastifyInstance, auth: AdminAuth) {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.routeOptions.url === "/v1/admin/login") return;
    if (!auth.verify(request.headers.authorization)) return reply.code(401).send({ error: { code: "ADMIN_AUTH_REQUIRED", message: "Sign in to the admin workspace." } });
  });
  app.post("/v1/admin/login", { bodyLimit: 2048 }, async (request, reply) => {
    const retryAfter = auth.retryAfterSeconds(request.ip);
    if (retryAfter) return reply.code(429).header("Retry-After", String(retryAfter)).send({ error: { code: "ADMIN_LOGIN_RATE_LIMITED", message: `Too many login attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` } });
    const body = request.body as { email?: unknown; password?: unknown } | null;
    const token = body && typeof body.email === "string" && typeof body.password === "string" && body.password.length <= 512
      ? auth.login(body.email, body.password, request.ip) : null;
    if (!token) return reply.code(401).send({ error: { code: "ADMIN_LOGIN_FAILED", message: "Email or password does not match the running API. Copy ADMIN_EMAIL and ADMIN_PASSWORD from v2/.env without surrounding quotes. If you changed them, restart the API." } });
    return { token, email: auth.email, expiresInSeconds: 28800 };
  });
  app.get("/v1/admin/session", async () => ({ email: auth.email }));
  app.post("/v1/admin/logout", async (request) => { auth.logout(request.headers.authorization); return { ok: true }; });
}
