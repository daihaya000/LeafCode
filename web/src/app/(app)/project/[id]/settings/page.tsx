import { ProjectSettingsView } from "@/components/settings/ProjectSettingsView";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectSettingsView projectId={id} />;
}
