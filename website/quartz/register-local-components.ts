import { componentRegistry } from "./components/registry"
import { RelatedContent } from "./components/RelatedContent"
import { SidebarFooter } from "./components/SidebarFooter"
import { OverviewTitle } from "./components/OverviewTitle"

const relatedContentManifest = {
  name: "related-content",
  displayName: "Related Content",
  description: "Tags, linked notes, and backlinks for the current page",
  version: "1.0.0",
  defaultPosition: "right" as const,
  defaultPriority: 10,
}

const sidebarFooterManifest = {
  name: "sidebar-footer",
  displayName: "Sidebar Footer",
  description: "Attribution footer in the left sidebar",
  version: "1.0.0",
  defaultPosition: "left" as const,
  defaultPriority: 100,
}

const overviewTitleManifest = {
  name: "overview-title",
  displayName: "Overview Title",
  description: "Renders h1 titles on folder and home index pages",
  version: "1.0.0",
  defaultPosition: "beforeBody" as const,
  defaultPriority: 8,
}

export function registerLocalComponents() {
  componentRegistry.register("related-content", RelatedContent, "local", relatedContentManifest)
  componentRegistry.register("RelatedContent", RelatedContent, "local", relatedContentManifest)
  componentRegistry.register("sidebar-footer", SidebarFooter, "local", sidebarFooterManifest)
  componentRegistry.register("SidebarFooter", SidebarFooter, "local", sidebarFooterManifest)
  componentRegistry.register("overview-title", OverviewTitle, "local", overviewTitleManifest)
  componentRegistry.register("OverviewTitle", OverviewTitle, "local", overviewTitleManifest)
}
