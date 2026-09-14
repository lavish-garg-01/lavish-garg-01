import type { AiRequest, Provider } from "./contracts.js";
import type { AiEvent } from "./orchestrator.js";
export interface AiReservation {
  key: string; fingerprint: string; accountId: string; candidateId: string; applicationId: string | null;
  provider: Provider; model: string; taskType: AiRequest["taskType"]; amountMicros: number;
  dailyLimitMicros: number; candidateLimitMicros: number; applicationLimitMicros: number;
}
export interface AiLedger {
  reserve(command: AiReservation): Promise<"RESERVED" | "DUPLICATE" | "BUDGET_EXCEEDED" | "CONFLICT">;
  record(scope: AiRequest["scope"], event: AiEvent): Promise<void>;
}
