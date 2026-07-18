
import { useState } from "react";
import Link from "next/link";
import { Menu, FolderGit2 } from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { PluginHost } from "@/components/plugins/PluginHost";
import { ShellProvider, useShellActiveScope, useShellExtras } from "./ShellContext";
import { Sidebar } from "./Sidebar";
import { GlobalAttentionProvider } from "./GlobalAttentionProvider";
import { AttentionQueueModal } from "./AttentionQueueModal";
import { AttentionBadge } from "./AttentionBadge";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { extras } = useShellExtras();
  const activeScope = useShellActiveScope();

  return (
    <GlobalAttentionProvider activeScope={activeScope}>
      <div className="flex h-dvh flex-col bg-bg text-text md:flex-row">
        <CommandPalette directory={extras.directory} onFile={extras.onFile} />

        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <button
            type="button"
            aria-label="メニュー"
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm font-semibold tracking-tight"
          >
            <FolderGit2 className="h-4 w-4" />
            OpenCodeWebUI
          </Link>
          <div className="flex-1" />
          <AttentionBadge />
        </div>

        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>

        <PluginHost />
      </div>
      <AttentionQueueModal />
    </GlobalAttentionProvider>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <AppShellInner>{children}</AppShellInner>
    </ShellProvider>
  );
}
