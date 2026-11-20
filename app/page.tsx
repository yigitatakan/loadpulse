import type { Metadata } from "next";
import ConsoleScreen from "@/components/console-screen";

export const metadata: Metadata = {
  title: "Console",
  description:
    "Point LoadPulse at your own website, choose parallel connections and watch the live results arrive.",
};

export default function Page() {
  return <ConsoleScreen />;
}
