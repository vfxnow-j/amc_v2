import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm, LoginFormSkeleton } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      blurb="Asset management, rental and sales operations."
      footer="This is the v2 instance, on port 3001."
    >
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
