import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    css: false,
    // Las pruebas de integración comparten una sola base local y varias llaman a funciones GLOBALES (process_scheduled_work,
    // rooms_over_limit): en paralelo se pisan entre sí. En serie son estables y siguen siendo rápidas.
    fileParallelism: false,
  },
});
