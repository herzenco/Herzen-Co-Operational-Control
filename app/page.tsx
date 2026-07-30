import type { Metadata } from "next";
import { CommandCenter } from "./command-center";

export const metadata: Metadata = {
  title: "Lupe — Herzen Co. Operations",
  description: "The agent operations command center for Herzen Co.",
};

export default function Home() {
  return <CommandCenter />;
}
