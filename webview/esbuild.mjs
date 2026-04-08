import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  absWorkingDir: root,
  entryPoints: ["webview/src/main.tsx"],
  bundle: true,
  outfile: "media/index.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  jsx: "automatic",
  logLevel: "info",
  minify: !watch,
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
