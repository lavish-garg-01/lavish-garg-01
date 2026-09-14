import { z } from "zod";

const forbiddenKey = /(?:value|answer|password|token|secret|resume|email|phone|name|address|raw|text|dom|html)/i;
const MetadataValueSchema = z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()]);

export const TelemetryEventSchema = z.object({
  schemaVersion: z.literal(1),
  telemetryId: z.uuid(),
  eventType: z.enum([
    "PAGE_DETECTED", "APPLICATION_DETECTED", "SCAN_STARTED", "SCAN_COMPLETED", "FIELD_DISCOVERED",
    "RUNTIME_STATE_CHANGED", "MESSAGE_FAILED", "RECOVERY_PERFORMED", "BACKEND_UNAVAILABLE", "PAGE_UNSUPPORTED"
    ,"EXECUTION_STARTED", "EXECUTION_ATTEMPT", "EXECUTION_VERIFIED", "EXECUTION_FAILED", "EXECUTION_ABORTED"
  ]),
  occurredAt: z.iso.datetime(),
  applicationRunId: z.uuid().nullable(),
  pageInstanceId: z.uuid().nullable(),
  fieldRuntimeId: z.string().min(8).max(100).nullable(),
  operationId: z.uuid().nullable(),
  outcome: z.string().min(1).max(80).nullable(),
  durationMs: z.number().int().nonnegative().max(300_000).nullable(),
  metadata: z.record(z.string().max(60), MetadataValueSchema),
  valuePrivate: z.literal(true),
  containsCandidateValue: z.literal(false)
}).strict().superRefine((event, context) => {
  for (const key of Object.keys(event.metadata)) {
    if (forbiddenKey.test(key)) context.addIssue({ code: "custom", message: `Private telemetry key is forbidden: ${key}` });
  }
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

export class TelemetryBatcher {
  private readonly events: TelemetryEvent[] = [];
  constructor(private readonly emit: (events: readonly TelemetryEvent[]) => Promise<void>, private readonly maxBatch = 25) {}

  async record(input: Omit<TelemetryEvent, "schemaVersion" | "telemetryId" | "occurredAt" | "valuePrivate" | "containsCandidateValue">): Promise<void> {
    this.events.push(TelemetryEventSchema.parse({
      ...input,
      schemaVersion: 1,
      telemetryId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      valuePrivate: true,
      containsCandidateValue: false
    }));
    if (this.events.length >= this.maxBatch) await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.events.length) return;
    const batch = this.events.splice(0, this.maxBatch);
    try { await this.emit(batch); }
    catch { this.events.unshift(...batch.slice(-this.maxBatch)); }
  }
}
