import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Highlight } from "./highlight";
import { InstallButton } from "./install-button";
import { MountainScene } from "./mountain-scene";
import { RoomPreview } from "./room-preview";
import { Container } from "./section-heading";

export async function Hero() {
  const t = await getTranslations("Hero");

  return (
    <section className="dark relative isolate overflow-hidden bg-brand-dusk text-foreground">
      <MountainScene className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[46%] w-full" />

      <Container className="grid items-center gap-14 pb-56 pt-10 md:grid-cols-12 md:pb-64 md:pt-20">
        <div className="md:col-span-7">
          <p className="rise text-xs font-bold uppercase tracking-[0.32em] text-brand-lavender">{t("eyebrow")}</p>
          {/* El titular no se anima: es el elemento LCP y debe pintarse de inmediato. */}
          <h1 className="mt-6 font-heading text-[clamp(2.9rem,8.2vw,6rem)] font-extrabold leading-[0.97] text-balance">
            {t.rich("title", { hl: (chunks) => <Highlight>{chunks}</Highlight> })}
          </h1>
          <p
            className="rise mt-7 max-w-xl text-lg leading-relaxed text-brand-cream/85 sm:text-xl"
            style={{ "--delay": "0.18s" } as React.CSSProperties}
          >
            {t("subtitle")}
          </p>
          <div
            className="rise mt-9 flex flex-col gap-3 sm:flex-row"
            style={{ "--delay": "0.28s" } as React.CSSProperties}
          >
            <Link href="/orar" className={buttonVariants({ size: "lg" })}>
              {t("ctaPray")}
            </Link>
            <InstallButton />
          </div>
          <p className="rise mt-5 text-sm text-muted-foreground" style={{ "--delay": "0.36s" } as React.CSSProperties}>
            {t("note")}
          </p>
        </div>

        <div
          className="rise flex justify-center md:col-span-5 md:translate-y-10 md:justify-end md:[transform:translateY(2.5rem)_rotate(2deg)]"
          style={{ "--delay": "0.4s" } as React.CSSProperties}
        >
          <RoomPreview />
        </div>
      </Container>
    </section>
  );
}
