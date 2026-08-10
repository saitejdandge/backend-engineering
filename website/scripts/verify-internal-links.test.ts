import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, test } from "node:test"
import { globby } from "globby"
import { emitShortPathRedirects } from "../scripts/emit-short-path-redirects.mjs"

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
  if (!rest) {
    return [dir ? `${dir}/index.html` : "index.html"]
  }

  const base = path.join(dir, rest).replace(/\\/g, "/")

  return [`${base}/index.html`, `${base}.html`]
}

export function internalHrefExists(fromHtml: string, href: string, htmlSet: Set<string>): boolean {
  return resolveInternalHrefCandidates(fromHtml, href).some((candidate) => htmlSet.has(candidate))
}

/** Section index pages must use vault-qualified wikilinks for subfolders. */
export function findUnqualifiedSectionIndexWikilinks(markdown: string, filePath: string): string[] {
  if (!/^[^/]+\/index\.md$/.test(filePath)) {
    return []
  }

  const issues: string[] = []
  const linkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
  const sectionDir = path.join(contentDir, path.dirname(filePath))

  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1].trim()
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
  test("section index pages qualify subfolder wikilinks with vault paths", async () => {
    const indexFiles = await globby("**/index.md", {
      cwd: contentDir,
      ignore: ["website/**", ".git/**", "node_modules/**"],
    })

    const failures: string[] = []
    for (const file of indexFiles) {
      const markdown = fs.readFileSync(path.join(contentDir, file), "utf8")
      const risky = findUnqualifiedSectionIndexWikilinks(markdown, file)
      if (risky.length > 0) {
        failures.push(`${file}: ${risky.join(", ")}`)
      }
    }

    assert.equal(
      failures.length,
      0,
      `Unqualified subfolder wikilinks in section indexes:\n${failures.join("\n")}`,
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

  test("staff-engineer index never emits collapsed ./api-design links", () => {
    const html = fs.readFileSync(path.join(publicDir, "staff-engineer/index.html"), "utf8")
    const article = html.match(/<article[\s\S]*?<\/article>/)?.[0] ?? ""
    assert.doesNotMatch(
      article,
      /href="\.\/api-design"/,
      "Collapsed api-design link would 404 at /staff-engineer/api-design",
    )
  })

  test("short-path redirect exists for staff-engineer/api-design", () => {
    const redirectPath = path.join(publicDir, "staff-engineer/api-design.html")
    assert.ok(fs.existsSync(redirectPath), "Expected redirect at staff-engineer/api-design.html")
    const html = fs.readFileSync(redirectPath, "utf8")
    assert.match(html, /01---system-design--and--architecture\/api-design/)
  })
})

describe("short-path redirects", () => {
  test("emitShortPathRedirects creates unique collapsed-path aliases", async () => {
    if (!fs.existsSync(publicDir)) {
      throw new Error("Run `npx quartz build` before redirect tests")
    }

    await emitShortPathRedirects({ publicDir })
    assert.ok(
      fs.existsSync(path.join(publicDir, "staff-engineer/api-design.html")),
      "api-design short path redirect missing",
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
  })
})
