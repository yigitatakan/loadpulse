import type { Metadata } from "next";
import CompareScreen from "@/components/compare-screen";

export const metadata: Metadata = {
  title: "Compare",
  description: "Put two LoadPulse runs side by side and see how latency and error rate changed.",
};

export default function Page() {
  return <CompareScreen />;
}
