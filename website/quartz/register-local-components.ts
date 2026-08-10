import { componentRegistry } from "./components/registry"
import { RelatedContent } from "./components/RelatedContent"
import { SidebarFooter } from "./components/SidebarFooter"

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

export function registerLocalComponents() {
  componentRegistry.register("related-content", RelatedContent, "local", relatedContentManifest)
  componentRegistry.register("RelatedContent", RelatedContent, "local", relatedContentManifest)
  componentRegistry.register("sidebar-footer", SidebarFooter, "local", sidebarFooterManifest)
  componentRegistry.register("SidebarFooter", SidebarFooter, "local", sidebarFooterManifest)
}
