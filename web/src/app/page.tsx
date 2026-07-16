import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "OpenCode WebUI",
  description: "Workspace Manager for OpenCode",
};

export default function Home() {
  return <AppShell />;
}
