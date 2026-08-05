import { v5 as uuidv5 } from "uuid";

// Fixed namespace so a given slug always resolves to the same uuid across seed runs.
// (Any valid UUID works as a v5 namespace; this one is arbitrary but must never change.)
const VOYAGER_SEED_NAMESPACE = "7b3e6f2a-1c4d-4e8b-9a2f-5d6c8e1a3b4f";

/** Resolves a human-readable seed slug (e.g. "grp-aurora") to a stable uuid v5. */
export function slugToId(slug: string): string {
  return uuidv5(slug, VOYAGER_SEED_NAMESPACE);
}
