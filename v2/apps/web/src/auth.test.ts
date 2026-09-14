import assert from "node:assert/strict";
import test from "node:test";
import { DevelopmentBrowserAuthClient } from "./auth-clients.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test("development browser auth is explicit, persistent and reversible", async () => {
  const storage = new MemoryStorage();
  const client = new DevelopmentBrowserAuthClient(
    "local-development-token", "developer@jobhunter.local", storage
  );
  assert.equal(client.configured, true);
  assert.equal(await client.session(), null);
  let observed = null as Awaited<ReturnType<typeof client.session>>;
  const unsubscribe = client.subscribe((session) => { observed = session; });
  await client.signInWithGoogle();
  assert.equal(observed?.email, "developer@jobhunter.local");
  assert.equal((await client.session())?.accessToken, "local-development-token");
  await client.signOut();
  assert.equal(await client.session(), null);
  unsubscribe();
});
