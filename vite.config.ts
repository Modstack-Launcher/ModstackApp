import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "./dist",
  },
  server: {
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(
      "https://fitzxel-cl-api.vercel.app/v2",
    ),
    "import.meta.env.VITE_LAUNCHER_ID": JSON.stringify("modstack"),
  },
});
