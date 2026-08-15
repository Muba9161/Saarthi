import { ErrorCode } from '@saarthi/shared';

/**
 * Every failure the API surfaces to a client goes through `AppError`, so the
 * error handler can produce a consistent envelope and we never leak a stack
 * trace or an ORM message to the browser.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  /** `true` for errors that are part of normal operation (validation, 404). */
  readonly expected: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: Record<string, unknown>; expected?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (options.details) this.details = options.details;
    this.expected = options.expected ?? statusCode < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const errors = {
  validation: (message = 'The submitted data is not valid.', details?: Record<string, unknown>) =>
    new AppError(400, ErrorCode.VALIDATION_ERROR, message, { details }),

  unauthenticated: (message = 'You must be signed in to perform this action.') =>
    new AppError(401, ErrorCode.UNAUTHENTICATED, message),

  invalidCredentials: (message = 'The email address or password is incorrect.') =>
    new AppError(401, ErrorCode.INVALID_CREDENTIALS, message),

  tokenExpired: (message = 'Your session has expired. Please sign in again.') =>
    new AppError(401, ErrorCode.TOKEN_EXPIRED, message),

  tokenInvalid: (message = 'Your session is no longer valid. Please sign in again.') =>
    new AppError(401, ErrorCode.TOKEN_INVALID, message),

  forbidden: (message = 'You do not have permission to perform this action.') =>
    new AppError(403, ErrorCode.FORBIDDEN, message),

  organizationRequired: (
    message = 'Select an organization before performing this action.',
  ) => new AppError(403, ErrorCode.ORGANIZATION_REQUIRED, message),

  tenantMismatch: (message = 'This record belongs to a different organization.') =>
    new AppError(403, ErrorCode.TENANT_MISMATCH, message),

  featureNotAvailable: (feature: string, message?: string) =>
    new AppError(
      403,
      ErrorCode.FEATURE_NOT_AVAILABLE,
      message ?? 'Your current subscription plan does not include this feature.',
      { details: { feature } },
    ),

  planLimitReached: (limit: string, message: string) =>
    new AppError(403, ErrorCode.PLAN_LIMIT_REACHED, message, { details: { limit } }),

  notFound: (resource = 'Record', message?: string) =>
    new AppError(404, ErrorCode.NOT_FOUND, message ?? `${resource} could not be found.`, {
      details: { resource },
    }),

  conflict: (message: string, details?: Record<string, unknown>) =>
    new AppError(409, ErrorCode.CONFLICT, message, { details }),

  duplicate: (message: string, details?: Record<string, unknown>) =>
    new AppError(409, ErrorCode.DUPLICATE_RESOURCE, message, { details }),

  invalidTransition: (message: string, details?: Record<string, unknown>) =>
    new AppError(409, ErrorCode.INVALID_STATE_TRANSITION, message, { details }),

  businessRule: (message: string, details?: Record<string, unknown>) =>
    new AppError(422, ErrorCode.BUSINESS_RULE_VIOLATION, message, { details }),

  payloadTooLarge: (message = 'The uploaded file is larger than the allowed limit.') =>
    new AppError(413, ErrorCode.PAYLOAD_TOO_LARGE, message),

  unsupportedMediaType: (message = 'This file type is not supported.') =>
    new AppError(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, message),

  rateLimited: (message = 'Too many requests. Please slow down and try again shortly.') =>
    new AppError(429, ErrorCode.RATE_LIMITED, message),

  demoDisabled: (message = 'Simulation features are disabled on this environment.') =>
    new AppError(403, ErrorCode.DEMO_MODE_DISABLED, message),

  provider: (provider: string, message: string, cause?: unknown) =>
    new AppError(502, ErrorCode.PROVIDER_ERROR, message, { details: { provider }, cause }),

  internal: (message = 'Something went wrong while processing your request.', cause?: unknown) =>
    new AppError(500, ErrorCode.INTERNAL_ERROR, message, { cause, expected: false }),
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
