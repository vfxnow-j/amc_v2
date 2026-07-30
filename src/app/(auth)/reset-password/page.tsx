import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Set a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      blurb="Choose something you haven’t used here before."
    >
      <Suspense
        fallback={
          <div className="animate-pulse">
            <div className="h-10 rounded-well bg-sunken" />
            <div className="mt-4 h-10 rounded-well bg-sunken" />
            <div className="mt-5 h-10 rounded-pill bg-sunken" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
