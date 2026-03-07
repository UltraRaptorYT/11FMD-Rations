// app/auth/callback/AuthCallbackClient.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function AuthCallbackClient() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const name = params.get("name");
    const error = params.get("error");

    if (error) {
      console.error("[sgID] Auth error:", error);
    } else if (name) {
      localStorage.setItem("sgid:name", name);
    }

    router.replace("/");
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm" style={{ color: "#666" }}>
        Logging you in...
      </p>
    </div>
  );
}
