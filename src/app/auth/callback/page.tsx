import { Suspense } from "react";
import AuthCallbackClient from "@/app/auth/callback/AuthCallbackClient";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-sm" style={{ color: "#666" }}>
            Logging you in...
          </p>
        </div>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
