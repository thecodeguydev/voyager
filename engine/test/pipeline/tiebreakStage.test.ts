import { describe, expect, it, vi } from "vitest";
import type { Worker } from "@voyager/shared";
import { TiebreakStage, type LastDispatchedLookup } from "../../src/pipeline/tiebreakStage.js";
import type { Candidate, StageContext } from "../../src/pipeline/stage.js";

function makeCandidate(overrides: Partial<Candidate> & { worker?: Partial<Worker> } = {}): Candidate {
  const { worker, ...rest } = overrides;
  return {
    worker: { id: "worker-default", ...worker } as unknown as Worker,
    distanceMeters: 1000,
    score: 0.5,
    trace: {},
    ...rest,
  };
}

const ctx = {} as StageContext;

describe("TiebreakStage", () => {
  it("returns candidates unchanged when nothing has been scored", async () => {
    const lookup: LastDispatchedLookup = vi.fn();
    const stage = new TiebreakStage({ strategy: "nearest" }, lookup);
    const candidates = [makeCandidate({ score: null }), makeCandidate({ score: null })];

    const result = await stage.run(candidates, ctx);

    expect(result).toEqual(candidates);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not reorder across distinct score bands", async () => {
    const lookup: LastDispatchedLookup = vi.fn();
    const stage = new TiebreakStage({ strategy: "nearest" }, lookup);
    const best = makeCandidate({ score: 0.9, worker: { id: "best" } });
    const worst = makeCandidate({ score: 0.1, worker: { id: "worst" } });

    const [winner] = await stage.run([worst, best], ctx);

    expect(winner.worker.id).toBe("best");
  });

  it("'nearest' sorts a tied band by ascending distance", async () => {
    const lookup: LastDispatchedLookup = vi.fn();
    const stage = new TiebreakStage({ strategy: "nearest" }, lookup);
    const far = makeCandidate({ score: 0.5, distanceMeters: 5000, worker: { id: "far" } });
    const near = makeCandidate({ score: 0.5, distanceMeters: 100, worker: { id: "near" } });

    const [winner] = await stage.run([far, near], ctx);

    expect(winner.worker.id).toBe("near");
    expect(winner.trace.tiebreak).toMatchObject({ strategy: "nearest", tied: true });
  });

  it("'fifo' preserves the candidates' natural order within a tied band", async () => {
    const lookup: LastDispatchedLookup = vi.fn();
    const stage = new TiebreakStage({ strategy: "fifo" }, lookup);
    const first = makeCandidate({ score: 0.5, worker: { id: "first" } });
    const second = makeCandidate({ score: 0.5, worker: { id: "second" } });

    const result = await stage.run([first, second], ctx);

    expect(result.map((c) => c.worker.id)).toEqual(["first", "second"]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("'round_robin' picks the worker with the oldest last dispatch and skips singleton bands", async () => {
    const lookup: LastDispatchedLookup = vi.fn(async (workerIds: string[]) => {
      const map = new Map<string, Date | null>();
      map.set("recent", new Date("2026-01-02T00:00:00Z"));
      map.set("stale", new Date("2026-01-01T00:00:00Z"));
      map.set("never", null);
      return new Map(workerIds.map((id) => [id, map.get(id) ?? null]));
    });
    const stage = new TiebreakStage({ strategy: "round_robin" }, lookup);
    const recent = makeCandidate({ score: 0.5, worker: { id: "recent" } });
    const stale = makeCandidate({ score: 0.5, worker: { id: "stale" } });
    const never = makeCandidate({ score: 0.5, worker: { id: "never" } });

    const result = await stage.run([recent, stale, never], ctx);

    expect(result.map((c) => c.worker.id)).toEqual(["never", "stale", "recent"]);
    expect(lookup).toHaveBeenCalledWith(expect.arrayContaining(["recent", "stale", "never"]));
  });

  it("'round_robin' never queries when there is no tie", async () => {
    const lookup: LastDispatchedLookup = vi.fn();
    const stage = new TiebreakStage({ strategy: "round_robin" }, lookup);
    const a = makeCandidate({ score: 0.9, worker: { id: "a" } });
    const b = makeCandidate({ score: 0.1, worker: { id: "b" } });

    await stage.run([a, b], ctx);

    expect(lookup).not.toHaveBeenCalled();
  });
});
