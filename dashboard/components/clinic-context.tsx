"use client";

import * as React from "react";
import type { Clinic, Doctor } from "@/lib/types";

type ClinicContextValue = {
  clinic: Clinic;
  setClinic: (c: Clinic) => void;
  // The logged-in doctor (their own profile + hours).
  doctor: Doctor;
  setDoctor: (d: Doctor) => void;
  // All doctors at the clinic — for the appointments filter + booking picker.
  doctors: Doctor[];
};

const ClinicContext = React.createContext<ClinicContextValue | null>(null);

export function useClinic(): ClinicContextValue {
  const ctx = React.useContext(ClinicContext);
  if (!ctx) throw new Error("useClinic must be used within ClinicProvider");
  return ctx;
}

export function ClinicProvider({
  initialClinic,
  initialDoctor,
  doctors,
  children,
}: {
  initialClinic: Clinic;
  initialDoctor: Doctor;
  doctors: Doctor[];
  children: React.ReactNode;
}) {
  const [clinic, setClinic] = React.useState<Clinic>(initialClinic);
  const [doctor, setDoctor] = React.useState<Doctor>(initialDoctor);
  return (
    <ClinicContext.Provider value={{ clinic, setClinic, doctor, setDoctor, doctors }}>
      {children}
    </ClinicContext.Provider>
  );
}
