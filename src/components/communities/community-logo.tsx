import { Avatar } from "@/components/room/avatar";
import { cn } from "@/lib/utils";

/** Logo de la comunidad: su imagen o las iniciales de su nombre sobre un degradado estable. */
export function CommunityLogo({ id, name, src, className }: { id: string; name: string; src?: string | null; className?: string }) {
  return <Avatar userId={id} name={name} src={src} className={cn("size-14 rounded-2xl text-lg", className)} />;
}
