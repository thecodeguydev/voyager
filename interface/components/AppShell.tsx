"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useScope } from "@/lib/scope";
import { useGroups, useJurisdictions } from "@/lib/hooks";

const NAV = [
  { href: "/dashboard", label: "Command Dashboard" },
  { href: "/telemetry", label: "Dispatch Telemetry" },
  { href: "/orders", label: "Orders" },
  { href: "/workers", label: "Workers" },
  { href: "/groups", label: "Groups & Jurisdictions" },
  { href: "/settings", label: "Settings" },
  { href: "/metrics", label: "Metrics Dictionary" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border-hairline bg-surface-card">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="h-7 w-7 rounded-md bg-brand-action" />
          <span className="text-lg font-semibold tracking-tight text-text-primary">Voyager</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-brand-action text-white" : "text-text-secondary hover:bg-surface-sunken",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <ScopePicker />
      </aside>
      <main className="flex-1 overflow-x-hidden px-8 py-8">{children}</main>
    </div>
  );
}

function ScopePicker() {
  const { actor, setActorName, groupId, jurisdictionId, setGroupId, setJurisdictionId } = useScope();
  const { data: groups } = useGroups();
  const { data: jurisdictions } = useJurisdictions(groupId ?? undefined);

  return (
    <div className="space-y-3 border-t border-border-hairline px-4 py-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Group</label>
        <select
          className="w-full rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm"
          value={groupId ?? ""}
          onChange={(e) => setGroupId(e.target.value || null)}
        >
          <option value="">All groups</option>
          {groups?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Jurisdiction</label>
        <select
          className="w-full rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm disabled:opacity-50"
          value={jurisdictionId ?? ""}
          onChange={(e) => setJurisdictionId(e.target.value || null)}
          disabled={!groupId}
        >
          <option value="">All jurisdictions</option>
          {jurisdictions?.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Acting as</label>
        <input
          className="w-full rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm"
          value={actor}
          onChange={(e) => setActorName(e.target.value)}
          placeholder="dispatcher name"
        />
      </div>
    </div>
  );
}
