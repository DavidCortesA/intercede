"use client";

import { Camera, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Avatar } from "@/components/room/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const SIZE = 256;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** Recorta al centro en cuadrado y reduce a 256 px (WEBP): la foto pesa poco y el origen se limpia. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("blob"))), "image/webp", 0.85));
}

/**
 * Foto de perfil. Se sube a `avatars/<id>/…` (la base solo deja escribir en la carpeta propia y
 * solo a cuentas) y el perfil guarda la URL pública, que además se copia a las salas al entrar.
 */
export function AvatarUploader({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl: string | null }) {
  const t = useTranslations("Account.avatar");
  const inputRef = useRef<HTMLInputElement>(null);
  const [supabase] = useState(() => createClient());
  const [current, setCurrent] = useState(avatarUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"invalid" | "failed" | null>(null);

  /** Borra los archivos anteriores de la carpeta, conservando `keep`. */
  async function cleanFolder(keep?: string) {
    const { data } = await supabase.storage.from("avatars").list(userId);
    const old = (data ?? []).map((file) => `${userId}/${file.name}`).filter((path) => path !== keep);
    if (old.length > 0) await supabase.storage.from("avatars").remove(old);
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > MAX_INPUT_BYTES) return setError("invalid");

    setBusy(true);
    setError(null);
    try {
      const blob = await toSquareWebp(file);
      const path = `${userId}/avatar-${Date.now()}.webp`;
      const upload = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/webp" });
      if (upload.error) throw upload.error;

      const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const update = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
      if (update.error) throw update.error;

      setCurrent(url);
      await cleanFolder(path);
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const update = await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
    if (update.error) setError("failed");
    else {
      setCurrent(null);
      await cleanFolder();
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="avatar-title" className="flex items-center gap-5">
      <Avatar userId={userId} name={name} src={current} className="size-20 text-2xl" />
      <div className="flex flex-col gap-2">
        <h2 id="avatar-title" className="font-heading text-sm font-bold">
          {t("title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className="sr-only" aria-label={t("change")} />
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Camera className="size-4" aria-hidden="true" />
            {busy ? t("uploading") : t("change")}
          </Button>
          {current ? (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={remove}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t("remove")}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("help")}</p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${error}`)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
