"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getCurrentUser } from "@/lib/api";

type AuthGuardProps = {
  children: ReactNode;
};

export const AuthGuard = ({ children }: AuthGuardProps) => {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        await getCurrentUser();
        if (active) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (active) {
            router.replace("/login");
          }
          return;
        }
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to verify sign-in."
          );
        }
      }
    };

    void checkSession();
    return () => {
      active = false;
    };
  }, [router]);

  if (error) {
    return (
      <main className="p-8">
        <p role="alert">Could not verify sign-in: {error}</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="p-8">
        <p role="status">Checking sign-in...</p>
      </main>
    );
  }

  return children;
};
