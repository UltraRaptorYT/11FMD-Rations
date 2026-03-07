"use client";

import { useEffect, useState } from "react";

const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE || "none";
const STORAGE_KEY = "sgid:name";

export function useAuth() {
  const [isLoading, setIsLoading] = useState(AUTH_MODE !== "none");
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (AUTH_MODE === "none") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setName(stored);
    setIsLoading(false);
  }, []);

  return {
    isLoading,
    isAuthenticated: AUTH_MODE === "none" || !!name,
    name,
    login: () => {
      window.location.href = "/api/auth/sgid";
    },
    logout: () => {
      localStorage.removeItem(STORAGE_KEY);
      setName(null);
      window.location.reload();
    },
  };
}
