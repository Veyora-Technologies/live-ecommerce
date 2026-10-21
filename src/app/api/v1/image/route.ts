import { NextRequest, NextResponse } from "next/server";

/**
 * Secure upload boundary for the future image-recognition adapter. Image data
 * is signature-checked, processed in memory, and discarded. No visual-matching
 * provider is currently wired, so this endpoint never guesses a product from a
 * filename or claims that image recognition occurred.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const SIGNATURES: { type: string; test: (b: Uint8Array) => boolean }[] = [
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { type: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/webp", test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 },
  { type: "image/gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
];

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("image") as File | null;
  if (!file) return NextResponse.json({ error: "Image file required (field: image)" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413 });
  if (file.size === 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = SIGNATURES.find((signature) => bytes.length >= 10 && signature.test(bytes));
  if (!detected) return NextResponse.json({ error: "Unsupported file: content is not a JPEG, PNG, WebP or GIF image.", candidates: [] }, { status: 415 });
  return NextResponse.json({
    configured: false,
    detectedType: detected.type,
    candidates: [],
    message: "Image upload passed the safety check, but visual product recognition is not implemented. No match was guessed. Try text, voice, or barcode search instead.",
  }, { headers: { "Cache-Control": "no-store" } });
}
