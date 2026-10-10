export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function requireCondition(
  condition: unknown,
  statusCode: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new ApiError(statusCode, code, message);
}
