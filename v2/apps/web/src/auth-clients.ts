import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

export interface BrowserAuthSession {
  accessToken: string;
  email: string | null;
}

export interface BrowserAuthClient {
  configured: boolean;
  session(): Promise<BrowserAuthSession | null>;
  signInWithGoogle(): Promise<void>;
  sendEmailLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  subscribe(listener: (session: BrowserAuthSession | null) => void): () => void;
}

interface AuthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function publicSession(session: Session | null): BrowserAuthSession | null {
  return session ? { accessToken: session.access_token, email: session.user.email ?? null } : null;
}

export class SupabaseBrowserAuthClient implements BrowserAuthClient {
  readonly configured: boolean;
  private readonly client: SupabaseClient | null;

  constructor(url: string | undefined, anonymousKey: string | undefined) {
    this.configured = Boolean(url && anonymousKey);
    this.client = url && anonymousKey
      ? createClient(url, anonymousKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        })
      : null;
  }

  async session(): Promise<BrowserAuthSession | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return publicSession(data.session);
  }

  async signInWithGoogle(): Promise<void> {
    if (!this.client) throw new Error("Authentication is not configured.");
    const { error } = await this.client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  }

  async sendEmailLink(email: string): Promise<void> {
    if (!this.client) throw new Error("Authentication is not configured.");
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  subscribe(listener: (session: BrowserAuthSession | null) => void): () => void {
    if (!this.client) return () => undefined;
    const { data } = this.client.auth.onAuthStateChange((_event, session) => listener(publicSession(session)));
    return () => data.subscription.unsubscribe();
  }
}

const DEV_SESSION_KEY = "job-hunter-v2:development-session";

export class DevelopmentBrowserAuthClient implements BrowserAuthClient {
  readonly configured: boolean;
  private readonly listeners = new Set<(session: BrowserAuthSession | null) => void>();

  constructor(
    private readonly token: string,
    private readonly email: string,
    private readonly storage: AuthStorage = window.localStorage
  ) {
    this.configured = token.length >= 16 && email.includes("@");
  }

  private current(): BrowserAuthSession | null {
    return this.configured && this.storage.getItem(DEV_SESSION_KEY) === "active"
      ? { accessToken: this.token, email: this.email }
      : null;
  }

  async session(): Promise<BrowserAuthSession | null> { return this.current(); }

  async signInWithGoogle(): Promise<void> {
    if (!this.configured) throw new Error("Development authentication is not configured.");
    this.storage.setItem(DEV_SESSION_KEY, "active");
    const session = this.current();
    for (const listener of this.listeners) listener(session);
  }

  async sendEmailLink(): Promise<void> { return this.signInWithGoogle(); }

  async signOut(): Promise<void> {
    this.storage.removeItem(DEV_SESSION_KEY);
    for (const listener of this.listeners) listener(null);
  }

  subscribe(listener: (session: BrowserAuthSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
