import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-utils";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/actions/audit";
import { MAX_UPLOAD_BYTES, storeOfferImage } from "@/lib/portal/images";

/**
 * Upload product images to a portal offer (Settings → Portal offers). Multipart:
 * `offerId`, optional `alt`, one or more `file` parts. A route rather than a
 * server action because an action's body is capped at 1 MB. Admin only, like
 * the rest of the offer. Each file is checked on its own and the response says
 * which were stored and which were refused, and why.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized || !auth.userId) {
    return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the images as multipart form data." }, { status: 400 });
  }
  const offerId = String(form.get("offerId") ?? "");
  const alt = String(form.get("alt") ?? "") || null;
  if (!offerId || !(await prisma.portalOffer.count({ where: { id: offerId } }))) {
    return NextResponse.json({ error: "That offer doesn't exist." }, { status: 404 });
  }
  const files = form.getAll("file").filter((part): part is File => part instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });

  const stored: string[] = [];
  const refused: { file: string; message: string }[] = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      refused.push({ file: file.name, message: "Images must be under 15 MB." });
      continue;
    }
    try {
      const { id } = await storeOfferImage({ offerId, bytes: Buffer.from(await file.arrayBuffer()), alt, userId: auth.userId });
      stored.push(id);
    } catch (error) {
      refused.push({ file: file.name, message: error instanceof Error ? error.message : "That image could not be stored." });
    }
  }
  if (stored.length) {
    await logAudit({
      action: "CREATE",
      entityType: "Portal",
      entityId: offerId,
      newValues: { kind: "portal_offer_images", images: stored },
      userId: auth.userId,
    });
  }
  revalidatePath("/dashboard", "layout");
  return NextResponse.json({ stored: stored.length, refused }, { status: stored.length ? 200 : 422 });
}
