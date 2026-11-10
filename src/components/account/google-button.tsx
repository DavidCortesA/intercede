import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { googleAction } from "@/features/auth/account-actions";
import { GOOGLE_AUTH_ENABLED } from "@/config/site";

/** "Continuar con Google": solo aparece si el proveedor está configurado (NEXT_PUBLIC_GOOGLE_AUTH=1). */
export async function GoogleButton() {
  if (!GOOGLE_AUTH_ENABLED) return null;
  const t = await getTranslations("Auth");
  const locale = await getLocale();

  return (
    <>
      <form action={googleAction}>
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" variant="secondary" size="md" className="w-full">
          {t("google.continue")}
        </Button>
      </form>
      <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">{t("or")}</p>
    </>
  );
}
