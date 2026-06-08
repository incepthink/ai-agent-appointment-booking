"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";
import { Spinner } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? "/appointments" : "/login");
  }, [router]);
  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner className="size-6 text-brand" />
    </div>
  );
}
