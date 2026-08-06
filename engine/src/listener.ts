import { Client } from "pg";

export interface DispatchListener {
  stop(): Promise<void>;
}

export interface StartListenerOptions {
  databaseUrl: string;
  onWake: () => void;
  onError?: (err: unknown) => void;
  reconnectDelayMs?: number;
}

/**
 * Runs a dedicated `LISTEN dispatch_new` connection (see PLAN.md "Queue notification
 * mechanism"). Reconnects and re-LISTENs on any connection error, firing `onWake` once
 * immediately after (re)connecting so nothing enqueued during a blind window goes unnoticed —
 * the poll loop is the backstop if this never recovers.
 */
export function startListener(options: StartListenerOptions): DispatchListener {
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
  let client: Client | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs);
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const next = new Client({ connectionString: options.databaseUrl });
    next.on("notification", () => options.onWake());
    next.on("error", (err) => {
      options.onError?.(err);
      scheduleReconnect();
    });
    next.on("end", () => {
      if (!stopped) scheduleReconnect();
    });

    try {
      await next.connect();
      await next.query("LISTEN dispatch_new");
      // stop() may have run while the above was in flight; discard this connection rather than
      // adopting it, or it would outlive stop() as a leaked LISTEN connection.
      if (stopped) {
        await next.end().catch(() => {});
        return;
      }
      client = next;
      options.onWake(); // catch up on anything enqueued while disconnected
    } catch (err) {
      options.onError?.(err);
      scheduleReconnect();
    }
  }

  void connect();

  return {
    async stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      await client?.end().catch(() => {});
    },
  };
}
