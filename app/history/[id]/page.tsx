import type { Metadata } from "next";
import RunDetailScreen from "@/components/run-detail-screen";

export const metadata: Metadata = {
  title: "Run detail",
  description: "The totals, response codes and per-second buckets of a single LoadPulse run.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunDetailScreen runId={id} />;
}
