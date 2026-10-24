import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canCustomize, canEditInventory, merchantRole } from "@/lib/permissions";
import { MAX_UPLOAD_BYTES, detectImageType, storeImage, uploadConfigured } from "@/lib/image-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

/**
 * Upload a product or storefront image.
 *
 * Authorisation: a signed-in member of the target merchant who can either edit
 * inventory or customise the storefront. Identity documents, payment proofs and
 * verification evidence must never be sent here — there is no endpoint for them
 * by design.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, ...noStore });

  if (!uploadConfigured()) {
    return NextResponse.json({
      error: "Image uploads are not configured for this deployment.",
      code: "UPLOAD_NOT_CONFIGURED",
      detail: "Set LIVE_UPLOAD_DIR to a writable absolute directory. Multi-instance deployments need object storage instead.",
    }, { status: 503, ...noStore });
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413, ...noStore });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the image as multipart/form-data." }, { status: 400, ...noStore });

  const merchantId = String(form.get("merchantId") || "").trim();
  if (!merchantId || merchantId.length > 64) {
    return NextResponse.json({ error: "merchantId is required." }, { status: 400, ...noStore });
  }
  const role = await merchantRole(merchantId, user.id);
  if (!canEditInventory(role) && !canCustomize(role)) {
    return NextResponse.json({ error: "Forbidden — your role cannot upload images for this merchant." }, { status: 403, ...noStore });
  }

  const file = form.get("file") ?? form.get("image");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Attach an image in the 'file' field." }, { status: 400, ...noStore });
  if (file.size === 0) return NextResponse.json({ error: "The file is empty." }, { status: 400, ...noStore });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413, ...noStore });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!detectImageType(bytes)) {
    return NextResponse.json({
      error: "Unsupported file. Upload a JPEG, PNG, WebP or GIF image. The content is checked, not the filename or declared type.",
    }, { status: 415, ...noStore });
  }

  const stored = await storeImage(bytes);
  if (!stored) return NextResponse.json({ error: "The image could not be stored." }, { status: 500, ...noStore });

  return NextResponse.json({
    url: stored.url,
    type: stored.type,
    bytes: stored.bytes,
    note: "Public image URL for product or storefront use. Do not upload identity documents, payment proofs or verification evidence.",
  }, { status: 201, ...noStore });
}
