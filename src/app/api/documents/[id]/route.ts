import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDocPath } from "@/lib/actions/documents";

/**
 * Serving a stored document.
 *
 * v2 had the whole documents layer ported — the `Document` model, the PDF
 * renderers, `saveDocument`, `getDocuments`, and the section component — and no
 * way to read a file back, so none of it was reachable and the section was
 * wired to nothing. This is the missing half.
 *
 * Session-gated rather than public. A signed quote carries a client's
 * signature, a name and a timestamp; the token that let them sign it is not a
 * licence for anyone holding a document id to read it back.
 *
 * A missing file is a 410 and never a 404, and the row is never deleted to
 * tidy it up: an unrecoverable document still carries its filename, its signer
 * and when they signed, and that audit trail is the part that matters most when
 * the file itself is gone.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const download = request.nextUrl.searchParams.get("download") === "1";
  const allowTrashed = request.nextUrl.searchParams.get("trash") === "1";

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (document.deletedAt && !allowTrashed) {
    return NextResponse.json(
      { error: "Document is in Trash", deletedAt: document.deletedAt },
      { status: 410 },
    );
  }

  let file: Buffer;
  try {
    file = await fs.readFile(await resolveDocPath(document.filePath));
  } catch {
    return NextResponse.json(
      {
        error: "File missing on disk",
        detail:
          "The file is no longer in this instance's document store. The record of it — filename, signer, timestamp — is kept.",
        filename: document.filename,
        signedBy: document.signedBy,
        signedAt: document.signedAt,
      },
      { status: 410 },
    );
  }

  const name = document.filename.replace(/"/g, "");
  const type = /\.pdf$/i.test(name)
    ? "application/pdf"
    : /\.jpe?g$/i.test(name)
      ? "image/jpeg"
      : /\.png$/i.test(name)
        ? "image/png"
        : "application/octet-stream";

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Content-Length": String(file.length),
      // Customer paperwork: never let a shared proxy hold a copy.
      "Cache-Control": "private, no-store",
    },
  });
}
