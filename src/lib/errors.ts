export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function fail(code: string, message: string, status = 400): never {
  throw new AppError(code, message, status);
}
