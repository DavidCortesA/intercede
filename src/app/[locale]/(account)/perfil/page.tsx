import { Bell, Users } from "lucide-react";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AvatarUploader } from "@/components/account/avatar-uploader";
import { PasswordForm } from "@/components/account/password-form";
import { ProfileForm } from "@/components/account/profile-form";
import { BlockedList, type BlockedPerson } from "@/components/moderation/blocked-list";
import { DeleteAccountForm } from "@/components/moderation/delete-account-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/account-actions";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { requireSession } from "@/lib/auth-guard";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/perfil">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return pageMetadata({ locale, path: "/perfil", title: t("profileTitle"), description: t("description"), noindex: true });
}

function timeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export default async function ProfilePage({ params }: PageProps<"/[locale]/perfil">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Account");
  const session = await requireSession(locale, "/perfil");

  if (session.isAnonymous) {
    return (
      <div className="flex flex-col gap-6">
      <section className="flex flex-col items-start gap-4 rounded-3xl bg-background p-7 shadow-sm ring-1 ring-border">
        <h1 className="font-heading text-2xl font-extrabold text-balance">{t("guestTitle")}</h1>
        <p className="leading-relaxed text-muted-foreground">{t("guestBody")}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/registro" className={buttonVariants({ size: "md" })}>
            {t("createAccount")}
          </Link>
          <Link href="/entrar" className={buttonVariants({ size: "md", variant: "secondary" })}>
            {t("signIn")}
          </Link>
        </div>
      </section>
      <DeleteAccountForm needsPassword={false} isGuest />
      </div>
    );
  }

  // Personas bloqueadas (con su nombre si todavía compartimos comunidad o sala) y tipo de cuenta
  const supabase = await createClient();
  const [{ data: userData }, { data: blocks }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("blocks").select("blocked_id").order("created_at", { ascending: false }),
  ]);
  const blockedIds = (blocks ?? []).map((row) => row.blocked_id);
  const [{ data: fromCommunities }, { data: fromRooms }] = blockedIds.length
    ? await Promise.all([
        supabase.from("community_members").select("user_id, display_name, avatar_url").in("user_id", blockedIds),
        supabase.from("room_members").select("user_id, display_name, avatar_url").in("user_id", blockedIds),
      ])
    : [{ data: [] }, { data: [] }];
  const known = new Map([...(fromRooms ?? []), ...(fromCommunities ?? [])].map((row) => [row.user_id, row]));
  const blockedPeople: BlockedPerson[] = blockedIds.map((id) => ({ id, name: known.get(id)?.display_name ?? null, avatarUrl: known.get(id)?.avatar_url ?? null }));
  const hasPassword = Boolean(session.email) && (userData.user?.app_metadata?.providers ?? []).includes("email");

  const profile = session.profile;
  const name = profile?.display_name ?? "";

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-3xl font-extrabold">{t("title")}</h1>

      <div className="flex flex-col gap-6 rounded-3xl bg-background p-6 shadow-sm ring-1 ring-border">
        <AvatarUploader userId={session.userId} name={name || "?"} avatarUrl={profile?.avatar_url ?? null} />
        <ProfileForm defaultName={name} defaultTimezone={profile?.timezone ?? "UTC"} timezones={timeZones()} />
        <p className="text-sm">
          <span className="font-heading font-bold">{t("email")}: </span>
          <span className="text-muted-foreground">{session.email}</span>
        </p>
      </div>

      <Link
        href="/comunidades"
        className="flex items-center gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border transition-colors hover:ring-ring"
      >
        <Users className="size-6 shrink-0 text-primary-text" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block font-heading font-bold">{t("communitiesLink")}</span>
          <span className="block text-sm text-muted-foreground">{t("communitiesLinkHelp")}</span>
        </span>
      </Link>

      <Link
        href="/avisos"
        className="flex items-center gap-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-border transition-colors hover:ring-ring"
      >
        <Bell className="size-6 shrink-0 text-primary-text" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block font-heading font-bold">{t("notificationsLink")}</span>
          <span className="block text-sm text-muted-foreground">{t("notificationsLinkHelp")}</span>
        </span>
      </Link>

      <section aria-labelledby="password-title" className="flex flex-col gap-4 rounded-3xl bg-background p-6 shadow-sm ring-1 ring-border">
        <h2 id="password-title" className="font-heading text-lg font-extrabold">
          {t("password.title")}
        </h2>
        <PasswordForm variant="profile" />
      </section>

      <BlockedList initial={blockedPeople} />

      <DeleteAccountForm needsPassword={hasPassword} isGuest={false} />

      <form action={signOutAction}>
        <input type="hidden" name="locale" value={locale} />
        <Button type="submit" variant="secondary" size="md" className="w-full text-foreground">
          {t("signOut")}
        </Button>
      </form>
    </div>
  );
}
