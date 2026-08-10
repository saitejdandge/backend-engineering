import { Root } from "hast"
import { i18n } from "../i18n"
import { htmlToJsx } from "../util/jsx"
import { QuartzPluginData } from "../plugins/vfile"
import { FileTrieNode } from "../util/fileTrie"
import { BuildTimeTrieData } from "../util/ctx"
import { PageList, SortFn, byTitleAlphabetical } from "./PageList"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

type Options = {
  showFolderCount?: boolean
  showSubfolders?: boolean
  sort?: SortFn
}

function pagesFromTrie(folder: FileTrieNode<BuildTimeTrieData>, showSubfolders: boolean) {
  return folder.children
    .map((node) => {
      const nodeData = node.data
      if (nodeData) {
        if (nodeData.unlisted === true) return undefined
        return nodeData
      }
      if (node.isFolder && showSubfolders) {
        return {
          slug: node.slug,
          dates: mostRecentDatesFromChildren(node.children),
          frontmatter: { title: node.displayName, tags: [] },
        } satisfies QuartzPluginData
      }
      return undefined
    })
    .filter((page): page is QuartzPluginData => page !== undefined)
}

function pagesFromAllFiles(allFiles: QuartzPluginData[], folderSlug: string, showSubfolders: boolean) {
  const folderPrefix = folderSlug.endsWith("/index")
    ? folderSlug.slice(0, -"index".length)
    : folderSlug.endsWith("/")
      ? folderSlug
      : folderSlug + "/"

  const directChildren: QuartzPluginData[] = []
  const subfolderFiles = new Map<string, QuartzPluginData[]>()

  for (const file of allFiles) {
    if (file.unlisted === true) continue
    const fileSlug = file.slug
    if (!fileSlug || !fileSlug.startsWith(folderPrefix)) continue

    const relativePath = fileSlug.slice(folderPrefix.length)
    if (!relativePath || relativePath === "index") continue

    const segments = relativePath.split("/")
    if (segments.length === 1) {
      directChildren.push(file)
    } else if (showSubfolders) {
      const subfolderName = segments[0]!
      if (!subfolderFiles.has(subfolderName)) {
        subfolderFiles.set(subfolderName, [])
      }
      subfolderFiles.get(subfolderName)!.push(file)
    }
  }

  for (const [subfolderName, files] of subfolderFiles) {
    const indexFile = files.find((f) => f.slug === `${folderPrefix}${subfolderName}/index`)
    if (indexFile) continue
    directChildren.push({
      slug: `${folderPrefix}${subfolderName}/index`,
      dates: mostRecentDatesFromEntries(files),
      frontmatter: { title: subfolderName, tags: [] },
    } as QuartzPluginData)
  }

  return directChildren
}

function mostRecentDatesFromChildren(children: FileTrieNode<BuildTimeTrieData>["children"]) {
  let maybeDates: QuartzPluginData["dates"]
  for (const child of children) {
    const childDates = child.data?.dates
    if (!childDates) continue
    if (!maybeDates) {
      maybeDates = { ...childDates }
    } else {
      if (childDates.created > maybeDates.created) maybeDates.created = childDates.created
      if (childDates.modified > maybeDates.modified) maybeDates.modified = childDates.modified
      if (childDates.published > maybeDates.published) maybeDates.published = childDates.published
    }
  }
  return maybeDates ?? {
    created: new Date(),
    modified: new Date(),
    published: new Date(),
  }
}

function mostRecentDatesFromEntries(entries: QuartzPluginData[]) {
  let maybeDates: QuartzPluginData["dates"]
  for (const entry of entries) {
    if (!entry.dates) continue
    if (!maybeDates) {
      maybeDates = { ...entry.dates }
    } else {
      if (entry.dates.created > maybeDates.created) maybeDates.created = entry.dates.created
      if (entry.dates.modified > maybeDates.modified) maybeDates.modified = entry.dates.modified
      if (entry.dates.published > maybeDates.published) maybeDates.published = entry.dates.published
    }
  }
  return maybeDates ?? {
    created: new Date(),
    modified: new Date(),
    published: new Date(),
  }
}

export const FolderContent: QuartzComponentConstructor<Options> = (opts = {}) => {
  const options = { showFolderCount: true, showSubfolders: true, ...opts }

  const Component: QuartzComponent = (props: QuartzComponentProps) => {
    const { tree, fileData, allFiles, cfg, ctx } = props
    const slug = fileData?.slug
    if (!slug) return null

    const trie = ctx?.trie
    let allPagesInFolder: QuartzPluginData[]
    if (trie) {
      const folder = trie.findNode(slug.split("/"))
      if (!folder) return null
      allPagesInFolder = pagesFromTrie(folder, options.showSubfolders ?? true)
    } else {
      allPagesInFolder = pagesFromAllFiles(allFiles ?? [], slug, options.showSubfolders ?? true)
    }

    const cssClasses = fileData?.frontmatter?.cssclasses ?? []
    const classes = cssClasses.join(" ")
    const hastRoot = tree as Root
    const content =
      hastRoot.children.length === 0
        ? fileData?.description
        : htmlToJsx(fileData.filePath!, hastRoot)

    return (
      <div class="popover-hint">
        <article class={classes}>
          <div class="markdown-preview-view markdown-rendered">{content}</div>
        </article>
        {hastRoot.children.length === 0 && (
          <div class="page-listing">
            {options.showFolderCount && (
              <p>
                {i18n(cfg?.locale ?? "en-US").pages.folderContent.itemsUnderFolder({
                  count: allPagesInFolder.length,
                })}
              </p>
            )}
            <PageList
              {...props}
              sort={options.sort ?? byTitleAlphabetical()}
              allFiles={allPagesInFolder}
            />
          </div>
        )}
      </div>
    )
  }

  Component.css = PageList.css
  return Component
}
