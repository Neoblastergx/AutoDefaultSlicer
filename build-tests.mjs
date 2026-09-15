// Bundles the test suites. The powerbi-visuals-utils packages are ESM with
// extensionless imports, which only a bundler can resolve - the same reason the
// visual itself is built by webpack.
import { build } from "esbuild";

const common = {
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    resolveExtensions: [".ts", ".js", ".json"],
    external: ["jsdom"],
    logLevel: "warning"
};

for (const name of ["acceptance", "session", "dom"]) {
    await build({ ...common, entryPoints: [`tests/${name}.ts`], outfile: `.tmp/test/${name}.cjs` });
}
