const defaults = [
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

function exactOrigins(value) {
  return [...new Set((value ? value.split(",") : defaults)
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter((entry) => /^https?:\/\/[^/]+$/.test(entry)))];
}

export function extensionBuildConfig(environment = process.env) {
  const apiOrigin = String(environment.EXTENSION_API_ORIGIN || "http://127.0.0.1:3100").replace(/\/$/, "");
  const webOrigins = exactOrigins(environment.EXTENSION_WEB_ORIGINS);
  const channel = ["development", "staging", "production"].includes(environment.EXTENSION_CHANNEL)
    ? environment.EXTENSION_CHANNEL
    : "development";
  if (!/^https?:\/\/[^/]+$/.test(apiOrigin)) throw new Error("EXTENSION_API_ORIGIN must be an exact HTTP(S) origin.");
  if (!webOrigins.length) throw new Error("At least one exact EXTENSION_WEB_ORIGIN is required.");
  return { apiOrigin, webOrigins, channel };
}
