import type { ReactElement } from "react";

/** Render a react-pdf document to a Buffer, the way `actions/documents` does for POs. */
export async function renderPdf(doc: ReactElement): Promise<Buffer> {
  const { pdf } = await import("@react-pdf/renderer");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = await pdf(doc as any).toBuffer();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}
