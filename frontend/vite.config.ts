import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 거의 모든 라우트가 물고 있는 핵심 벤더만 분리 — 배포마다 앱 코드는
        // 바뀌어도 이 청크들은 그대로라 매 배포 때 다시 안 받아도 됨(1y immutable
        // 캐시). jspdf/html2canvas/recharts/tiptap처럼 특정 lazy 페이지에서만
        // 쓰는 무거운 라이브러리는 건드리지 않음 — 이미 자기 청크로 잘 분리돼 있음.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("react-router")) return "vendor-react";
          if (id.includes("@tanstack/react-query")) return "vendor-query";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("lucide-react")) return "vendor-icons";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: "http://backend:8000",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
