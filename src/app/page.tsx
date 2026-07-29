import { redirect } from "next/navigation";

/**
 * The root lands on Insight → Overview, the owner/admin morning read and the
 * warehouse lead's "what needs hands today" list.
 */
export default function Home() {
  redirect("/dashboard");
}
