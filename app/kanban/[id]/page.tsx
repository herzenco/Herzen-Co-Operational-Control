import type { Metadata } from "next";
import { OccPage } from "../../occ-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket — Herzen Co. OCC" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <OccPage view="kanban" taskId={id} />; }
