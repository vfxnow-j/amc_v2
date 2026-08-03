import { NotificationBell } from "@/components/shell/notification-bell";
import { getUnreadCount } from "@/lib/queries/notifications";

/**
 * The bell's count, fetched server-side and handed to the client component.
 *
 * Its own file, and its own component, because the shell layout renders on
 * every authenticated route: awaited inline it would delay the rail — and so
 * the whole app — behind a notification count. The layout wraps this in a
 * Suspense boundary whose fallback is the same bell with no badge, so the rail
 * paints immediately and the number arrives when it arrives.
 *
 * The count itself is deliberately cheap: see `queries/notifications`.
 */
export async function NotificationBellSlot({ userId }: { userId: string }) {
  const count = await getUnreadCount(userId);
  return <NotificationBell count={count} />;
}
