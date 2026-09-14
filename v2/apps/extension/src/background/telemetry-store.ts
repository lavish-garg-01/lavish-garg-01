import { TelemetryEventSchema, type TelemetryEvent } from "../shared/telemetry.js";
import type { StorageArea } from "./storage.js";

const key = "jobHunter.extension.telemetry.v1";
const maximum = 200;

export class TelemetryStore {
  constructor(private readonly storage: StorageArea) {}
  async append(events: readonly TelemetryEvent[]): Promise<void> {
    const current = (await this.storage.get(key))[key];
    const existing = Array.isArray(current) ? current.flatMap((item) => {
      const parsed = TelemetryEventSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }) : [];
    const accepted = events.map((event) => TelemetryEventSchema.parse(event));
    const deduped = new Map([...existing, ...accepted].map((event) => [event.telemetryId, event]));
    await this.storage.set({ [key]: [...deduped.values()].slice(-maximum) });
  }
}
