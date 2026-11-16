"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass("primary", "md")}
    >
      <Printer className="size-4" /> Print or save as PDF
    </button>
  );
}
