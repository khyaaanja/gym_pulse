"use client";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return <Button variant="secondary" className="w-full print:hidden" onClick={() => window.print()}>Print or save as PDF</Button>;
}
