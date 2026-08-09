// Dev convenience: `vite build` (produces dist-app/) then inlineBundle
// (makes it actually file://-loadable) — the same two steps `forge
// export` runs against a real project's generated dist-app/, just
// without a project to convert first (run scripts/generate-dev-fixture.mjs
// beforehand for that).
import { build } from "vite";
import { inlineBundle } from "./inline-bundle.mjs";

await build();
inlineBundle(new URL("../dist-app", import.meta.url).pathname);
console.log("build-app: dist-app/ is now a single, self-contained, file://-loadable index.html");
