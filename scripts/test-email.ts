import "dotenv/config";
import { isEmailConfigured, EMAIL_FROM, APP_URL } from "@/lib/email/client";
import { sendEmail } from "@/lib/email";

/**
 * Prove the Resend wiring, without clicking through the app.
 *
 * Sending a real quote to find out whether the key works is a bad first test:
 * it needs an order in the right state, and it mails whoever is on that order.
 * This sends one message and reports exactly what the app would do.
 *
 *   npx tsx scripts/test-email.ts you@example.com
 *
 * It refuses without an explicit recipient. Defaulting to an address from the
 * database would be the one mistake worth designing out — this instance runs on
 * restored customer data.
 */
async function main() {
  const to = process.argv[2]?.trim();

  console.log("RESEND_API_KEY       ", isEmailConfigured() ? "set" : "MISSING");
  console.log("EMAIL_FROM           ", EMAIL_FROM);
  console.log("APP_URL              ", APP_URL);
  console.log(
    "EMAIL_TEST_REDIRECT  ",
    process.env.EMAIL_TEST_REDIRECT?.trim() ||
      "not set — mail goes to its real recipient",
  );

  if (APP_URL.includes("localhost")) {
    console.log(
      "\n  ! APP_URL is localhost, so every quote link mailed out points at the\n" +
        "    recipient's own machine and will not open. Set it to the address\n" +
        "    the reader can reach before sending a quote to anyone.",
    );
  }
  if (!process.env.EMAIL_TEST_REDIRECT?.trim()) {
    console.log(
      "\n  ! EMAIL_TEST_REDIRECT is not set. Any send from the app goes to the\n" +
        "    address on the record — and those are real clients. Set it while\n" +
        "    testing.",
    );
  }

  if (!to) {
    console.log("\nPass an address to send a test to:");
    console.log("  npx tsx scripts/test-email.ts you@example.com");
    return;
  }

  if (!isEmailConfigured()) {
    console.log("\nNothing to send with — set RESEND_API_KEY first.");
    process.exitCode = 1;
    return;
  }

  console.log(`\nSending to ${to} …`);
  const result = await sendEmail({
    to,
    subject: "VFXNow AMC v2 — test send",
    html:
      `<div style="font:15px/1.6 system-ui,sans-serif;color:#18181b">` +
      `<h1 style="font-size:19px;margin:0 0 12px">Outbound email works</h1>` +
      `<p style="margin:0 0 10px">Sent from the v2 instance via Resend.</p>` +
      `<p style="margin:0 0 4px;color:#71717a;font-size:13px">From: ${EMAIL_FROM}</p>` +
      `<p style="margin:0;color:#71717a;font-size:13px">App URL: ${APP_URL}</p>` +
      `</div>`,
  });

  if (result.success) {
    console.log("Sent. Check the inbox, and Resend's dashboard for delivery.");
  } else {
    console.log(`Refused: ${result.error}`);
    process.exitCode = 1;
  }
}

main();
