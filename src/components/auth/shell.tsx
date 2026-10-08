import { Logo } from "@/components/brand/logo";
import { GymScene } from "@/components/three/gym-scene";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="grid place-items-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <Logo className="mb-10" />
          <h1 className="display text-3xl font-extrabold">{title}</h1>
          {subtitle && <p className="mt-2 text-ink-3">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-ink-3">{footer}</div>}
        </div>
      </div>
      <aside aria-label="About GymPulse" className="bg-dusk relative isolate m-3 hidden flex-col justify-between overflow-hidden rounded-[2rem] p-12 text-white lg:flex">
        <GymScene mode="panel" className="absolute inset-0 -z-10" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(10_8_18/0.8)_0%,transparent_40%,transparent_60%,rgb(10_8_18/0.8)_100%)]" />
        <p className="display max-w-md text-[40px] font-extrabold leading-[1.05]">Every morning: who to call, what&apos;s at stake, and who came back.</p>
        <p className="max-w-sm text-[15px] text-white/80">Built for gyms in Nepal. Payments by eSewa, Khalti or cash at the desk.</p>
      </aside>
    </main>
  );
}
