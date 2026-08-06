import type { Order, Worker } from "@voyager/shared";

export interface Candidate {
  worker: Worker;
  distanceMeters: number;
  score: number | null;
  trace: Record<string, unknown>;
}

export interface StageContext {
  order: Order;
}

/** A composable pipeline stage — filters and/or ranks candidates. See PLAN.md "Composable pipeline". */
export interface Stage {
  readonly type: string;
  run(candidates: Candidate[], ctx: StageContext): Candidate[] | Promise<Candidate[]>;
}
