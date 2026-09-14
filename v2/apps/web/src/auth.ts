import {
  DevelopmentBrowserAuthClient,
  SupabaseBrowserAuthClient,
  type BrowserAuthClient
} from "./auth-clients.js";

export type { BrowserAuthSession } from "./auth-clients.js";

export const developmentAuthEnabled = import.meta.env.DEV
  && import.meta.env.VITE_ENABLE_DEV_AUTH === "true";

export const authClient: BrowserAuthClient = developmentAuthEnabled
  ? new DevelopmentBrowserAuthClient(
      import.meta.env.VITE_DEV_AUTH_TOKEN ?? "",
      import.meta.env.VITE_DEV_AUTH_EMAIL ?? "developer@jobhunter.local"
    )
  : new SupabaseBrowserAuthClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );
