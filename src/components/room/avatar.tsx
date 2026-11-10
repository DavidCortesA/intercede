import { avatarGradient, initials } from "@/features/rooms/avatar";
import { cn } from "@/lib/utils";

export function Avatar({ userId, name, className }: { userId: string; name: string; className?: string }) {
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
