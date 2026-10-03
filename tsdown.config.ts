import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/app.ts",
  },
  outDir: "api",
  format: "esm",
  platform: "node",
  sourcemap: true,
});