import { QuartzComponent, QuartzComponentConstructor } from "./types"
import { QuartzPluginData } from "../plugins/vfile"
import { resolveRelative, simplifySlug } from "../util/path"

type Options = {
  hideWhenEmpty?: boolean
}

function pageTitle(file: QuartzPluginData): string {
  return file.frontmatter?.title ?? simplifySlug(file.slug ?? "")
}

function isTagSlug(slug: string): boolean {
  return slug.startsWith("tags/")
}

function selectRelatedFiles(allFiles: QuartzPluginData[], current: QuartzPluginData) {
  const currentSlug = simplifySlug(current.slug ?? "")
  const bySlug = new Map(
    allFiles
      .filter((file) => file.unlisted !== true && file.slug)
      .map((file) => [simplifySlug(file.slug!), file]),
  )

  const related = new Map<string, QuartzPluginData>()

  for (const linkSlug of current.links ?? []) {
    if (isTagSlug(linkSlug)) continue
    const file = bySlug.get(linkSlug)
    if (file && simplifySlug(file.slug!) !== currentSlug) {
      related.set(linkSlug, file)
    }
  }

  for (const file of allFiles) {
    if (file.unlisted === true || !file.slug) continue
    if (!file.links?.includes(currentSlug)) continue
    const slug = simplifySlug(file.slug)
    if (slug === currentSlug || isTagSlug(slug)) continue
    related.set(slug, file)
  }

  return [...related.values()].sort((a, b) =>
    pageTitle(a).localeCompare(pageTitle(b), undefined, { numeric: true, sensitivity: "base" }),
  )
}

function pageTags(fileData: QuartzPluginData): string[] {
  const raw = fileData.frontmatter?.tags
  if (!raw) return []
  return Array.isArray(raw) ? raw : [raw]
}

export const RelatedContent: QuartzComponentConstructor<Options> = (opts = {}) => {
  const options = { hideWhenEmpty: true, ...opts }

  const Component: QuartzComponent = ({ fileData, allFiles, displayClass }) => {
    const related = selectRelatedFiles(allFiles, fileData)
    const tags = pageTags(fileData)

    if (options.hideWhenEmpty && related.length === 0 && tags.length === 0) {
      return null
    }

    return (
      <div class={[displayClass, "related-content"].filter(Boolean).join(" ")}>
        <h3>Related</h3>
        {tags.length > 0 && (
          <ul class="tags">
            {tags.map((tag) => {
              const linkDest = resolveRelative(fileData.slug!, `tags/${tag}`)
              return (
                <li>
                  <a href={linkDest} class="internal tag-link">
                    {tag}
                  </a>
                </li>
              )
            })}
          </ul>
        )}
        {tags.length > 0 && related.length > 0 && <hr class="related-content-divider" />}
        {related.length > 0 && (
          <ul class="related-links">
            {related.map((file) => (
              <li>
                <a href={resolveRelative(fileData.slug!, file.slug!)} class="internal">
                  {pageTitle(file)}
                </a>
              </li>
            ))}
          </ul>
        )}
        <hr class="related-content-divider related-content-divider--bottom" />
      </div>
    )
  }

  Component.css = `
.related-content {
  flex-direction: column;
}
.related-content > h3 {
  font-size: 1rem;
  margin: 0;
}
.related-content > ul.related-links {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
}
.related-content > ul.related-links > li {
  margin: 0.15rem 0;
}
`

  return Component
}
