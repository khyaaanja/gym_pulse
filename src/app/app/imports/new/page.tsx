import { requireStaff } from "@/lib/page-auth";
import { gymSettings } from "@/config/gym-settings";
import { PageHeader } from "@/components/ui/misc";
import { UploadZone } from "@/components/app/upload-zone";

export const metadata = { title: "Upload records" };

export default async function NewImport() {
  const ctx = await requireStaff("imports.create");
  const retention = gymSettings(ctx.gym.settings).imports.rawFileRetentionDays;
  const ocr = ctx.flags.ocr_import && (process.env.OCR_PROVIDER ?? "none") !== "none";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Upload your gym records" description="We'll read the file, show you what we found, and let you fix anything before it's imported." />
      <UploadZone ocrAvailable={ocr} maxMb={Number(process.env.MAX_UPLOAD_MB ?? 10)} />
      <section className="grid-cols-1 mt-8 grid gap-6 text-sm text-ink-2 sm:grid-cols-2">
        <div>
          <h2 className="font-semibold text-ink">What we look for</h2>
          <p className="mt-1">Member names, phone numbers, membership IDs, plans, expiry dates, visit dates or a day-by-day register, payments and amounts. Column names don&apos;t need to match anything — we&apos;ll suggest a mapping and you can change it. Bikram Sambat dates are converted automatically.</p>
        </div>
        <div>
          <h2 className="font-semibold text-ink">How your file is handled</h2>
          <p className="mt-1">It&apos;s encrypted and stored privately, used only to import your records and estimate member risk, and the original file is deleted after {retention} days (you can delete it sooner). Only staff with import access can see it, and every view is logged.</p>
        </div>
      </section>
    </div>
  );
}
