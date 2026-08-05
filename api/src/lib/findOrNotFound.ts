import { notFound } from "./httpErrors.js";

/** Runs `finder`, throwing a 404 ApiError with `label` if it returns null/undefined. */
export async function findOrNotFound<T>(finder: () => Promise<T | null | undefined>, label: string): Promise<T> {
  const row = await finder();
  if (!row) throw notFound(label);
  return row;
}
