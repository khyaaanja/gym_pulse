"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileSpreadsheet, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client";
import { cn } from "@/lib/utils";

const ACCEPT = ".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.heic";

export function UploadZone({ ocrAvailable, maxMb }: { ocrAvailable: boolean; maxMb: number }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upload(file: File) {
    if (file.size > maxMb * 1024 * 1024) return toast.error(`Files can be up to ${maxMb} MB.`);
    const isImage = /\.(jpe?g|png|heic)$/i.test(file.name);
    if (isImage && !ocrAvailable) return toast.error("OCR service unavailable. Please upload a spreadsheet instead.");
    setBusy(file.name);
    const form = new FormData();
    form.set("file", file);
    try {
      const r = await api<{ jobId: string }>("/api/gym/imports", { form });
      router.push(`/app/imports/${r.jobId}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Something went wrong while uploading your file.");
      setBusy(null);
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
      className={cn("rounded-[2rem] border-2 border-dashed bg-surface p-8 text-center transition-colors sm:p-12", drag ? "border-brand bg-brand-soft" : "border-line")}
    >
      <UploadCloud className="mx-auto size-10 text-brand" aria-hidden />
      <p className="display mt-4 text-2xl font-semibold">{busy ? `Uploading ${busy}…` : "Drop your file here"}</p>
      <p className="mt-1 text-sm text-ink-3">CSV, Excel (XLSX/XLS), PDF{ocrAvailable ? ", or a photo (JPG, PNG, HEIC)" : ""} · up to {maxMb} MB</p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Button size="lg" disabled={!!busy} onClick={() => fileInput.current?.click()}><FileSpreadsheet /> File upload</Button>
        {ocrAvailable ? (
          <Button size="lg" variant="secondary" disabled={!!busy} onClick={() => cameraInput.current?.click()}><Camera /> Take photo</Button>
        ) : (
          <p className="self-center text-sm text-ink-3">Photo import: OCR service unavailable</p>
        )}
      </div>
      <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      {ocrAvailable && <p className="mt-6 text-xs text-ink-3">Photo tips: lay the sheet flat, fill the frame, avoid shadows. We&apos;ll highlight anything we couldn&apos;t read clearly.</p>}
    </div>
  );
}
