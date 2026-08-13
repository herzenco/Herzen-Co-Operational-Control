import { redirect } from "next/navigation";
import { CommandCenter, type View } from "./command-center";
import { createClient } from "../utils/supabase/server";

export async function OccPage({ view, taskId = "" }: { view: View; taskId?: string }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const path = taskId ? `/kanban/${encodeURIComponent(taskId)}` : `/${view === "command" ? "command" : view}`;
  if (!session) redirect(`/login?next=${encodeURIComponent(path)}`);
  return <CommandCenter />;
}
