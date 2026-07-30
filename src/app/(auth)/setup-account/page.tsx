import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { SetupAccountForm } from "@/components/auth/setup-account-form";

export const metadata = { title: "Set up your account" };

export default function SetupAccountPage() {
  return (
    <AuthShell
      title="Set up your account"
      blurb="Choose a password and decide about two-factor."
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
        <SetupAccountForm />
      </Suspense>
    </AuthShell>
  );
}
