import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { ServerResponse, IncomingMessage } from "http";

const INVIDIOUS_INSTANCES = [
  "https://inv.thepixora.com",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "./dist",
  },
  server: {
    proxy: {
      "/inv": {
        target: INVIDIOUS_INSTANCES[0],
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/inv/, ""),
        configure: (proxy) => {
          let instanceIndex = 0;
          proxy.on("error", (err, _req, res) => {
            instanceIndex = (instanceIndex + 1) % INVIDIOUS_INSTANCES.length;
            const next = INVIDIOUS_INSTANCES[instanceIndex];
            console.warn(`[inv proxy] falló, rotando a: ${next} — ${err.message}`);
            // @ts-ignore
            proxy.options.target = next;
            const serverRes = res as ServerResponse<IncomingMessage>;
            if (serverRes && !serverRes.headersSent) {
              serverRes.writeHead(502, { "Content-Type": "application/json" });
              serverRes.end(JSON.stringify({ error: "Invidious proxy error, retrying..." }));
            }
          });
          proxy.on("proxyReq", (_proxyReq, req) => {
            console.debug(`[inv proxy] → ${INVIDIOUS_INSTANCES[instanceIndex]}${req.url}`);
          });
        },
      },
    },
    watch: {
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(
      "https://fitzxel-cl-api.vercel.app/v2",
    ),
    "import.meta.env.VITE_LAUNCHER_ID": JSON.stringify("modstack"),
    "import.meta.env.VITE_YOUTUBE_API_KEY": JSON.stringify(
      "AIzaSyBVAKbDz5fMbNJDxDBxFpxMj-AYJbwMnUg",
    ),
    "import.meta.env.VITE_MODSTACK_API_URL": JSON.stringify(
      "https://api.modstack.online",
    ),
  },
});