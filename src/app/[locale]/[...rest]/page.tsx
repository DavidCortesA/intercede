import { notFound } from "next/navigation";

// Captura cualquier ruta inexistente dentro del locale para mostrar la 404 propia
// (src/app/[locale]/not-found.tsx) en lugar de la genérica de Next.
export default function CatchAll() {
  notFound();
}
