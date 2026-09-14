import type { AccountStatus, AccountType, MembershipRole } from "@job-hunter-v2/contracts";
export * from "./operator.js";
import { ForbiddenError, UnauthorizedError, type Clock, systemClock } from "@job-hunter-v2/domain";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export interface ExternalIdentity {
  provider: string;
  providerSubject: string;
  email: string | null;
}

export interface VerifiedIdentity extends ExternalIdentity {
  tokenId: string | null;
  expiresAt: Date;
}

export interface IdentityTokenVerifier {
  verifyAuthorizationHeader(header: string | undefined): Promise<VerifiedIdentity>;
}

export interface OidcIdentityVerifierConfig {
  provider: string;
  issuer: string;
  audience: string | readonly string[];
  jwksUrl: URL;
  clockToleranceSeconds?: number;
}

function bearerToken(header: string | undefined): string {
  if (!header) throw new UnauthorizedError("Authentication is required.");
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  if (!match?.[1]) throw new UnauthorizedError("The authorization header is invalid.");
  return match[1];
}

function verifiedIdentityFromPayload(
  payload: JWTPayload,
  provider: string,
  now: Date
): VerifiedIdentity {
  if (!payload.sub || !payload.exp || payload.exp * 1_000 <= now.getTime()) {
    throw new UnauthorizedError("The access token is expired or missing its subject.");
  }
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  return {
    provider,
    providerSubject: payload.sub,
    email: email || null,
    tokenId: typeof payload.jti === "string" ? payload.jti : null,
    expiresAt: new Date(payload.exp * 1_000)
  };
}

export class OidcJwtIdentityVerifier implements IdentityTokenVerifier {
  private readonly keySet: JWTVerifyGetKey;

  constructor(
    private readonly config: OidcIdentityVerifierConfig,
    private readonly clock: Clock = systemClock
  ) {
    if (!config.provider.trim() || !config.issuer.trim()) {
      throw new Error("OIDC provider and issuer are required.");
    }
    this.keySet = createRemoteJWKSet(config.jwksUrl);
  }

  async verifyAuthorizationHeader(header: string | undefined): Promise<VerifiedIdentity> {
    const token = bearerToken(header);
    try {
      const result = await jwtVerify(token, this.keySet, {
        issuer: this.config.issuer,
        audience: typeof this.config.audience === "string"
          ? this.config.audience
          : [...this.config.audience],
        algorithms: ["RS256", "ES256"],
        clockTolerance: this.config.clockToleranceSeconds ?? 5,
        currentDate: this.clock.now()
      });
      return verifiedIdentityFromPayload(result.payload, this.config.provider, this.clock.now());
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError("The access token could not be verified.");
    }
  }
}

export class StaticIdentityTokenVerifier implements IdentityTokenVerifier {
  constructor(private readonly verify: (token: string) => Promise<VerifiedIdentity>) {}

  async verifyAuthorizationHeader(header: string | undefined): Promise<VerifiedIdentity> {
    return this.verify(bearerToken(header));
  }
}

export interface IdentityAccount {
  accountId: string;
  userId: string;
  accountType: AccountType;
  accountStatus: AccountStatus;
  userStatus: AccountStatus;
  membershipRole: MembershipRole;
}

export interface CreateAccountWithOwnerInput {
  identity: ExternalIdentity;
  accountType: AccountType;
  createdAt: Date;
}

export interface IdentityRepository {
  findByExternalIdentity(identity: Pick<ExternalIdentity, "provider" | "providerSubject">): Promise<IdentityAccount | null>;
  createAccountWithOwner(input: CreateAccountWithOwnerInput): Promise<IdentityAccount>;
}

export class IdentityService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly clock: Clock = systemClock
  ) {}

  async ensureNormalAccount(identity: ExternalIdentity): Promise<IdentityAccount> {
    const existing = await this.repository.findByExternalIdentity(identity);
    if (existing) return requireActiveIdentity(existing);

    try {
      return await this.repository.createAccountWithOwner({
        identity,
        accountType: "NORMAL",
        createdAt: this.clock.now()
      });
    } catch (error) {
      const concurrent = await this.repository.findByExternalIdentity(identity);
      if (concurrent) return requireActiveIdentity(concurrent);
      throw error;
    }
  }
}

function requireActiveIdentity(identity: IdentityAccount): IdentityAccount {
  if (identity.userStatus !== "ACTIVE" || identity.accountStatus !== "ACTIVE") {
    throw new ForbiddenError("This user or account is not active.");
  }
  return identity;
}
