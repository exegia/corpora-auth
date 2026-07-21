import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The UI kit ships raw sources that use its internal "@/" alias.
    alias: { "@": path.resolve(__dirname, "../../ui/src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
