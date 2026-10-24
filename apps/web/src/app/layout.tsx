import type { Metadata } from "next";
import "@fontsource/noto-sans-bengali/400.css";
import "@fontsource/noto-sans-bengali/500.css";
import "@fontsource/noto-sans-bengali/700.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "TutorLink AI Marketing Manager",
  description: "Autonomous, lead-first organic marketing operations for TutorLink Media."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="bn"><body><Providers>{children}</Providers></body></html>;
}
