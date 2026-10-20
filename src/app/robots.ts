import type { MetadataRoute } from "next";

// The signed-in app and the client portal stay out of every search index.
// Link-preview crawlers (iMessage, Slack, Teams, Discord, WhatsApp) fetch the
// page directly and do not consult this, so unfurls still work.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
