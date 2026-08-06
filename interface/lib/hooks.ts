"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { api } from "./api";

/** Live-ish polling interval for telemetry views (PLAN.md: "polling via SWR initially"). */
export const LIVE_POLL_MS = 5000;
const live: SWRConfiguration = { refreshInterval: LIVE_POLL_MS };

export const useGroups = () => useSWR("groups", () => api.groups.list());
export const useGroup = (id: string | undefined) => useSWR(id ? ["group", id] : null, () => api.groups.get(id!));

export const useJurisdictions = (groupId: string | undefined) =>
  useSWR(groupId ? ["jurisdictions", groupId] : null, () => api.jurisdictions.listByGroup(groupId!));
export const useJurisdiction = (id: string | undefined) =>
  useSWR(id ? ["jurisdiction", id] : null, () => api.jurisdictions.get(id!));

export const useZones = (jurisdictionId: string | undefined) =>
  useSWR(jurisdictionId ? ["zones", jurisdictionId] : null, () => api.zones.listByJurisdiction(jurisdictionId!));

export const useWorkers = (jurisdictionId: string | undefined) =>
  useSWR(["workers", jurisdictionId ?? "all"], () => api.workers.list(jurisdictionId), live);
export const useWorker = (id: string | undefined) => useSWR(id ? ["worker", id] : null, () => api.workers.get(id!));
export const useSchedules = (workerId: string | undefined) =>
  useSWR(workerId ? ["schedules", workerId] : null, () => api.schedules.listByWorker(workerId!));

export const useOrders = (filter?: { jurisdictionId?: string; state?: string }) =>
  useSWR(["orders", filter?.jurisdictionId ?? "all", filter?.state ?? "all"], () => api.orders.list(filter), live);
export const useOrder = (id: string | undefined) =>
  useSWR(id ? ["order", id] : null, () => api.orders.get(id!), live);
export const useOrderAssignments = (id: string | undefined) =>
  useSWR(id ? ["order-assignments", id] : null, () => api.orders.assignments(id!), live);
export const useOrderAudit = (id: string | undefined) =>
  useSWR(id ? ["order-audit", id] : null, () => api.orders.audit(id!), live);

export const useAssignments = (filter?: { workerId?: string; jurisdictionId?: string }) =>
  useSWR(["assignments", filter?.workerId ?? "all", filter?.jurisdictionId ?? "all"], () => api.assignments.list(filter), live);

export const useSettings = (filter?: { scope?: string; groupId?: string; jurisdictionId?: string }) =>
  useSWR(["settings", filter?.scope ?? "", filter?.groupId ?? "", filter?.jurisdictionId ?? ""], () => api.settings.list(filter));

export const usePipeline = (jurisdictionId: string | undefined) =>
  useSWR(jurisdictionId ? ["pipeline", jurisdictionId] : null, () => api.pipeline.get(jurisdictionId!));
export const usePipelinePresets = () => useSWR("pipeline-presets", () => api.pipeline.presets());

export const useMetricDefinitions = (jurisdictionId?: string) =>
  useSWR(["metric-definitions", jurisdictionId ?? "all"], () => api.metrics.definitions(jurisdictionId));

export const useMetricQuery = (params: { metric: string; from: string; to: string; jurisdictionId?: string; groupBy?: string } | null) =>
  useSWR(params ? ["metric-query", JSON.stringify(params)] : null, () => api.metrics.query(params!), live);

export const useEngineHealth = () => useSWR("engine-health", () => api.health.engine(), live);
