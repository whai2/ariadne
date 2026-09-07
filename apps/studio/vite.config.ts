import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// UI는 `web/`에 산다. Bun 서버(src/)는 API만 맡고, 빌드 산출물(../dist)을 서빙한다.
// dev:ui(vite HMR)일 때는 /api 를 Bun 서버(:4111)로 프록시한다.
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:4111",
    },
  },
});
