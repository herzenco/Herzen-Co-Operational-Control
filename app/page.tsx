import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Lupe — Herzen Co. Operations",
  description: "The agent operations command center for Herzen Co.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  redirect("/command");
}
