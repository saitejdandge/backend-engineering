let currentNavUrl: string | undefined

function normalizeSlug(slug: string): string {
  let normalized = slug.replace(/^\/+|\/+$/g, "")
  if (!normalized) return "index"
  return normalized
}

function getCurrentSlug(url?: string): string {
  if (url) return normalizeSlug(url.replace(/^\/+/, ""))

  const base = document.body?.dataset?.basepath ?? ""
  let path = window.location.pathname
  if (base && path.startsWith(base)) {
    path = path.slice(base.length)
  }
  return normalizeSlug(path)
}

function folderMatchesCurrent(folderPath: string, currentSlug: string): boolean {
  return normalizeSlug(folderPath) === currentSlug
}

function markFolderActive(url?: string) {
  const currentSlug = getCurrentSlug(url ?? currentNavUrl)

  document.querySelectorAll(".explorer").forEach((explorer) => {
    explorer.querySelectorAll(".folder-container").forEach((container) => {
      container.classList.remove("active", "is-active")
      container
        .querySelector("a.folder-button, button.folder-button")
        ?.classList.remove("active", "is-active")
    })

    explorer.querySelectorAll<HTMLElement>(".folder-container[data-folderpath]").forEach((container) => {
      const folderPath = container.dataset.folderpath
      if (!folderPath || !folderMatchesCurrent(folderPath, currentSlug)) return

      container.classList.add("active", "is-active")
    })
  })
}

function setupExplorerActiveObservers() {
  document.querySelectorAll(".explorer-ul").forEach((ul) => {
    const list = ul as HTMLElement
    if (list.dataset.folderActiveObs) return
    list.dataset.folderActiveObs = "1"
    new MutationObserver(() => markFolderActive()).observe(list, {
      childList: true,
      subtree: true,
    })
  })
  markFolderActive()
}

function onExplorerNav(event: Event) {
  currentNavUrl = (event as CustomEvent<{ url?: string }>).detail?.url
  setupExplorerActiveObservers()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => markFolderActive())
  })
}

document.addEventListener("nav", onExplorerNav)
document.addEventListener("render", onExplorerNav)
document.addEventListener("DOMContentLoaded", setupExplorerActiveObservers)

export {}
