import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CommandCenter } from "./command-center";
import { createClient } from "../utils/supabase/server";

export const metadata: Metadata = {
  title: "Lupe — Herzen Co. Operations",
  description: "The agent operations command center for Herzen Co.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  return <CommandCenter />;
}
