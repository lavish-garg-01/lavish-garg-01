import { spawnSync } from "node:child_process";

const CONTAINER_NAME = "job-hunter-v2-postgres";
const VOLUME_NAME = "job-hunter-v2-postgres-data";
const POSTGRES_IMAGE = "postgres:17-alpine";

function runDocker(arguments_, options = {}) {
  return spawnSync("docker", arguments_, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is required. Copy .env.example to .env first.");

const url = new URL(databaseUrl);
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  fail("DATABASE_URL must use the postgres or postgresql protocol.");
}
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  fail("db:start only manages a loopback PostgreSQL database. Use db:migrate directly for a hosted database.");
}
if (!url.username || !url.password || !url.pathname.slice(1)) {
  fail("Local DATABASE_URL must include a username, password and database name.");
}

const dockerInfo = runDocker(["info", "--format", "{{.ServerVersion}}"], { capture: true });
if (dockerInfo.status !== 0) {
  fail("Docker is not running. Start Docker Desktop, then run npm run db:start again.");
}

const inspection = runDocker(["inspect", "--format", "{{.State.Running}}", CONTAINER_NAME], {
  capture: true
});
if (inspection.status === 0) {
  if (inspection.stdout.trim() === "true") {
    console.log(`Local PostgreSQL is already running in ${CONTAINER_NAME}.`);
    process.exit(0);
  }
  const started = runDocker(["start", CONTAINER_NAME]);
  if (started.status !== 0) fail(`Could not start ${CONTAINER_NAME}.`);
  console.log(`Started local PostgreSQL in ${CONTAINER_NAME}.`);
  process.exit(0);
}

const hostPort = url.port || "5432";
const started = runDocker(
  [
    "run",
    "--detach",
    "--name",
    CONTAINER_NAME,
    "--restart",
    "unless-stopped",
    "--env",
    "POSTGRES_USER",
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    "POSTGRES_DB",
    "--publish",
    `127.0.0.1:${hostPort}:5432`,
    "--volume",
    `${VOLUME_NAME}:/var/lib/postgresql/data`,
    POSTGRES_IMAGE
  ],
  {
    env: {
      ...process.env,
      POSTGRES_USER: decodeURIComponent(url.username),
      POSTGRES_PASSWORD: decodeURIComponent(url.password),
      POSTGRES_DB: decodeURIComponent(url.pathname.slice(1))
    }
  }
);
if (started.status !== 0) fail("Could not create the local PostgreSQL container.");
console.log(`Created local PostgreSQL in ${CONTAINER_NAME} on 127.0.0.1:${hostPort}.`);
