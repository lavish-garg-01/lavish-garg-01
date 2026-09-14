import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { extensionBuildConfig } from "../extension.config.mjs";
import manifestPackage from "../package.json" with { type: "json" };

const root = resolve(new URL("..", import.meta.url).pathname);
const output = process.env.EXTENSION_OUTPUT_DIR
  ? resolve(root, "../..", process.env.EXTENSION_OUTPUT_DIR)
  : resolve(root, "dist");
const config = extensionBuildConfig();
const definitions = {
  __JH_EXTENSION_VERSION__: JSON.stringify(manifestPackage.version),
  __JH_WEB_ORIGINS__: JSON.stringify(config.webOrigins),
  __JH_BUILD_CHANNEL__: JSON.stringify(config.channel)
};

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const common = {
  bundle: true,
  minify: config.channel === "production",
  sourcemap: config.channel !== "production",
  target: "chrome120",
  logLevel: "info",
  define: definitions
};

await build({ ...common, entryPoints: [resolve(root, "src/background/service-worker.ts")], outfile: resolve(output, "background.js"), format: "esm" });
await build({ ...common, entryPoints: [resolve(root, "src/content/entry.ts")], outfile: resolve(output, "content.js"), format: "iife" });
await build({ ...common, entryPoints: [resolve(root, "src/sidepanel/main.ts")], outfile: resolve(output, "sidepanel.js"), format: "esm" });

await cp(resolve(root, "static/sidepanel.html"), resolve(output, "sidepanel.html"));
await cp(resolve(root, "static/sidepanel.css"), resolve(output, "sidepanel.css"));
await writeFile(resolve(output, "config.json"), `${JSON.stringify(config, null, 2)}\n`);

const patterns = (origins) => origins.map((origin) => `${origin}/*`);
const manifest = {
  manifest_version: 3,
  name: "Job Hunter Copilot",
  version: manifestPackage.version,
  description: "A private, user-controlled foundation for job-application assistance.",
  minimum_chrome_version: "120",
  permissions: ["activeTab", "scripting", "sidePanel", "storage", "tabGroups", "alarms"],
  host_permissions: patterns([...config.webOrigins, config.apiOrigin]),
  optional_host_permissions: ["https://*/*", "http://*/*"],
  background: { service_worker: "background.js", type: "module" },
  action: { default_title: "Open Job Hunter Copilot" },
  side_panel: { default_path: "sidepanel.html" },
  content_scripts: [{ matches: patterns(config.webOrigins), js: ["content.js"], run_at: "document_idle", all_frames: true }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" }
};
await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
