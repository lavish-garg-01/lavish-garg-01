export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

export { AnswerUnitError, cleanDecimal, exactScale, moneyUnits, convertMoney, learnMoney, learnDurationMonths, learnNoticeDays } from "./answer-units.js";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: AppErrorCode,
    message: string,
    statusCode: number,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CONFLICT", message, 409, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("FORBIDDEN", message, 403, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("UNAUTHORIZED", message, 401, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("NOT_FOUND", message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IDEMPOTENCY_CONFLICT", message, 409, details);
  }
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date()
};
