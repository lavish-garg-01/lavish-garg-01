import type { ReactNode } from "react";
import { ProductProvider } from "../components/product-provider";

export default function CandidateLayout({ children }: { children: ReactNode }) {
  return <ProductProvider>{children}</ProductProvider>;
}
