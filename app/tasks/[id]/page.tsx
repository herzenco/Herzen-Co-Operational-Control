import { redirect } from "next/navigation";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/kanban/${encodeURIComponent(id)}`);
}
