import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEditor } from "@/lib/auth-utils";
import {
  storeUpload,
  UPLOAD_ENTITIES,
  UPLOAD_TYPES,
  uploadProblem,
  type UploadEntity,
  type UploadProblem,
} from "@/lib/documents/upload";

/**
 * Upload files to a record (see lib/documents/upload.ts). Multipart form data:
 * `entityType`, `entityId`, `documentType`, and one or more `file` parts.
 *
 * Each file is checked on its own, so one oversized scan doesn't reject the
 * three good files sent with it: the response lists what was stored and what
 * was refused, and why.
 */
export async function POST(request: NextRequest) {
  const auth = await requireEditor();
  if (!auth.authorized || !auth.userId) {
    return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Send the files as multipart form data." }, { status: 400 });
  }

  const entityType = String(form.get("entityType") ?? "") as UploadEntity;
  const entityId = String(form.get("entityId") ?? "");
  const documentType = String(form.get("documentType") ?? "");
  const entity = UPLOAD_ENTITIES[entityType];
  if (!entity) return NextResponse.json({ error: "Uploads aren't taken for that kind of record." }, { status: 400 });
  if (!entityId || (await entity.exists(entityId)) === 0) {
    return NextResponse.json({ error: "That record doesn't exist." }, { status: 404 });
  }
  const type = UPLOAD_TYPES[entityType].find((option) => option.value === documentType);
  if (!type) return NextResponse.json({ error: "Choose what kind of document this is." }, { status: 400 });

  const files = form.getAll("file").filter((part): part is File => part instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const stored: { id: string; filename: string }[] = [];
  const refused: UploadProblem[] = [];
  for (const file of files) {
    const problem = uploadProblem(file);
    if (problem) {
      refused.push({ file: file.name, message: problem });
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    stored.push(
      await storeUpload({
        entityType,
        entityId,
        documentType: type.value,
        filename: file.name,
        bytes,
        userId: auth.userId,
      }),
    );
  }

  if (entityType === "LEASE") revalidatePath(`/dashboard/leases/${entityId}`);
  revalidatePath("/dashboard/settings/documents");
  return NextResponse.json({ stored, refused }, { status: stored.length ? 200 : 400 });
}
