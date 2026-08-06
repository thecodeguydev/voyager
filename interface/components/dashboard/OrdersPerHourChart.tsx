"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMetricQuery } from "@/lib/hooks";
import { timeWindow, DAY_MS } from "@/lib/timeWindow";
import { EmptyState } from "@/components/ui/Card";

/** Single-series volume chart — one categorical slot, no legend box needed (dataviz: "a single series needs no legend"). */
export function OrdersPerHourChart({ jurisdictionId }: { jurisdictionId?: string }) {
  const { from, to } = timeWindow(DAY_MS);
  const { data } = useMetricQuery({ metric: "orders.created", from, to, jurisdictionId, groupBy: "hour" });

  const rows = (data?.rows ?? []).map((r) => ({
    bucket: r.bucket ? new Date(r.bucket).toLocaleTimeString(undefined, { hour: "numeric" }) : "",
    value: r.value,
  }));

  if (data && rows.every((r) => r.value === 0)) {
    return <EmptyState title="No orders in the last 24 hours" hint="Orders will appear here as they're created." />;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} barCategoryGap={4}>
        <CartesianGrid stroke="var(--border-hairline)" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} />
        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: "var(--surface-card)", border: "1px solid var(--border-hairline)", borderRadius: 8, fontSize: 13 }}
          labelStyle={{ color: "var(--text-secondary)" }}
          cursor={{ fill: "var(--surface-sunken)" }}
        />
        <Bar dataKey="value" name="Orders" fill="var(--chart-series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
