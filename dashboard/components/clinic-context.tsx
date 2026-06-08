"use client";

import * as React from "react";
import type { Clinic } from "@/lib/types";

type ClinicContextValue = {
  clinic: Clinic;
  setClinic: (c: Clinic) => void;
};

const ClinicContext = React.createContext<ClinicContextValue | null>(null);

export function useClinic(): ClinicContextValue {
  const ctx = React.useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within ClinicProvider");
  return ctx;
}

export function ClinicProvider({
  initial,
  children,
}: {
  initial: Clinic;
  children: React.ReactNode;
}) {
  const [clinic, setClinic] = React.useState<Clinic>(initial);
  return <ClinicContext.Provider value={{ clinic, setClinic }}>{children}</ClinicContext.Provider>;
}
