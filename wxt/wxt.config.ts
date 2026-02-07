import { defineConfig, type WxtViteConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "ClearWeb",
    description: "Make the web easier to read and understand with AI-powered summaries and chat",
    permissions: ["storage", "tabs", "activeTab"],
  },
  vite: () =>
    ({
      plugins: [tailwindcss()],
    }) as WxtViteConfig,
});
