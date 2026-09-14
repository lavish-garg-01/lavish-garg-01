import fs from "node:fs";
import path from "node:path";
import { env } from "../config/environment.js";

let cachedExtensionVersion = null;

export function currentExtensionVersion() {
    if (cachedExtensionVersion) return cachedExtensionVersion;
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(env.rootDir, "extension", "manifest.json"), "utf8"));
        cachedExtensionVersion = String(manifest.version || "unknown");
    } catch {
        cachedExtensionVersion = "unknown";
    }
    return cachedExtensionVersion;
}

