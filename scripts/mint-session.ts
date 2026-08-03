import "dotenv/config";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";

/**
 * Prints a session cookie value for smoke-testing gated screens locally.
 *
 * Every /dashboard route redirects to /login without a session, so curl alone
 * returns a 307 and proves nothing. Signed with v2's own AUTH_SECRET, so the
 * cookie is worthless against v1.
 *
 *   TOKEN=$(npx tsx scripts/mint-session.ts)
 *   curl -H "Cookie: authjs.session-token=$TOKEN" http://localhost:3001/dashboard/units
 */
async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "admin@vfxnow.com" },
    select: { id: true, name: true, email: true, role: true },
  });

  const token = await encode({
    token: {
      id: user.id,
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    secret: process.env.AUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 3600,
  });

  process.stdout.write(token);
}

main().finally(() => prisma.$disconnect());
