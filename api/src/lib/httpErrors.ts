/** An error carrying the HTTP status + machine-checkable code the error middleware renders. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (message: string): ApiError => new ApiError(404, "NOT_FOUND", message);
export const badRequest = (message: string, details?: unknown): ApiError =>
  new ApiError(400, "VALIDATION_ERROR", message, details);
export const conflict = (message: string): ApiError => new ApiError(409, "CONFLICT", message);
export const forbidden = (message: string): ApiError => new ApiError(403, "FORBIDDEN", message);
export const unauthorized = (message: string): ApiError => new ApiError(401, "UNAUTHORIZED", message);
