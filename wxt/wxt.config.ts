import { defineConfig, type WxtViteConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "ClearWeb",
    description: "Make the web easier to read and understand with AI-powered summaries and chat",
    permissions: ["storage", "tabs", "activeTab"],
    host_permissions: [
      "<all_urls>",
      "https://translate.googleapis.com/*",
      "http://127.0.0.1/*",
      "http://localhost/*",
      "https://ieee-intuition-2026-production.up.railway.app/*",
    ],
  },
  vite: () =>
    ({
      plugins: [tailwindcss()],
    }) as WxtViteConfig,
});
