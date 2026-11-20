import type { Metadata } from "next";
import HistoryScreen from "@/components/history-screen";

export const metadata: Metadata = {
  title: "History",
  description: "Every load test LoadPulse has run, with totals, latency and error rate for each burst.",
};

export default function Page() {
  return <HistoryScreen />;
}
