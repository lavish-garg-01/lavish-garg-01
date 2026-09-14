/** Stable in-page retry identity; never persisted or emitted as telemetry. */
export class PrivateNoteRetries {
  private readonly entries = new Map<string, string>();
  async id(snapshot: unknown): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)));
    const key = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const prior = this.entries.get(key);
    if (prior) return prior;
    if (this.entries.size >= 200) throw new Error("Private note session limit reached.");
    const id = crypto.randomUUID(); this.entries.set(key, id); return id;
  }
}
