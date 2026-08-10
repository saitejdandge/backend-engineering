import { ArticleTitle } from "@quartz-community/article-title"
import { FullSlug } from "../util/path"
import { QuartzComponentConstructor, QuartzComponentProps } from "./types"

function isOverviewPage(slug: FullSlug | undefined): boolean {
  if (!slug) return false
  return slug === "index" || slug.endsWith("/index")
}

export const OverviewTitle: QuartzComponentConstructor = () => {
  const Title = ArticleTitle()

  const Component = (props: QuartzComponentProps) => {
    if (!isOverviewPage(props.fileData?.slug)) return null
    return Title(props)
  }

  Component.css = Title.css
  return Component
}
