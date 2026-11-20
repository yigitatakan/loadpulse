import type { Metadata } from "next";
import ProxiesScreen from "@/components/proxies-screen";

export const metadata: Metadata = {
  title: "Proxies",
  description: "Save HTTP proxies, test their exit IP and route your LoadPulse bursts through them.",
};

export default function Page() {
  return <ProxiesScreen />;
}
