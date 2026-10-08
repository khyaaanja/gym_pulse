"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { act, api } from "@/lib/client";

export function ImageUpload({ productId, kind = "PRODUCT_IMAGE" }: { productId?: string; kind?: "PRODUCT_IMAGE" | "LOGO" }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" aria-label="Upload image" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const form = new FormData();
        form.set("file", f);
        const r = await act(() => api<{ fileId: string }>(kind === "LOGO" ? "/api/gym/logo" : "/api/gym/images", { form }), kind === "LOGO" ? "Logo updated" : undefined);
        if (r && productId) await act(() => api(`/api/gym/products/${productId}`, { method: "PATCH", body: { imageFileId: r.fileId } }), "Image updated");
        router.refresh();
      }} />
      <Button size="sm" variant="ghost" onClick={() => input.current?.click()} aria-label={kind === "LOGO" ? "Upload logo" : "Upload image"}><ImagePlus /></Button>
    </>
  );
}
