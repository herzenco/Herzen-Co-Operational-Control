import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CommandCenter } from "../../command-center";
import { createClient } from "../../../utils/supabase/server";

export const metadata: Metadata = {
  title: "Ticket detail — Herzen Co. OCC",
  description: "Authenticated production OCC ticket detail.",
};

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/tasks/${id}`)}`);
  return <CommandCenter initialTaskId={id} />;
}
