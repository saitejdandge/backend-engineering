import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"
import { globby } from "globby"

const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
const websiteDir = path.resolve(scriptsDir, "..")
const publicDir = path.join(websiteDir, "public")
const contentDir = path.resolve(websiteDir, "..")

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

/**
 * Section index pages (e.g. Staff Engineer/index.md) must qualify subfolder wikilinks
 * with the parent folder path or Quartz resolves them from the vault root.
 */
export function findRiskySectionIndexWikilinks(
  markdown: string,
  filePath: string,
  vaultRoot: string,
): string[] {
  if (!/^[^/]+\/index\.md$/.test(filePath)) {
    return []
  }

  const issues: string[] = []
  const linkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
  const sectionDir = path.join(vaultRoot, path.dirname(filePath))

  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1].trim()
    if (target.endsWith("/index")) {
      issues.push(target)
      continue
    }
    if (target.includes("/")) {
      continue
    }

    const childDir = path.join(sectionDir, target)
    if (fs.existsSync(childDir) && fs.statSync(childDir).isDirectory()) {
      issues.push(target)
    }
  }

  return issues
}

describe("content index wikilinks", () => {
  test("section index pages qualify subfolder wikilinks", async () => {
    const indexFiles = await globby("**/index.md", {
      cwd: contentDir,
      ignore: ["website/**", ".git/**", "node_modules/**"],
    })

    const failures: string[] = []

    for (const file of indexFiles) {
      const markdown = fs.readFileSync(path.join(contentDir, file), "utf8")
      const risky = findRiskySectionIndexWikilinks(markdown, file, contentDir)
      if (risky.length > 0) {
        failures.push(`${file}: ${risky.join(", ")}`)
      }
    }

    assert.equal(
      failures.length,
      0,
      `Unqualified subfolder wikilinks in section index pages:\n${failures.join("\n")}`,
    )
  })
})

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
})

describe("theme CSS", () => {
  test("compiled CSS uses page tone on html and canvas on body", () => {
    const cssFiles = fs.readdirSync(publicDir).filter((f) => f.startsWith("index-") && f.endsWith(".css"))
    assert.ok(cssFiles.length > 0, "Expected compiled index-*.css in public/")

    const css = fs.readFileSync(path.join(publicDir, cssFiles[0]!), "utf8")
    assert.match(css, /html:not\(\[saved-theme=dark\]\).*background-color:var\(--tdd-page\)/)
    assert.match(css, /--tdd-page:#ebe8e2/)
    assert.match(css, /--tdd-canvas:#f9f7f3/)
  })
})
