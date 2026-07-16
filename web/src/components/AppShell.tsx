"use client";

import { useState } from "react";
import { ChatApp } from "@/components/ChatApp";
import {
  Project,
  ProjectLauncher,
  Workspace,
} from "@/components/ProjectLauncher";

export function AppShell() {
  const [view, setView] = useState<"launcher" | "chat">("launcher");
  const [directory, setDirectory] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceLabel, setWorkspaceLabel] = useState<string>("");

  const openWorkspace = (ws: Workspace, project: Project) => {
    setDirectory(ws.absolutePath);
    setWorkspaceId(ws.id);
    setWorkspaceLabel(`${project.name} / ${ws.displayName}`);
    setView("chat");
  };

  if (view === "launcher") {
    return (
      <div className="min-h-dvh bg-[#0f1419]">
        <ProjectLauncher onOpenWorkspace={openWorkspace} />
      </div>
    );
  }

  return (
    <ChatApp
      initialDirectory={directory}
      workspaceId={workspaceId}
      workspaceLabel={workspaceLabel}
      onBack={() => setView("launcher")}
    />
  );
}
