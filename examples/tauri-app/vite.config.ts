import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The hooks package ships raw sources that use its internal "@/" alias.
    alias: { "@": path.resolve(__dirname, "../../react/src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
