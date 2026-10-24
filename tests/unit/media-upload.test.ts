import { describe, expect, it } from "vitest";
import { isMediaPath, mediaUrl, MAX_UPLOAD_BYTES } from "@/lib/media-path";
import { detectImageType, contentTypeForMediaName, isSafeMediaName, uploadDir } from "@/lib/image-upload";
import { productCreateSchema } from "@/lib/validate";

const name = "0123456789abcdef0123456789abcdef";

describe("uploaded image paths", () => {
  it("accepts a generated media path", () => {
    expect(isMediaPath(mediaUrl(`${name}.png`))).toBe(true);
  });

  it.each([
    "/api/media/../../etc/passwd",
    "/api/media/%2e%2e%2fetc%2fpasswd",
    "/api/media/abc.jpg",
    `/api/media/${name}.svg`,
    `/api/media/${name}.png?x=1`,
    `//api/media/${name}.png`,
    `https://evil.example/api/media/${name}.png`,
    "data:image/png;base64,AAAA",
  ])("rejects %s", (value) => {
    expect(isMediaPath(value)).toBe(false);
  });

  it("is accepted by the product schema alongside https URLs", () => {
    const base = { merchantId: "m1", name: "Paracetamol", category: "Pharmacy", price: 120000, stockQuantity: 5, branchId: "b1" };
    expect(productCreateSchema.safeParse({ ...base, imageUrl: mediaUrl(`${name}.jpg`) }).success).toBe(true);
    expect(productCreateSchema.safeParse({ ...base, imageUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("image type detection", () => {
  // detectImageType requires at least 12 bytes so a truncated header is never trusted.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

  it("identifies real image bytes", () => {
    expect(detectImageType(jpeg)).toBe("image/jpeg");
    expect(detectImageType(png)).toBe("image/png");
    expect(detectImageType(gif)).toBe("image/gif");
    expect(detectImageType(webp)).toBe("image/webp");
  });

  it("rejects SVG and scripts disguised as images", () => {
    expect(detectImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("MZ"))).toBeNull();
    expect(detectImageType(new Uint8Array([]))).toBeNull();
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("maps stored names back to a content type", () => {
    expect(contentTypeForMediaName(`${name}.jpg`)).toBe("image/jpeg");
    expect(contentTypeForMediaName(`${name}.webp`)).toBe("image/webp");
    expect(contentTypeForMediaName(`${name}.svg`)).toBeNull();
    expect(contentTypeForMediaName("../../etc/passwd")).toBeNull();
    expect(isSafeMediaName(`${name}.gif`)).toBe(true);
    expect(isSafeMediaName("../x.gif")).toBe(false);
  });

  it("keeps the byte cap at 5MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("upload directory configuration", () => {
  it("fails closed when LIVE_UPLOAD_DIR is unset or relative", () => {
    const previous = process.env.LIVE_UPLOAD_DIR;
    delete process.env.LIVE_UPLOAD_DIR;
    expect(uploadDir()).toBeNull();
    process.env.LIVE_UPLOAD_DIR = "uploads";
    expect(uploadDir()).toBeNull();
    process.env.LIVE_UPLOAD_DIR = "/tmp/live-uploads";
    expect(uploadDir()).toBe("/tmp/live-uploads");
    if (previous === undefined) delete process.env.LIVE_UPLOAD_DIR; else process.env.LIVE_UPLOAD_DIR = previous;
  });
});
