import type { Metadata } from "next";
import "./globals.css";
import { ScopeProvider } from "@/lib/scope";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Voyager — Dispatch Engine",
  description: "Telemetry and control plane for the Voyager dispatch engine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ScopeProvider>
          <AppShell>{children}</AppShell>
        </ScopeProvider>
      </body>
    </html>
  );
}
