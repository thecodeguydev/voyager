/** A minute-rounded [from, to] ISO window so SWR keys stay stable within a minute instead of refetching every render. */
export function timeWindow(windowMs: number): { from: string; to: string } {
  const to = Math.floor(Date.now() / 60_000) * 60_000;
  return { from: new Date(to - windowMs).toISOString(), to: new Date(to).toISOString() };
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
