"use client";

import { useId, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES } from "@/lib/media-path";

type Props = {
  /** Merchant that owns the image; the server checks your role for it. */
  merchantId: string;
  /** Form field name submitted with the surrounding <form>. Defaults to imageUrl. */
  name?: string;
  label?: string;
  hint?: string;
};

const ACCEPTED = "image/jpeg,image/png,image/webp,image/gif";
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/**
 * Image picker with a live preview.
 *
 * The picture is uploaded to /api/uploads, which inspects the file's real bytes
 * (not the filename or the browser's declared type) and returns a same-origin
 * URL. That URL is what the surrounding form submits, so product records never
 * need to trust user-supplied markup.
 */
export default function ImageUploadField({ merchantId, name = "imageUrl", label = "Product image (optional)", hint }: Props) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_UPLOAD_BYTES) { setError(`This image is ${(file.size / (1024 * 1024)).toFixed(1)}MB. The limit is ${MAX_MB}MB.`); return; }
    const body = new FormData();
    body.append("merchantId", merchantId);
    body.append("file", file);
    setBusy(true);
    try {
      const response = await fetch("/api/uploads", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || "The image was not uploaded."); return; }
      setValue(data.url);
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase text-slate-500" htmlFor={inputId}>{label}</label>
      <input type="hidden" name={name} value={value} />
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          disabled={busy}
          onChange={(e) => void pick(e.target.files?.[0])}
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white disabled:opacity-50"
        />
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded images are served from our own immutable endpoint
          <img src={value} alt="Selected product" className="h-12 w-12 rounded-lg border border-slate-200 object-cover" />
        ) : null}
        {value ? (
          <button type="button" onClick={() => setValue("")} className="text-xs font-semibold text-slate-500 underline">Remove</button>
        ) : null}
      </div>
      {busy ? <p className="text-xs text-slate-500">Uploading…</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {!busy && !error ? (
        <p className="text-xs text-slate-500">
          {value ? "Uploaded. This picture will be saved with the product." : `JPEG, PNG, WebP or GIF up to ${MAX_MB}MB. The file's actual content is checked on the server.`}
        </p>
      ) : null}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
