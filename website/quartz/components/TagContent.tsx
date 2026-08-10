import { Root } from "hast"
import { i18n } from "../i18n"
import { htmlToJsx } from "../util/jsx"
import { getAllSegmentPrefixes, resolveRelative, simplifySlug } from "../util/path"
import { QuartzPluginData } from "../plugins/vfile"
import { PageList, SortFn, byTitleAlphabetical } from "./PageList"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

type Options = {
  numPages?: number
  sort?: SortFn
}

function isListed(file: QuartzPluginData) {
  return file.unlisted !== true
}

export const TagContent: QuartzComponentConstructor<Options> = (opts = {}) => {
  const options = { numPages: 10, ...opts }

  const Component: QuartzComponent = (props: QuartzComponentProps) => {
    const { tree, fileData, allFiles, cfg } = props
    const slug = fileData.slug
    const locale = cfg?.locale ?? "en-US"

    if (!(slug?.startsWith("tags/") || slug === "tags")) {
      throw new Error(`Component "TagContent" tried to render a non-tag page: ${slug}`)
    }

    const tag = simplifySlug(slug.slice("tags/".length))
    const allPagesWithTag = (t: string) =>
      allFiles
        .filter(isListed)
        .filter((file) => (file.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes).includes(t))

    const hastRoot = tree as Root
    const content =
      hastRoot.children.length === 0 ? fileData.description : htmlToJsx(fileData.filePath!, hastRoot)
    const cssClasses = fileData.frontmatter?.cssclasses ?? []
    const classes = cssClasses.join(" ")
    const sort = options.sort ?? byTitleAlphabetical()

    if (tag === "/") {
      const tags = [
        ...new Set(
          allFiles
            .filter(isListed)
            .flatMap((data) => data.frontmatter?.tags ?? [])
            .flatMap(getAllSegmentPrefixes),
        ),
      ].sort((a, b) => a.localeCompare(b))

      const tagItemMap = new Map<string, QuartzPluginData[]>()
      for (const t of tags) {
        tagItemMap.set(t, allPagesWithTag(t))
      }

      return (
        <div class="popover-hint">
          <article class={classes}>
            <div class="markdown-preview-view markdown-rendered">
              <p>{content}</p>
            </div>
          </article>
          <p>{i18n(locale).pages.tagContent.totalTags({ count: tags.length })}</p>
          <div>
            {tags.map((t) => {
              const pages = tagItemMap.get(t) ?? []
              const contentPage = allFiles.find((file) => file.slug === `tags/${t}`)
              const root = contentPage?.htmlAst as Root | undefined
              const tagDesc =
                !root || root.children.length === 0
                  ? contentPage?.description
                  : contentPage?.filePath
                    ? htmlToJsx(contentPage.filePath, root)
                    : undefined
              const href = resolveRelative(slug, `/tags/${t}`)

              return (
                <div class="tag-section">
                  <h2>
                    <a class="internal tag-link" href={href}>
                      {t}
                    </a>
                  </h2>
                  {tagDesc && <p>{tagDesc}</p>}
                  <div class="page-listing">
                    <p>
                      {i18n(locale).pages.tagContent.itemsUnderTag({ count: pages.length })}
                      {pages.length > (options.numPages ?? 10) && (
                        <>
                          {" "}
                          <span>
                            {i18n(locale).pages.tagContent.showingFirst({
                              count: options.numPages ?? 10,
                            })}
                          </span>
                        </>
                      )}
                    </p>
                    <PageList {...props} allFiles={pages} limit={options.numPages} sort={sort} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    const pages = allPagesWithTag(tag)
    return (
      <div class="popover-hint">
        <article class={classes}>
          <div class="markdown-preview-view markdown-rendered">{content}</div>
        </article>
        <div class="page-listing">
          <p>{i18n(locale).pages.tagContent.itemsUnderTag({ count: pages.length })}</p>
          <PageList {...props} allFiles={pages} sort={sort} />
        </div>
      </div>
    )
  }

  Component.css = PageList.css
  return Component
}
