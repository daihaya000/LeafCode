"use client";

import { AppShell } from "@/components/shell/AppShell";
import { LoginGate } from "@/components/auth/LoginGate";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LoginGate>
      <AppShell>{children}</AppShell>
    </LoginGate>
  );
}
