import { z } from "zod";
import { AiError, type Privacy, type Provider } from "./contracts.js";
import { RestProviderAdapter } from "./providers.js";
import { AiOrchestrator } from "./orchestrator.js";
import type { AiLedger } from "./ledger.js";

/** Only server composition reads credentials. Unknown/unpriced routes stay off. */
export function createConfiguredAi(environment: NodeJS.ProcessEnv = process.env, ledger?: AiLedger): AiOrchestrator {
  const adapters: RestProviderAdapter[] = [];
  for (const provider of ["GROQ", "GEMINI", "OPENAI"] as const) {
    const prefix = "AI_" + provider + "_";
    const key = environment[prefix + "API_KEY"];
    if (!key) continue;
    const settings = z.object({
      jsonMode: z.enum(["STRICT_SCHEMA", "JSON_OBJECT"]),
      model: z.string().min(1), input: z.coerce.number().min(0), output: z.coerce.number().min(0),
      context: z.coerce.number().int().positive()
    }).safeParse({
      jsonMode: environment[prefix + "JSON_MODE"] ?? "STRICT_SCHEMA",
      model: environment[prefix + "MODEL"], input: environment[prefix + "INPUT_MICROS_PER_TOKEN"],
      output: environment[prefix + "OUTPUT_MICROS_PER_TOKEN"], context: environment[prefix + "MAX_INPUT_TOKENS"]
    });
    if (!settings.success) throw new AiError("AI_AUTH_CONFIGURATION_ERROR");
    const privacy: Privacy[] = ["FIELD_METADATA_ONLY", "PUBLIC_JOB_DATA"];
    if (environment[prefix + "ALLOW_PRIVATE"] === "true") privacy.push("CANDIDATE_PRIVATE_DATA", "DOCUMENT_PRIVATE_DATA");
    adapters.push(new RestProviderAdapter({ provider: provider as Provider, model: settings.data.model, apiKey: key, privacy,
      jsonMode: settings.data.jsonMode,
      inputMicrosPerToken: settings.data.input, outputMicrosPerToken: settings.data.output, maxInputTokens: settings.data.context }));
  }
  const daily = z.coerce.number().int().nonnegative().safeParse(environment.AI_DAILY_MICROS ?? 1_000_000);
  if (!daily.success) throw new AiError("AI_AUTH_CONFIGURATION_ERROR");
  if (adapters.length && (!ledger || !environment.CANDIDATE_VALUE_HMAC_SECRET)) throw new AiError("AI_AUTH_CONFIGURATION_ERROR");
  return new AiOrchestrator(adapters, { dailyMicros: daily.data,
    ...(ledger ? { ledger } : {}),
    ...(environment.CANDIDATE_VALUE_HMAC_SECRET ? { fingerprintSecret: environment.CANDIDATE_VALUE_HMAC_SECRET } : {})
  });
}
