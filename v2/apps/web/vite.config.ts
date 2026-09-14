import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The API and extension trust exact origins. Never silently move to 3001,
  // because that makes the UI appear healthy while CORS/session bridging fail.
  server: { host: "127.0.0.1", port: 3000, strictPort: true },
  preview: { host: "127.0.0.1", port: 3000, strictPort: true }
});
