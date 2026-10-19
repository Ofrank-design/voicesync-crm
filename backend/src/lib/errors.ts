export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const notFound = (msg = "We could not find that task.") => new AppError(404, "not_found", msg);
export const unauthorized = (msg = "Please sign in to continue.") => new AppError(401, "unauthorized", msg);
