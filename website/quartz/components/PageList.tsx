import { FullSlug, isFolderPath, resolveRelative } from "../util/path"
import { QuartzPluginData } from "../plugins/vfile"
import { getDate } from "./Date"
import { QuartzComponent, QuartzComponentProps } from "./types"

export type SortFn = (f1: QuartzPluginData, f2: QuartzPluginData) => number

function pageTitle(page: QuartzPluginData): string {
  return page.frontmatter?.title ?? ""
}

function pageExcerpt(page: QuartzPluginData): string | undefined {
  const raw = page.description ?? page.frontmatter?.description
  if (!raw || typeof raw !== "string") return undefined
  const text = raw.trim()
  return text.length > 0 ? text : undefined
}

export function byDateAndAlphabetical(): SortFn {
  return (f1, f2) => {
    // Sort by date/alphabetical
    if (f1.dates && f2.dates) {
      // sort descending
      return getDate(f2)!.getTime() - getDate(f1)!.getTime()
    } else if (f1.dates && !f2.dates) {
      // prioritize files with dates
      return -1
    } else if (!f1.dates && f2.dates) {
      return 1
    }

    // otherwise, sort lexographically by title
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? ""
    const f2Title = f2.frontmatter?.title.toLowerCase() ?? ""
    return f1Title.localeCompare(f2Title)
  }
}

export function byTitleAlphabetical(): SortFn {
  return (f1, f2) => {
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? ""
    const f2Title = f2.frontmatter?.title.toLowerCase() ?? ""
    return f1Title.localeCompare(f2Title, undefined, { numeric: true, sensitivity: "base" })
  }
}

export function byDateAndAlphabeticalFolderFirst(): SortFn {
  return (f1, f2) => {
    // Sort folders first
    const f1IsFolder = isFolderPath(f1.slug ?? "")
    const f2IsFolder = isFolderPath(f2.slug ?? "")
    if (f1IsFolder && !f2IsFolder) return -1
    if (!f1IsFolder && f2IsFolder) return 1

    // If both are folders or both are files, sort by date/alphabetical
    if (f1.dates && f2.dates) {
      // sort descending
      return getDate(f2)!.getTime() - getDate(f1)!.getTime()
    } else if (f1.dates && !f2.dates) {
      // prioritize files with dates
      return -1
    } else if (!f1.dates && f2.dates) {
      return 1
    }

    // otherwise, sort lexographically by title
    const f1Title = f1.frontmatter?.title.toLowerCase() ?? ""
    const f2Title = f2.frontmatter?.title.toLowerCase() ?? ""
    return f1Title.localeCompare(f2Title)
  }
}

type Props = {
  limit?: number
  sort?: SortFn
} & QuartzComponentProps

export const PageList: QuartzComponent = ({ cfg, fileData, allFiles, limit, sort }: Props) => {
  const sorter = sort ?? byDateAndAlphabeticalFolderFirst()
  let list = allFiles.sort(sorter)
  if (limit) {
    list = list.slice(0, limit)
  }

  return (
    <ul class="section-ul">
      {list.map((page) => {
        const title = pageTitle(page)
        const excerpt = pageExcerpt(page)
        const tags = page.frontmatter?.tags ?? []

        return (
          <li class="section-li">
            <div class="section">
              <p class="section-entry">
                <a
                  href={resolveRelative(fileData.slug!, page.slug!)}
                  class="section-title internal internal-link"
                >
                  {title}
                </a>
                {excerpt && (
                  <>
                    <span class="section-sep" aria-hidden="true">
                      {" "}
                      —{" "}
                    </span>
                    <span class="section-excerpt">{excerpt}</span>
                  </>
                )}
              </p>
              {tags.length > 0 && (
                <ul class="tags">
                  {tags.map((tag) => (
                    <li>
                      <a
                        class="internal tag-link"
                        href={resolveRelative(fileData.slug!, `tags/${tag}` as FullSlug)}
                      >
                        {tag}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

PageList.css = `
.section-ul {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
}

.section-li {
  border-bottom: 1px solid var(--tdd-rule-hair);
  padding: 0.85rem 0;
}

.section-li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.section-li:first-child {
  padding-top: 0;
}

.section-entry {
  margin: 0;
  font-family: var(--tdd-font-body);
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--tdd-body);
}

.section-title {
  font-family: var(--tdd-font-display);
  font-weight: 600;
  color: var(--tdd-ink);
  text-decoration: none;
}

.section-title:hover {
  color: var(--tdd-accent);
  opacity: 0.9;
}

.section-sep {
  color: var(--tdd-muted);
}

.section-excerpt {
  color: var(--tdd-muted);
}

.section > .tags {
  margin: 0.45rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
`
