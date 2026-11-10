import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Botón píldora de la marca (CLAUDE.md §8.4). Se puede aplicar también a `<Link>` con `buttonVariants`. */
export const buttonVariants = cva(
  [
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-heading font-bold",
    "transition-[transform,box-shadow,background-color,border-color] duration-200",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-brand-gradient text-white shadow-[0_10px_24px_-8px_rgba(91,46,230,0.7)] hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-8px_rgba(91,46,230,0.85)]",
        secondary: "border-[1.5px] border-current/30 hover:border-current/60 hover:bg-current/10",
        light: "bg-white text-brand-violet hover:bg-brand-cream",
      },
      size: {
        sm: "min-h-11 px-5 py-2.5 text-sm",
        md: "min-h-12 px-6 py-3 text-base",
        lg: "min-h-14 px-8 py-4 text-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
