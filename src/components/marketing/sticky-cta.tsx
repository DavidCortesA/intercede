import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** CTA fija en móvil (checklist de conversión): siempre a un toque del pulgar. */
export async function StickyCta() {
  const t = await getTranslations("Nav");

  return (
    <div className="sticky-in pointer-events-none fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <Link href="/orar" className={cn(buttonVariants({ size: "lg" }), "pointer-events-auto w-full")}>
        {t("cta")}
      </Link>
    </div>
  );
}
