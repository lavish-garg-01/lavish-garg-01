import { StaticIdentityTokenVerifier, type IdentityTokenVerifier } from "@job-hunter-v2/auth";
import { UnauthorizedError, type Clock, systemClock } from "@job-hunter-v2/domain";

export function createDevelopmentIdentityVerifier(
  expectedToken: string,
  email: string,
  clock: Clock = systemClock
): IdentityTokenVerifier {
  return new StaticIdentityTokenVerifier(async (token) => {
    if (token !== expectedToken) throw new UnauthorizedError("The development access token is invalid.");
    return {
      provider: "LOCAL_DEVELOPMENT",
      providerSubject: `local:${email.toLowerCase()}`,
      email: email.toLowerCase(),
      tokenId: null,
      expiresAt: new Date(clock.now().getTime() + 24 * 60 * 60 * 1_000)
    };
  });
}
