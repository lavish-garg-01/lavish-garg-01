import { z } from "zod";

export const ExtensionConfigSchema = z.object({
  apiOrigin: z.string().url().regex(/^https?:\/\/[^/]+$/),
  webOrigins: z.array(z.string().url().regex(/^https?:\/\/[^/]+$/)).min(1).max(20),
  channel: z.enum(["development", "staging", "production"])
}).strict();
export type ExtensionConfig = z.infer<typeof ExtensionConfigSchema>;

let cached: Promise<ExtensionConfig> | null = null;
export function loadExtensionConfig(): Promise<ExtensionConfig> {
  cached ??= fetch(chrome.runtime.getURL("config.json"))
    .then(async (response) => ExtensionConfigSchema.parse(await response.json()));
  return cached;
}
