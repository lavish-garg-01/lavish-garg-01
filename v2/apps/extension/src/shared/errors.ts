import { z } from "zod";

export const ExtensionErrorCodeSchema = z.enum([
  "PAGE_UNSUPPORTED",
  "APPLICATION_NOT_FOUND",
  "FIELD_STALE",
  "FRAME_INACCESSIBLE",
  "AUTH_EXPIRED",
  "API_UNAVAILABLE",
  "API_TIMEOUT",
  "MESSAGE_SCHEMA_INVALID",
  "MESSAGE_SOURCE_INVALID",
  "EXTENSION_CONTEXT_INVALIDATED",
  "RUNTIME_STATE_INVALID",
  "PERMISSION_REQUIRED",
  "EXTENSION_UPDATE_REQUIRED",
  "PHASE_NOT_AVAILABLE",
  "INTERNAL_FAILURE"
]);
export type ExtensionErrorCode = z.infer<typeof ExtensionErrorCodeSchema>;

export const ExtensionFailureSchema = z.object({
  code: ExtensionErrorCodeSchema,
  category: z.enum(["TECHNICAL", "SEMANTIC_UNKNOWN", "UNSUPPORTED", "STALE", "AUTHORIZATION"]),
  message: z.string().min(1).max(240),
  retryable: z.boolean(),
  correlationId: z.uuid().nullable(),
  metadata: z.record(z.string(), z.union([z.string().max(160), z.number(), z.boolean(), z.null()])).default({})
}).strict();
export type ExtensionFailure = z.infer<typeof ExtensionFailureSchema>;

export class ExtensionRuntimeError extends Error {
  readonly failure: ExtensionFailure;

  constructor(failure: ExtensionFailure) {
    super(failure.message);
    this.failure = ExtensionFailureSchema.parse(failure);
  }
}

export function failure(code: ExtensionErrorCode, message: string, options: {
  category?: ExtensionFailure["category"];
  retryable?: boolean;
  correlationId?: string | null;
  metadata?: ExtensionFailure["metadata"];
} = {}): ExtensionFailure {
  return ExtensionFailureSchema.parse({
    code,
    category: options.category ?? "TECHNICAL",
    message,
    retryable: options.retryable ?? false,
    correlationId: options.correlationId ?? null,
    metadata: options.metadata ?? {}
  });
}

export function safeFailure(reason: unknown, correlationId: string | null = null): ExtensionFailure {
  if (reason instanceof ExtensionRuntimeError) return reason.failure;
  const diagnosticCode = reason instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(reason.message)
    ? reason.message
    : null;
  return failure("INTERNAL_FAILURE", "The extension could not complete this operation.", {
    retryable: true,
    correlationId,
    metadata: {
      reasonType: reason instanceof Error ? reason.name : typeof reason,
      ...(diagnosticCode ? { diagnosticCode } : {})
    }
  });
}
