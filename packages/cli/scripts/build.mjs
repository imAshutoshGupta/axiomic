// Builds the CLI into ONE file: dist/axiomic.js.
//
// Why bundle? @axiomic/shared is private and never published to npm, so the CLI can't list it
// as a dependency. esbuild copies the parts of it we use straight into the output file.
// The result needs nothing but Node itself: `dependencies` in package.json stays empty.
//
// Usage: node scripts/build.mjs [--outfile <path>]   (tests use --outfile to build into a temp folder)

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));

const { values } = parseArgs({ options: { outfile: { type: "string" } } });

await build({
  entryPoints: [join(packageDir, "src/main.ts")],
  outfile: values.outfile ?? join(packageDir, "dist/axiomic.js"),
  bundle: true, // pull @axiomic/shared (and our own files) into the output
  // Unused code stays out because packages/shared/package.json says "sideEffects": false: esbuild then drops
  // every shared module we don't actually use (e.g. the content-safety checks). Normal package resolution, so
  // importing another shared function later just works.
  platform: "node", // keep node:fs, node:path, ... as imports instead of bundling them
  target: "node22", // the oldest Node we support (engines in package.json)
  format: "esm",
  // The shebang lets the file run as a command: npm points the `axiomic` bin at it.
  banner: { js: "#!/usr/bin/env node" },
  // Bakes the version from package.json into the code, so `axiomic --version` needs no file reads.
  define: { __AXIOMIC_VERSION__: JSON.stringify(pkg.version) },
  // No minifying: the CLI source is meant to be auditable, even in its published form.
  minify: false,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});
