import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from the root of toronto.abdullahr.com.
export default defineConfig({
  plugins: [react()],
  base: "/",
});
