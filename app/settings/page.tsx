import type { Metadata } from "next";
import SettingsScreen from "@/components/settings-screen";

export const metadata: Metadata = {
  title: "Settings",
  description: "Defaults, limits and scheduled checks for your LoadPulse load testing console.",
};

export default function Page() {
  return <SettingsScreen />;
}
