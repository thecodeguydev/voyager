"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setActor } from "./api";

type ScopeState = {
  actor: string;
  setActorName: (name: string) => void;
  groupId: string | null;
  jurisdictionId: string | null;
  setGroupId: (id: string | null) => void;
  setJurisdictionId: (id: string | null) => void;
};

const ScopeContext = createContext<ScopeState | null>(null);

const STORAGE_KEY = "voyager.scope";

/** Persists the acting-dispatcher name and the current group/jurisdiction selection across the app. */
export function ScopeProvider({ children }: { children: ReactNode }) {
  const [actor, setActorState] = useState("dispatcher");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [jurisdictionId, setJurisdictionId] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      if (saved.actor) setActorState(saved.actor);
      if (saved.groupId) setGroupId(saved.groupId);
      if (saved.jurisdictionId) setJurisdictionId(saved.jurisdictionId);
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    setActor(actor);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ actor, groupId, jurisdictionId }));
  }, [actor, groupId, jurisdictionId]);

  const setActorName = (name: string) => setActorState(name || "unknown");
  const setGroup = (id: string | null) => {
    setGroupId(id);
    setJurisdictionId(null);
  };

  return (
    <ScopeContext.Provider
      value={{ actor, setActorName, groupId, jurisdictionId, setGroupId: setGroup, setJurisdictionId }}
    >
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within a ScopeProvider");
  return ctx;
}
