
import { CommandPalette } from "@/components/CommandPalette";
import {
  ShellProvider,
  useShellActiveScope,
  useShellExtras,
  useShellMobileNav,
} from "./ShellContext";
import { Sidebar } from "./Sidebar";
import { GlobalAttentionProvider } from "./GlobalAttentionProvider";
import { AttentionQueueModal } from "./AttentionQueueModal";
import { MobileScrollTargetProvider } from "./MobileScrollTargetContext";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { extras } = useShellExtras();
  const activeScope = useShellActiveScope();
  const { mobileNavOpen, closeMobileNav } = useShellMobileNav();

  return (
    <GlobalAttentionProvider activeScope={activeScope}>
      <MobileScrollTargetProvider>
        <div className="flex h-dvh flex-col bg-bg text-text md:flex-row">
          <CommandPalette directory={extras.directory} onFile={extras.onFile} />

          <Sidebar mobileOpen={mobileNavOpen} onClose={closeMobileNav} />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </div>
      </MobileScrollTargetProvider>
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
