import { TaskView } from "@/components/task/TaskView";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Force local composer/stream state to reset when client navigation switches
  // between two dynamic task IDs at the same route position.
  return <TaskView key={id} taskId={id} />;
}
