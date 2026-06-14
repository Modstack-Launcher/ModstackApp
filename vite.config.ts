import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const INVIDIOUS_INSTANCES = [
  "https://inv.thepixora.com",
  "https://inv.nadeko.net",
  "https://yt.chocolatemoo53.com",
  "https://invidious.tiekoetter.com",
  "https://invidious.f5.si",
];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "invidious-proxy",
      configureServer(server) {
        let idx = 0;

        server.middlewares.use("/inv", (req, res) => {
          const path = req.url || "/";
          console.log(`[inv] interceptado: ${path}`);
          let attempts = 0;

          function tryNext() {
            if (attempts >= INVIDIOUS_INSTANCES.length) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "All Invidious instances failed" }));
              return;
            }
            const target = INVIDIOUS_INSTANCES[idx];
            attempts++;
            console.debug(`[inv] → ${target}${path}`);
            fetch(`${target}${path}`)
              .then((response) => {
                if (!response.ok) {
                  console.warn(`[inv] ${target} → ${response.status}, rotando`);
                  idx = (idx + 1) % INVIDIOUS_INSTANCES.length;
                  tryNext();
                  return;
                }
                return response.arrayBuffer().then((body) => {
                  idx = INVIDIOUS_INSTANCES.indexOf(target);
                  const ct = response.headers.get("content-type") || "application/json";
                  res.writeHead(200, { "Content-Type": ct, "Access-Control-Allow-Origin": "*" });
                  res.end(Buffer.from(body));
                  console.debug(`[inv] ✓ ${target}${path}`);
                });
              })
              .catch((err) => {
                console.warn(`[inv] ${target} → error: ${err.message}, rotando`);
                idx = (idx + 1) % INVIDIOUS_INSTANCES.length;
                tryNext();
              });
          }

          tryNext();
        });
      },
    },
  ],
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
    "import.meta.env.VITE_API_URL": JSON.stringify("https://fitzxel-cl-api.vercel.app/v2"),
    "import.meta.env.VITE_LAUNCHER_ID": JSON.stringify("modstack"),
    "import.meta.env.VITE_YOUTUBE_API_KEY": JSON.stringify("AIzaSyBVAKbDz5fMbNJDxDBxFpxMj-AYJbwMnUg"),
    "import.meta.env.VITE_MODSTACK_API_URL": JSON.stringify("https://api.modstack.online"),
  },
});