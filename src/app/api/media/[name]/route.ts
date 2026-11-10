import { NextRequest, NextResponse } from "next/server";
import { readImage } from "@/lib/image-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve an uploaded image by its generated name.
 *
 * Only the exact `[a-f0-9]{32}.{jpg|png|webp|gif}` shape is accepted, so path
 * traversal and arbitrary file reads are impossible. Content-Type comes from the
 * stored extension (validated at upload time by magic bytes), and `nosniff`
 * prevents the browser from reinterpreting the body.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const image = await readImage(name);
  if (!image) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  return new NextResponse(new Uint8Array(image.bytes), {
    status: 200,
    headers: {
      "Content-Type": image.type,
      "Content-Length": String(image.bytes.length),
      // Names are random and never reused, so the bytes are immutable.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
