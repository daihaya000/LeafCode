"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LoginGate } from "@/components/auth/LoginGate";
import { maybeRedirectToLocalhost } from "@/lib/localhost-redirect";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // When this browser is on the host PC but reached the WebUI via a LAN IP,
  // move it to the loopback URL so host-only features (folder picker, voice
  // input, restart, login-free loopback) keep working. Remote phones are never
  // touched: the reachability probe only succeeds on the host itself.
  useEffect(() => {
    void maybeRedirectToLocalhost();
  }, []);

  return (
    <LoginGate>
      <AppShell>{children}</AppShell>
    </LoginGate>
  );
}
