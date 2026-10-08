import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import { prisma } from "@/db/client";
import { gymSettings } from "@/config/gym-settings";
import { PublicShell } from "@/components/public/public-shell";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find a gym", description: "Gyms on GymPulse: see plans and offers, book a free trial, or join online." };

/** Directory of gyms whose owners published their page and chose to be listed. */
export default async function Gyms({ searchParams }: PageProps<"/gyms">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const rows = await prisma.gym.findMany({
    where: {
      status: { in: ["TRIAL", "ACTIVE"] },
      settings: { path: ["publicPage", "enabled"], equals: true },
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
    // listInDirectory is filtered below: a missing key is SQL NULL, which a NOT(= false) filter would wrongly drop.
    take: 500,
    select: { name: true, slug: true, city: true, province: true, settings: true },
  });
  const gyms = rows.map((g) => ({ ...g, cfg: gymSettings(g.settings).publicPage })).filter((g) => g.cfg.listInDirectory);
  return (
    <PublicShell wide>
      <h1 className="display text-4xl font-extrabold">Find a gym</h1>
      <p className="mt-2 text-ink-3">See plans and offers, book a free trial, or join online.</p>
      <form className="mt-6 flex max-w-lg gap-2" role="search">
        <label htmlFor="gq" className="sr-only">Gym name or city</label>
        <Input id="gq" name="q" defaultValue={q} placeholder="Gym name or city, e.g. Pokhara" />
        <Button type="submit"><Search /> Search</Button>
      </form>
      {gyms.length === 0 ? (
        <p className="mt-10 text-ink-3">{q ? `No gyms match "${q}" yet.` : "No gyms are listed yet."}</p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gyms.map((g) => (
            <li key={g.slug}>
              <Link href={`/g/${g.slug}`} className="block h-full">
                <Card className="h-full transition-shadow hover:shadow-lift">
                  <CardBody>
                    <p className="display text-xl font-bold">{g.name}</p>
                    {g.city && <p className="mt-1 flex items-center gap-1 text-sm text-ink-3"><MapPin className="size-4" aria-hidden /> {g.city}{g.province ? `, ${g.province}` : ""}</p>}
                    {g.cfg.tagline && <p className="mt-2 text-sm text-ink-2">{g.cfg.tagline}</p>}
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PublicShell>
  );
}
