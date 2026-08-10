/**
 * Emits redirect pages for collapsed short paths like staff-engineer/api-design
 * -> staff-engineer/01---system-design--and--architecture/api-design
 *
 * Guards against broken bookmarks and relative-link resolution mistakes.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolveRelative } from "@quartz-community/utils"

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(scriptsDir, "..", "public")

function redirectHtml(title, redirectUrl) {
  return `<!DOCTYPE html>
<html lang="en-us">
<head>
<title>${title}</title>
<link rel="canonical" href="${redirectUrl}">
<meta name="robots" content="noindex">
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${redirectUrl}">
</head>
</html>
`
}

function slugFromHtmlPath(relPath) {
  const withoutExt = relPath.replace(/\.html$/, "")
  if (withoutExt.endsWith("/index")) {
    return withoutExt.slice(0, -"/index".length) + "/index"
  }
  return withoutExt
}

function shortPathForSlug(slug) {
  const parts = slug.replace(/\/index$/, "").split("/").filter(Boolean)
  if (parts.length < 3) {
    return null
  }
  return `${parts[0]}/${parts.at(-1)}`
}

async function collectPageSlugs() {
  const slugs = new Map()

  async function walk(dir, prefix = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel)
        continue
      }
      if (!entry.name.endsWith(".html") || entry.name === "404.html") {
        continue
      }
      const slug = slugFromHtmlPath(rel)
      slugs.set(slug, rel)
    }
  }

  await walk(publicDir)
  return slugs
}

export async function emitShortPathRedirects(options = {}) {
  const publicRoot = options.publicDir ?? publicDir
  const slugs = await collectPageSlugs()
  const shortToCanonical = new Map()

  for (const slug of slugs.keys()) {
    const short = shortPathForSlug(slug)
    if (!short || short === slug.replace(/\/index$/, "")) {
      continue
    }
    if (slugs.has(short) || slugs.has(`${short}/index`)) {
      continue
    }
    const existing = shortToCanonical.get(short)
    if (existing && existing !== slug) {
      shortToCanonical.delete(short)
      continue
    }
    shortToCanonical.set(short, slug)
  }

  let emitted = 0
  for (const [short, canonical] of shortToCanonical) {
    const outPath = path.join(publicRoot, `${short}.html`)
    try {
      await fs.access(outPath)
      continue
    } catch {
      // write redirect
    }

    const redirectUrl = resolveRelative(short, canonical)
    const title = path.basename(short)
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, redirectHtml(title, redirectUrl))
    emitted++
  }

  return { emitted, redirects: [...shortToCanonical.entries()] }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { emitted, redirects } = await emitShortPathRedirects()
  console.log(`Emitted ${emitted} short-path redirect(s)`)
  for (const [short, canonical] of redirects) {
    console.log(`  ${short} -> ${canonical}`)
  }
}
