import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/app.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  sourcemap: true,
});