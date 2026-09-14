import { createRemoteJWKSet, jwtVerify } from "jose";
import { ForbiddenError, UnauthorizedError } from "@job-hunter-v2/domain";

export interface OperatorIdentity { issuer: string; subject: string }
/** Dedicated verifier: no development-token or candidate membership fallback. */
export class OperatorTokenVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;
  constructor(private readonly config: { issuer: string; audience: string; jwksUrl: URL }) { this.keys = createRemoteJWKSet(config.jwksUrl); }
  async verify(header: string | undefined): Promise<OperatorIdentity> {
    const token = /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
    if (!token) throw new UnauthorizedError("Operator sign-in is required.");
    let payload;
    try { ({ payload } = await jwtVerify(token, this.keys, { issuer: this.config.issuer, audience: this.config.audience, algorithms: ["RS256", "ES256"], requiredClaims: ["sub", "exp", "auth_time", "amr"] })); }
    catch { throw new UnauthorizedError("Operator token could not be verified."); }
    const now = Date.now() / 1000;
    if (typeof payload.auth_time !== "number" || payload.auth_time > now || now - payload.auth_time > 900 || !Array.isArray(payload.amr) || !payload.amr.includes("mfa")) throw new ForbiddenError("Recent MFA sign-in is required for operator access.");
    return { issuer: this.config.issuer, subject: payload.sub! };
  }
}
