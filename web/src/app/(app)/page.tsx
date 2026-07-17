import { HomeView } from "@/components/home/HomeView";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string | string[] }>;
}) {
  const projectId = (await searchParams).projectId;
  return (
    <HomeView
      initialProjectId={typeof projectId === "string" ? projectId : undefined}
    />
  );
}