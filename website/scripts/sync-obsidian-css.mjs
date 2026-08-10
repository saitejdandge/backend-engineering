import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(__dirname, "../../.obsidian/snippets/tdd-newspaper.css")
const target = path.resolve(__dirname, "../quartz/styles/obsidian-snippet.scss")

const css = fs.readFileSync(source, "utf8")
let adapted = css
  .replace(/@import url\([^)]+\);\s*/g, "")
  .replace(/\.theme-light/g, ".theme-light, html:not([saved-theme=\"dark\"])")
  .replace(/\.theme-dark/g, ".theme-dark, html[saved-theme=\"dark\"]")

// Descendant selectors: ".theme-dark ::pseudo" must not become ".theme-dark, html[dark] ::pseudo"
adapted = adapted.replace(
  /\.theme-light, html:not\(\[saved-theme="dark"\]\) (::[\w-]+)/g,
  "html:not([saved-theme=\"dark\"]) $1",
)
adapted = adapted.replace(
  /\.theme-dark, html\[saved-theme="dark"\] (::[\w-]+)/g,
  'html[saved-theme="dark"] $1',
)

// Obsidian paints .theme-light with canvas bg; on Quartz that selector includes
// html and fights the page/canvas split (html = page, body = canvas).
adapted = adapted.replace(
  /(\.theme-light, html:not\(\[saved-theme="dark"\]\),\s*\n\.theme-dark, html\[saved-theme="dark"\]\s*\{[\s\S]*?)background-color:\s*var\(--tdd-canvas\);\s*\n/,
  "$1",
)

fs.writeFileSync(
  target,
  `/* Auto-synced from .obsidian/snippets/tdd-newspaper.css — do not edit by hand */\n${adapted}\n`,
)

console.log("Synced Obsidian snippet -> quartz/styles/obsidian-snippet.scss")
