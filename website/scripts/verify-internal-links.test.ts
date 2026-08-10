import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"
import { globby } from "globby"

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const websiteDir = path.resolve(scriptsDir, "..")
const publicDir = path.join(websiteDir, "public")

/** Candidate public/ paths for a relative internal href. */
export function resolveInternalHrefCandidates(fromHtml: string, href: string): string[] {
  if (!href.startsWith(".")) {
    throw new Error(`Expected relative href, got ${href}`)
  }

  let dir = path.dirname(fromHtml.replace(/\\/g, "/"))
  let rest = href

  while (rest.startsWith("../")) {
    dir = path.dirname(dir)
    rest = rest.slice(3)
  }

  if (rest.startsWith("./")) {
    rest = rest.slice(2)
  }

  rest = rest.replace(/\/$/, "")
  const base = path.join(dir, rest).replace(/\\/g, "/")

  return [`${base}/index.html`, `${base}.html`]
}

export function internalHrefExists(fromHtml: string, href: string, htmlSet: Set<string>): boolean {
  return resolveInternalHrefCandidates(fromHtml, href).some((candidate) => htmlSet.has(candidate))
}

/** TOC links on a folder index should stay in-folder (./child), not escape via ../. */
export function findEscapingTocLinks(pageHtml: string, html: string): string[] {
  const folder = path.dirname(pageHtml.replace(/\\/g, "/"))
  if (folder === ".") {
    return []
  }

  const issues: string[] = []
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/)
  if (!articleMatch) {
    return issues
  }

  const linkPattern = /href="(\.\.?\/[^"#?]+)"[^>]*class="[^"]*internal/g
  for (const match of articleMatch[1].matchAll(linkPattern)) {
    const href = match[1]
    if (href.startsWith("../") && !href.startsWith(`../${folder}/`)) {
      const candidates = resolveInternalHrefCandidates(pageHtml, href)
      const staysInFolder = candidates.some((target) =>
        target.startsWith(`${folder}/`) || target === `${folder}/index.html`,
      )
      if (staysInFolder) {
        issues.push(`${href} should be ./… (escapes folder ${folder} unnecessarily)`)
      }
    }
    if (href.startsWith("../") && !href.includes(`${folder}/`)) {
      issues.push(`${href} escapes section folder ${folder}`)
    }
  }

  return issues
}

describe("built internal links", () => {
  test("all relative internal links resolve to existing HTML under public/", async () => {
    if (!fs.existsSync(publicDir)) {
      throw new Error("Run `npx quartz build` before link verification tests")
    }

    const htmlFiles = await globby("**/*.html", { cwd: publicDir })
    const htmlSet = new Set(htmlFiles.map((f) => f.replace(/\\/g, "/")))
    const linkPattern = /href="(\.\.?\/[^"#?]+)"[^>]*class="[^"]*internal/g

    const failures: string[] = []

    for (const page of htmlFiles) {
      const content = fs.readFileSync(path.join(publicDir, page), "utf8")
      for (const match of content.matchAll(linkPattern)) {
        const href = match[1]
        if (!internalHrefExists(page, href, htmlSet)) {
          const candidates = resolveInternalHrefCandidates(page, href)
          failures.push(`${page}: ${href} -> missing ${candidates.join(" or ")}`)
        }
      }
    }

    assert.equal(
      failures.length,
      0,
      `Broken internal links:\n${failures.slice(0, 20).join("\n")}${failures.length > 20 ? `\n...and ${failures.length - 20} more` : ""}`,
    )
  })

  test("section index TOC links use in-folder relative paths", async () => {
    if (!fs.existsSync(publicDir)) {
      throw new Error("Run `npx quartz build` before link verification tests")
    }

    const sectionIndexes = [
      "staff-engineer/index.html",
      "database-systems/index.html",
    ]
    const failures: string[] = []

    for (const page of sectionIndexes) {
      const html = fs.readFileSync(path.join(publicDir, page), "utf8")
      const issues = findEscapingTocLinks(page, html)
      failures.push(...issues.map((issue) => `${page}: ${issue}`))
    }

    assert.equal(
      failures.length,
      0,
      `TOC links escape their section folder:\n${failures.join("\n")}`,
    )
  })
})

describe("theme CSS", () => {
  test("compiled CSS uses page tone on html and canvas fills the viewport", () => {
    const cssFiles = fs.readdirSync(publicDir).filter((f) => f.startsWith("index-") && f.endsWith(".css"))
    assert.ok(cssFiles.length > 0, "Expected compiled index-*.css in public/")

    const css = fs.readFileSync(path.join(publicDir, cssFiles[0]!), "utf8")
    assert.match(css, /html:not\(\[saved-theme=dark\]\).*background-color:var\(--tdd-page\)/)
    assert.match(css, /min-height:100vh/)
    assert.match(css, /--tdd-page:#ebe8e2/)
    assert.match(css, /--tdd-canvas:#f9f7f3/)
  })
})
