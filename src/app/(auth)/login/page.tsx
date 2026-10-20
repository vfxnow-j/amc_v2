import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm, LoginFormSkeleton } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" footer="v2.0">
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
