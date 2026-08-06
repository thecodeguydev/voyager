import type {
  Assignment,
  AuditLog,
  Group,
  Jurisdiction,
  MetricDefinition,
  MetricQueryResult,
  Order,
  PipelineConfigView,
  PresetCatalog,
  Schedule,
  Setting,
  StageDefinition,
  Worker,
  WebhookEvent,
  WebhookSource,
  Zone,
  EngineHealthReport,
} from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let actor = "dispatcher";
/** Sets the X-Actor header value sent on every mutating request. See lib/scope.tsx. */
export function setActor(name: string) {
  actor = name || "unknown";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Actor": actor,
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? { message: res.statusText, code: "UNKNOWN_ERROR" };
    throw new ApiError(err.message, err.code, res.status, err.details);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

function query(params: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const api = {
  groups: {
    list: () => get<Group[]>("/groups"),
    get: (id: string) => get<Group>(`/groups/${id}`),
    create: (body: { name: string; code: string; description?: string; status?: string }) =>
      post<Group>("/groups", body),
    update: (id: string, body: Partial<{ name: string; code: string; description: string | null; status: string }>) =>
      put<Group>(`/groups/${id}`, body),
    remove: (id: string) => del<void>(`/groups/${id}`),
  },

  jurisdictions: {
    listByGroup: (groupId: string) => get<Jurisdiction[]>(`/groups/${groupId}/jurisdictions`),
    get: (id: string) => get<Jurisdiction>(`/jurisdictions/${id}`),
    create: (groupId: string, body: { name: string; code: string; timezone: string; status?: string }) =>
      post<Jurisdiction>(`/groups/${groupId}/jurisdictions`, body),
    update: (id: string, body: Partial<{ name: string; code: string; timezone: string; status: string }>) =>
      put<Jurisdiction>(`/jurisdictions/${id}`, body),
    remove: (id: string) => del<void>(`/jurisdictions/${id}`),
  },

  zones: {
    listByJurisdiction: (jurisdictionId: string) => get<Zone[]>(`/jurisdictions/${jurisdictionId}/zones`),
    get: (id: string) => get<Zone>(`/zones/${id}`),
    create: (jurisdictionId: string, body: { name: string; status?: string; boundary: Zone["boundary"]; centroid: Zone["centroid"] }) =>
      post<Zone>(`/jurisdictions/${jurisdictionId}/zones`, body),
    update: (id: string, body: Partial<{ name: string; status: string; boundary: Zone["boundary"]; centroid: Zone["centroid"] }>) =>
      put<Zone>(`/zones/${id}`, body),
    remove: (id: string) => del<void>(`/zones/${id}`),
  },

  workers: {
    list: (jurisdictionId?: string) => get<Worker[]>(`/workers${query({ jurisdictionId })}`),
    get: (id: string) => get<Worker>(`/workers/${id}`),
    create: (body: Partial<Worker> & { jurisdictionId: string; externalId: string; name: string; type: string }) =>
      post<Worker>("/workers", body),
    update: (id: string, body: Partial<Worker>) => put<Worker>(`/workers/${id}`, body),
    remove: (id: string) => del<void>(`/workers/${id}`),
    setStatus: (id: string, status: string) => put<Worker>(`/workers/${id}/status`, { status }),
    setLocation: (id: string, location: { lng: number; lat: number }) =>
      put<Worker>(`/workers/${id}/location`, { location }),
  },

  schedules: {
    listByWorker: (workerId: string) => get<Schedule[]>(`/workers/${workerId}/schedules`),
    create: (workerId: string, body: Partial<Schedule> & { startTime: string; endTime: string; type: string }) =>
      post<Schedule>(`/workers/${workerId}/schedules`, body),
    update: (id: string, body: Partial<Schedule>) => put<Schedule>(`/schedules/${id}`, body),
    remove: (id: string) => del<void>(`/schedules/${id}`),
  },

  orders: {
    list: (filter?: { jurisdictionId?: string; state?: string }) =>
      get<Order[]>(`/orders${query({ jurisdictionId: filter?.jurisdictionId, state: filter?.state })}`),
    get: (id: string) => get<Order>(`/orders/${id}`),
    cancel: (id: string) => post<Order>(`/orders/${id}/cancel`),
    accept: (id: string, reason?: string) => post<Assignment>(`/orders/${id}/accept`, { reason }),
    reject: (id: string, reason?: string) => post<Assignment>(`/orders/${id}/reject`, { reason }),
    progress: (id: string, reason?: string) => post<Assignment>(`/orders/${id}/progress`, { reason }),
    complete: (id: string, reason?: string) => post<Assignment>(`/orders/${id}/complete`, { reason }),
    assignments: (id: string) => get<Assignment[]>(`/orders/${id}/assignments`),
    reassign: (id: string, body: { workerId: string; reason: string; force?: boolean }) =>
      post<{ assignment: Assignment; warnings: string[] }>(`/orders/${id}/reassign`, body),
    unassign: (id: string, reason: string) => post<Order>(`/orders/${id}/unassign`, { reason }),
    audit: (id: string) => get<AuditLog[]>(`/orders/${id}/audit`),
  },

  assignments: {
    list: (filter?: { workerId?: string; jurisdictionId?: string }) =>
      get<Assignment[]>(`/assignments${query({ workerId: filter?.workerId, jurisdictionId: filter?.jurisdictionId })}`),
  },

  settings: {
    list: (filter?: { scope?: string; groupId?: string; jurisdictionId?: string }) =>
      get<Setting[]>(`/settings${query({ scope: filter?.scope, groupId: filter?.groupId, jurisdictionId: filter?.jurisdictionId })}`),
    upsert: (key: string, body: { scope: string; groupId?: string | null; jurisdictionId?: string | null; value: unknown; dataType?: string; description?: string | null }) =>
      put<Setting>(`/settings/${key}`, body),
    audit: (key: string, filter: { scope: string; groupId?: string; jurisdictionId?: string }) =>
      get<AuditLog[]>(`/settings/${key}/audit${query(filter)}`),
    rollback: (key: string, auditLogId: string) => post<Setting>(`/settings/${key}/rollback`, { auditLogId }),
  },

  pipeline: {
    get: (jurisdictionId: string) => get<PipelineConfigView>(`/jurisdictions/${jurisdictionId}/pipeline`),
    put: (jurisdictionId: string, body: { preset: string; stages: StageDefinition[]; enabled: boolean }) =>
      put<PipelineConfigView>(`/jurisdictions/${jurisdictionId}/pipeline`, body),
    audit: (jurisdictionId: string) => get<AuditLog[]>(`/jurisdictions/${jurisdictionId}/pipeline/audit`),
    presets: () => get<PresetCatalog>("/pipeline/presets"),
  },

  metrics: {
    definitions: (jurisdictionId?: string) => get<MetricDefinition[]>(`/metrics/definitions${query({ jurisdictionId })}`),
    createDefinition: (body: {
      key: string;
      name: string;
      description?: string;
      unit: string;
      type: string;
      aggregation: string;
      jurisdictionId?: string | null;
    }) => post<MetricDefinition>("/metrics/definitions", body),
    query: (params: { metric: string; from: string; to: string; jurisdictionId?: string; groupBy?: string }) =>
      get<MetricQueryResult>(`/metrics/query${query(params)}`),
  },

  webhookSources: {
    listByGroup: (groupId: string) => get<WebhookSource[]>(`/groups/${groupId}/webhook-sources`),
    get: (id: string) => get<WebhookSource>(`/webhook-sources/${id}`),
    create: (groupId: string, body: { name: string; slug: string; allowedEvents?: string[] | null; status?: string }) =>
      post<WebhookSource>(`/groups/${groupId}/webhook-sources`, body),
    update: (id: string, body: Partial<{ name: string; allowedEvents: string[] | null; status: string }>) =>
      put<WebhookSource>(`/webhook-sources/${id}`, body),
    remove: (id: string) => del<void>(`/webhook-sources/${id}`),
    rotateSecret: (id: string) => post<WebhookSource>(`/webhook-sources/${id}/rotate-secret`),
    events: (id: string, status?: string) => get<WebhookEvent[]>(`/webhook-sources/${id}/events${query({ status })}`),
  },

  health: {
    // GET /health/engine returns 503 (not 2xx) when status="degraded" — that's still a
    // valid EngineHealthReport body, not a request failure, so this bypasses request()'s
    // generic !res.ok -> throw and only throws on an actually-malformed/network failure.
    engine: async (): Promise<EngineHealthReport> => {
      const res = await fetch(`${API_BASE_URL}/health/engine`, { headers: { "X-Actor": actor } });
      const body = await res.json().catch(() => null);
      if (!body || typeof body.status !== "string") {
        throw new ApiError(res.statusText || "Failed to load engine health", "UNKNOWN_ERROR", res.status);
      }
      return body as EngineHealthReport;
    },
  },
};
