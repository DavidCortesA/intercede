import { avatarGradient, initials } from "@/features/rooms/avatar";
import { cn } from "@/lib/utils";

/**
 * Avatar de una persona: su foto si la tiene (se copia del perfil al entrar a la sala) o sus
 * iniciales sobre un degradado estable. Decorativo: el nombre ya se lee en el texto de al lado.
 */
export function Avatar({ userId, name, src, className }: { userId: string; name: string; src?: string | null; className?: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- foto pequeña (256 px) de nuestro almacenamiento
      <img src={src} alt="" aria-hidden="true" width={96} height={96} loading="lazy" className={cn("size-10 shrink-0 rounded-full object-cover", className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br font-heading text-sm font-bold text-white",
        avatarGradient(userId),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
