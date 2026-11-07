import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NYURAT.AI | Draf papan nama",
  description: "Studio untuk menyusun draf papan nama beraksara Bali dan mengaudit foto papan.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
