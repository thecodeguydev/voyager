import type { Request } from "express";

/** The caller identity for audit_log rows — a placeholder until auth lands (see PLAN.md). */
export function actorFrom(req: Request): string {
  return req.header("X-Actor") ?? "unknown";
}
