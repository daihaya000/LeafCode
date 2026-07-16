import type { Metadata } from "next";
import { ChatApp } from "@/components/ChatApp";

export const metadata: Metadata = {
  title: "OpenCode WebUI",
  description: "Workspace Manager for OpenCode",
};

export default function Home() {
  return <ChatApp />;
}
