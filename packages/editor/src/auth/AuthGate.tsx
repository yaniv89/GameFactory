import type { FC, PropsWithChildren } from "react";
import { useAuthStore } from "./authStore";
import { LoginView } from "./LoginView";

/** Renders `children` only once a real session exists; otherwise the sign-in form. */
export const AuthGate: FC<PropsWithChildren> = ({ children }) => {
  const status = useAuthStore((s) => s.status);
  if (status !== "signedIn") return <LoginView />;
  return <>{children}</>;
};
