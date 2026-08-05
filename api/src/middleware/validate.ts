import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

type RequestPart = "body" | "params" | "query";

/**
 * Parses `req[part]` against `schema`, replacing it with the parsed (and type-coerced) value.
 * Express 5 makes `req.query` getter-only, so it's overridden via `defineProperty` instead of
 * plain assignment; `body`/`params` stay directly assignable.
 */
function validate(part: RequestPart, schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(result.error);
      return;
    }
    if (part === "query") {
      Object.defineProperty(req, "query", { value: result.data, configurable: true });
    } else {
      req[part] = result.data;
    }
    next();
  };
}

export const validateBody = (schema: ZodType): RequestHandler => validate("body", schema);
export const validateParams = (schema: ZodType): RequestHandler => validate("params", schema);
export const validateQuery = (schema: ZodType): RequestHandler => validate("query", schema);
