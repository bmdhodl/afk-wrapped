// SVG -> PNG with the bundled font, so cards look the same on every machine.

import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const FONT_FILES = ["JetBrainsMono-Regular.ttf", "JetBrainsMono-Bold.ttf"].map((f) =>
  fileURLToPath(new URL(`../fonts/${f}`, import.meta.url)));

export function toPng(svg) {
  return new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "JetBrains Mono" },
  }).render().asPng();
}
