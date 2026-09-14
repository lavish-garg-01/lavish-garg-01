import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { HealthResponseSchema } from "@job-hunter-v2/contracts";
import { AppError } from "@job-hunter-v2/domain";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPhaseGRoutes, type PhaseGApiServices } from "./onboarding-routes.js";
import { registerPhaseHRoutes, type PhaseHApiServices } from "./job-routes.js";
import { registerPhaseJRoutes, type PhaseJApiServices } from "./field-intelligence-routes.js";
import { registerPhaseKRoutes, type PhaseKApiServices } from "./execution-routes.js";
import { registerPhaseLRoutes, type PhaseLApiServices } from "./learning-routes.js";
import { registerPhaseMRoutes, type PhaseMApiServices } from "./repeatable-entity-routes.js";
import { registerPhaseORoutes, type PhaseOApiServices } from "./declaration-routes.js";
import { isAllowedCorsOrigin } from "./config.js";
import { registerOperatorRoutes, type OperatorServices } from "./operator-routes.js";

export interface CreateApiOptions {
  operators?: OperatorServices;
  logger?: boolean | { level: string };
  exposeDocumentation?: boolean;
  phaseG?: PhaseGApiServices;
  phaseH?: PhaseHApiServices;
  phaseJ?: PhaseJApiServices;
  phaseK?: PhaseKApiServices;
  phaseL?: PhaseLApiServices;
  phaseM?: PhaseMApiServices;
  phaseO?: PhaseOApiServices;
  corsOrigin?: string | string[];
}

const unavailableDatabaseCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "57P01",
  "57P02",
  "57P03"
]);

function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && typeof error.code === "string" && unavailableDatabaseCodes.has(error.code)) {
    return true;
  }
  if (error instanceof AggregateError) return error.errors.some(isDatabaseUnavailable);
  return false;
}

export async function createApi(options: CreateApiOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: "x-request-id",
    genReqId: (request) => request.headers["x-request-id"]?.toString() ?? crypto.randomUUID()
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Job Hunter V2 API",
        version: "0.1.0"
      }
    }
  });

  await app.register(multipart, {
    limits: { files: 1, fileSize: 10 * 1024 * 1024, fields: 4 }
  });
  if (options.corsOrigin) {
    const webOrigins = Array.isArray(options.corsOrigin) ? options.corsOrigin : [options.corsOrigin];
    await app.register(cors, {
      origin: (origin, callback) => {
        callback(null, isAllowedCorsOrigin(origin, webOrigins));
      },
      methods: ["GET", "POST", "PUT", "OPTIONS"],
      allowedHeaders: ["authorization", "content-type", "x-idempotency-key", "x-request-id"]
    });
    app.addHook("onSend", (request, reply, payload, done) => {
      const requestOrigin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
      if (
        request.headers["access-control-request-private-network"] === "true"
        && isAllowedCorsOrigin(requestOrigin, webOrigins)
      ) {
        void reply.header("Access-Control-Allow-Private-Network", "true");
      }
      done(null, payload);
    });
  }

  if (options.exposeDocumentation === true) {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status", "service", "version", "time"],
            properties: {
              status: { const: "ok" },
              service: { const: "job-hunter-v2-api" },
              version: { type: "string" },
              time: { type: "string", format: "date-time" }
            }
          }
        }
      }
    },
    async () =>
      HealthResponseSchema.parse({
        status: "ok",
        service: "job-hunter-v2-api",
        version: "0.1.0",
        time: new Date().toISOString()
      })
  );

  if (options.phaseG) {
    await registerPhaseGRoutes(app, options.phaseG);
  }
  if (options.phaseH) {
    await registerPhaseHRoutes(app, options.phaseH);
  }
  if (options.phaseJ) {
    await registerPhaseJRoutes(app, options.phaseJ);
  }
  if (options.phaseK) {
    await registerPhaseKRoutes(app, options.phaseK);
  }
  if (options.phaseL) {
    await registerPhaseLRoutes(app, options.phaseL);
  }
  if (options.operators) await registerOperatorRoutes(app, options.operators);
  if (options.phaseM) {
    await registerPhaseMRoutes(app, options.phaseM);
  }
  if (options.phaseO) {
    await registerPhaseORoutes(app, options.phaseO);
  }

  app.setErrorHandler((error, request, reply) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(413).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The resume must be no larger than 10 MB.",
          requestId: request.id
        }
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Array.isArray(error.validation)
    ) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request does not match the API contract.",
          requestId: request.id
        }
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("FST_ERR_") &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 && error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request body could not be read.",
          requestId: request.id
        }
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id }
      });
    }
    if (isDatabaseUnavailable(error)) {
      request.log.error({ err: error }, "database unavailable");
      return reply.status(503).send({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "The database is unavailable. Start PostgreSQL and retry.",
          requestId: request.id
        }
      });
    }
    request.log.error({ err: error }, "unhandled request error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: request.id
      }
    });
  });

  return app;
}
