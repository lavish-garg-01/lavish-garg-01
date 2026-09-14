import { z } from "zod";
import { HmacCandidateValueFingerprinter } from "@job-hunter-v2/candidate-truth";

const historicalKeys=z.string().max(20000).transform((raw,context)=>{
  try {
    return z.array(z.object({keyVersion:z.number().int().positive(),secret:z.string().min(32).max(4096)}).strict()).max(4).parse(JSON.parse(raw));
  } catch {
    context.addIssue({code:"custom",message:"Historical fingerprint keys must be a bounded JSON array of keyVersion/secret entries."});
    return z.NEVER;
  }
});

const environmentBoolean = z.preprocess(
  (value) => value === true || value === "true" ? true : value === false || value === "false" || value === undefined ? false : value,
  z.boolean()
);

const ApiConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    DATABASE_URL: z.string().url().optional(),
    OPERATOR_DATABASE_URL: z.string().url().optional(),
    OIDC_PROVIDER: z.string().trim().min(1).max(80).optional(),
    OIDC_ISSUER: z.string().url().optional(),
    OIDC_AUDIENCE: z.string().trim().min(1).max(200).optional(),
    OIDC_JWKS_URL: z.string().url().optional(),
    CANDIDATE_VALUE_HMAC_SECRET: z.string().min(32).optional(),
    CANDIDATE_VALUE_HMAC_KEY_VERSION: z.coerce.number().int().positive().max(2147483647).default(1),
    CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS: historicalKeys.optional(),
    RESUME_PROPOSAL_ENCRYPTION_KEY: z.string().min(40).optional(),
    RESUME_STORAGE_ROOT: z.string().min(1).default(".data/private-resumes"),
    WEB_ORIGIN: z.string().url().default("http://127.0.0.1:3000"),
    ENABLE_DEV_AUTH: environmentBoolean.default(false),
    ENABLE_OPERATOR_REVIEW: environmentBoolean.default(false),
    ENABLE_OPERATOR_PRIVATE_REVIEW: environmentBoolean.default(false),
    ENABLE_REVIEWED_EXPORTS: environmentBoolean.default(false),
    DEV_AUTH_TOKEN: z.string().min(16).max(200).optional(),
    DEV_AUTH_EMAIL: z.string().email().default("developer@jobhunter.local")
  })
  .strict()
  .superRefine((config, context) => {
    if(!config.CANDIDATE_VALUE_HMAC_SECRET&&(config.CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS||config.CANDIDATE_VALUE_HMAC_KEY_VERSION!==1))context.addIssue({code:"custom",message:"Fingerprint key history requires an active secret."});
    if(config.CANDIDATE_VALUE_HMAC_SECRET){
      try{new HmacCandidateValueFingerprinter(config.CANDIDATE_VALUE_HMAC_SECRET,config.CANDIDATE_VALUE_HMAC_KEY_VERSION,config.CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS);}
      catch{context.addIssue({code:"custom",message:"Fingerprint key versions must be distinct, positive, older than the active version, and use distinct secrets of at least 32 bytes."});}
    }
    if (config.ENABLE_OPERATOR_REVIEW && (!config.OPERATOR_DATABASE_URL || !config.OIDC_ISSUER || !config.OIDC_AUDIENCE || !config.OIDC_JWKS_URL)) {
      context.addIssue({ code:"custom",message:"Operator review requires a dedicated OPERATOR_DATABASE_URL and OIDC issuer, audience and JWKS settings." });
    }
    const oidc = [
      config.OIDC_PROVIDER,
      config.OIDC_ISSUER,
      config.OIDC_AUDIENCE,
      config.OIDC_JWKS_URL
    ];
    const core = [
      config.DATABASE_URL,
      config.CANDIDATE_VALUE_HMAC_SECRET,
      config.RESUME_PROPOSAL_ENCRYPTION_KEY
    ];
    const anyAuthConfigured = core.some(Boolean) || oidc.some(Boolean) || config.ENABLE_DEV_AUTH;
    if (anyAuthConfigured && core.some((value) => !value)) {
      context.addIssue({
        code: "custom",
        message: "Phase G API configuration requires database, fingerprint and proposal-encryption settings together."
      });
    }
    if (!config.ENABLE_DEV_AUTH && anyAuthConfigured && oidc.some((value) => !value)) {
      context.addIssue({ code: "custom", message: "OIDC provider, issuer, audience and JWKS URL are required together." });
    }
    if (config.ENABLE_DEV_AUTH && config.NODE_ENV !== "development") {
      context.addIssue({ code: "custom", message: "Development authentication is allowed only when NODE_ENV=development." });
    }
    if (config.ENABLE_DEV_AUTH && !["127.0.0.1", "localhost", "::1"].includes(config.HOST)) {
      context.addIssue({ code: "custom", message: "Development authentication requires a loopback API host." });
    }
    if (config.ENABLE_DEV_AUTH && !config.DEV_AUTH_TOKEN) {
      context.addIssue({ code: "custom", message: "Development authentication requires DEV_AUTH_TOKEN." });
    }
    if (config.NODE_ENV === "production" && (core.some((value) => !value) || oidc.some((value) => !value))) {
      context.addIssue({ code: "custom", message: "Production requires the complete Phase G configuration." });
    }
    if (
      config.RESUME_PROPOSAL_ENCRYPTION_KEY &&
      Buffer.from(config.RESUME_PROPOSAL_ENCRYPTION_KEY, "base64").byteLength !== 32
    ) {
      context.addIssue({ code: "custom", message: "Resume proposal encryption key must decode to 32 bytes." });
    }
  });

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export function readApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return ApiConfigSchema.parse({
    NODE_ENV: environment.NODE_ENV,
    HOST: environment.HOST,
    PORT: environment.PORT,
    LOG_LEVEL: environment.LOG_LEVEL,
    DATABASE_URL: environment.DATABASE_URL,
    OPERATOR_DATABASE_URL: environment.OPERATOR_DATABASE_URL,
    OIDC_PROVIDER: environment.OIDC_PROVIDER,
    OIDC_ISSUER: environment.OIDC_ISSUER,
    OIDC_AUDIENCE: environment.OIDC_AUDIENCE,
    OIDC_JWKS_URL: environment.OIDC_JWKS_URL,
    CANDIDATE_VALUE_HMAC_SECRET: environment.CANDIDATE_VALUE_HMAC_SECRET,
    CANDIDATE_VALUE_HMAC_KEY_VERSION: environment.CANDIDATE_VALUE_HMAC_KEY_VERSION,
    CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS: environment.CANDIDATE_VALUE_HMAC_PREVIOUS_KEYS,
    RESUME_PROPOSAL_ENCRYPTION_KEY: environment.RESUME_PROPOSAL_ENCRYPTION_KEY,
    RESUME_STORAGE_ROOT: environment.RESUME_STORAGE_ROOT,
    WEB_ORIGIN: environment.WEB_ORIGIN,
    ENABLE_DEV_AUTH: environment.ENABLE_DEV_AUTH,
    ENABLE_OPERATOR_REVIEW: environment.ENABLE_OPERATOR_REVIEW,
    ENABLE_OPERATOR_PRIVATE_REVIEW: environment.ENABLE_OPERATOR_PRIVATE_REVIEW,
    ENABLE_REVIEWED_EXPORTS: environment.ENABLE_REVIEWED_EXPORTS,
    DEV_AUTH_TOKEN: environment.DEV_AUTH_TOKEN,
    DEV_AUTH_EMAIL: environment.DEV_AUTH_EMAIL
  });
}

export function allowedWebOrigins(config: Pick<ApiConfig, "NODE_ENV" | "WEB_ORIGIN">): string[] {
  const configured = new URL(config.WEB_ORIGIN);
  const origins = new Set([configured.origin]);
  if (config.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(configured.hostname)) {
    const alias = new URL(configured.origin);
    alias.hostname = configured.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.add(alias.origin);
  }
  return [...origins];
}

/** Chrome packed/unpacked extension IDs use 32 characters from a–p. */
const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export function isAllowedCorsOrigin(origin: string | undefined, webOrigins: readonly string[]): boolean {
  if (!origin) return false;
  if (webOrigins.includes(origin)) return true;
  return CHROME_EXTENSION_ORIGIN.test(origin);
}
