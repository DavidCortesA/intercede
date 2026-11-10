/** Iniciales para el avatar (hasta 2 letras). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]?.[0], words[1]?.[0]] : [Array.from(words[0] ?? "?").slice(0, 2).join("")];
  return letters.join("").toUpperCase();
}

const GRADIENTS = [
  "from-brand-violet to-[#8B5CF6]",
  "from-brand-blue to-brand-cyan",
  "from-brand-gold to-[#E9704B]",
  "from-[#0ea5a4] to-brand-blue",
  "from-[#7c3aed] to-[#db2777]",
] as const;

/** Degradado estable por persona (mismo id → mismo color). */
export function avatarGradient(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0];
}
