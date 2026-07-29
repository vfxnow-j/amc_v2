import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { checkRateLimit, resetRateLimit } from '@/lib/utils/rate-limit';
import { decryptSecret, verifyTotpCode } from '@/lib/totp';
import { validateTrustToken } from '@/lib/mfa-trust';
import type { UserRole } from '@/generated/prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      image?: string | null;
    };
  }

  interface User {
    role: UserRole;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    role: UserRole;
    trustedDevice?: boolean;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma) as any,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days — trusted devices use full duration; untrusted enforced in session callback
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        mfaCode: { label: 'MFA Code', type: 'text' },
        mfaMethod: { label: 'MFA Method', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = (credentials.email as string).toLowerCase().trim();

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            image: true,
            passwordHash: true,
            mfaEnabled: true,
            mfaSecret: true,
          },
        });

        if (!user || !user.passwordHash) {
          // Dummy bcrypt compare to prevent timing-based enumeration
          await bcrypt.compare(credentials.password as string, '$2a$12$x'.padEnd(60, '0'));
          return null;
        }

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        // MFA verification
        if (user.mfaEnabled) {
          const mfaCode = credentials.mfaCode as string | undefined;
          const mfaMethod = (credentials.mfaMethod as string) || 'email';
          if (!mfaCode) {
            // No MFA code provided — check for a valid trust token cookie
            try {
              const cookieStore = await cookies();
              const trustCookie = cookieStore.get('mfa_trust');
              if (trustCookie?.value) {
                const isTrusted = await validateTrustToken(trustCookie.value, user.id);
                if (isTrusted) {
                  // Trusted device — skip MFA
                  return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    image: user.image,
                  };
                }
              }
            } catch {
              // cookies() may fail in some contexts; fall through to reject
            }
            return null;
          }

          // Rate limit: 5 MFA attempts per 10 minutes per email
          const otpLimit = checkRateLimit('otp-verify', email, 5, 10 * 60 * 1000);
          if (!otpLimit.allowed) {
            return null;
          }

          if (mfaMethod === 'totp') {
            // TOTP authenticator app verification
            if (!user.mfaSecret) {
              return null;
            }
            const decryptedSecret = decryptSecret(user.mfaSecret);
            if (!verifyTotpCode(mfaCode, decryptedSecret)) {
              return null;
            }
            resetRateLimit('otp-verify', email);
          } else {
            // Email OTP verification (existing behavior)
            const consumed = await prisma.emailToken.updateMany({
              where: {
                identifier: user.email.toLowerCase(),
                token: mfaCode,
                type: 'MFA_OTP',
                used: false,
                expires: { gt: new Date() },
              },
              data: { used: true },
            });

            if (consumed.count === 0) {
              return null;
            }

            resetRateLimit('otp-verify', email);
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.image,
        };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
      ? [
          MicrosoftEntraID({
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as any).role;
        token.iat = Math.floor(Date.now() / 1000);
        // Check if this login used a trusted device cookie
        try {
          const cookieStore = await cookies();
          const trustCookie = cookieStore.get('mfa_trust');
          token.trustedDevice = !!trustCookie?.value;
        } catch {
          token.trustedDevice = false;
        }
      }
      // If role is missing (OAuth sign-in or old token), fetch from DB
      if (token.id && !token.role) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }

      // Enforce 8-hour session for non-trusted devices
      if (!token.trustedDevice && token.iat) {
        const ageSeconds = Math.floor(Date.now() / 1000) - (token.iat as number);
        if (ageSeconds > 8 * 60 * 60) {
          session.user = undefined as any;
          return session;
        }
      }

      // Invalidate sessions issued before a password change
      if (token.id && token.iat) {
        const user = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { passwordChangedAt: true },
        });
        if (user?.passwordChangedAt) {
          const changedAtSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
          if ((token.iat as number) < changedAtSec) {
            // Token was issued before password change — invalidate
            session.user = undefined as any;
          }
        }
      }

      return session;
    },
  },
});

// Helper function to hash passwords
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Helper function to verify passwords
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// Re-export from client-safe module
export { validatePassword, type PasswordValidationResult } from '@/lib/utils/password';

// Role hierarchy: SUPER_ADMIN > ADMIN > STAFF > VIEWER > FLOW_USER
// FLOW_USER is intentionally ranked at 0 — they are *not* in the read-everything
// hierarchy. Their access is scoped explicitly per-feature (currently Flow only).
const ROLE_HIERARCHY: Record<UserRole, number> = {
  SUPER_ADMIN: 4,
  ADMIN: 3,
  STAFF: 2,
  VIEWER: 1,
  FLOW_USER: 0,
};

// Check if user has at least the required role
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

// Check if user is admin (ADMIN or SUPER_ADMIN)
export function isAdmin(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

// Check if user is super admin
export function isSuperAdmin(role: UserRole): boolean {
  return role === 'SUPER_ADMIN';
}

// Check if user can edit (Admin, Super Admin, or Staff)
export function canEdit(role: UserRole): boolean {
  return hasRole(role, 'STAFF');
}

// Check if user can only view (Viewer role)
export function isViewerOnly(role: UserRole): boolean {
  return role === 'VIEWER';
}

// Check if user is restricted to the Flow board (external collaborator role)
export function isFlowUser(role: UserRole): boolean {
  return role === 'FLOW_USER';
}
