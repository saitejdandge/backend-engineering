import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(__dirname, "../../.obsidian/snippets/tdd-newspaper.css")
const target = path.resolve(__dirname, "../quartz/styles/obsidian-snippet.scss")

const css = fs.readFileSync(source, "utf8")
const adapted = css
  .replace(/@import url\([^)]+\);\s*/g, "")
  .replace(/\.theme-light/g, ".theme-light, html:not([saved-theme=\"dark\"])")
  .replace(/\.theme-dark/g, ".theme-dark, html[saved-theme=\"dark\"]")

fs.writeFileSync(
  target,
  `/* Auto-synced from .obsidian/snippets/tdd-newspaper.css — do not edit by hand */\n${adapted}\n`,
)

console.log("Synced Obsidian snippet -> quartz/styles/obsidian-snippet.scss")
