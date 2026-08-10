function isDesktopExplorer() {
  return window.matchMedia("(min-width: 801px)").matches
}

function keepExplorerOpen() {
  if (!isDesktopExplorer()) return

  document.querySelectorAll(".explorer").forEach((explorer) => {
    explorer.classList.remove("collapsed")
    explorer.setAttribute("aria-expanded", "true")

    const content = explorer.querySelector(".explorer-content")
    content?.setAttribute("aria-expanded", "true")
  })

  document.documentElement.classList.remove("mobile-no-scroll")
}

function disableExplorerToggles() {
  if (!isDesktopExplorer()) return

  document.querySelectorAll(".explorer-toggle").forEach((button) => {
    button.setAttribute("aria-hidden", "true")
    button.setAttribute("tabindex", "-1")
  })
}

function setupMobileExplorerClose() {
  if (isDesktopExplorer()) return

  document.querySelectorAll(".explorer").forEach((explorer) => {
    const content = explorer.querySelector(".explorer-content")
    if (!content || content.querySelector(".explorer-close")) return

    const closeButton = document.createElement("button")
    closeButton.type = "button"
    closeButton.className = "explorer-close"
    closeButton.setAttribute("aria-label", "Close menu")
    closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`

    closeButton.addEventListener("click", () => {
      explorer.classList.add("collapsed")
      explorer.setAttribute("aria-expanded", "false")
      document.documentElement.classList.remove("mobile-no-scroll")
    })

    content.prepend(closeButton)
  })
}

function observeExplorer(explorer: Element) {
  if (!isDesktopExplorer()) return

  const el = explorer as HTMLElement
  if (el.dataset.alwaysOpenObs) return
  el.dataset.alwaysOpenObs = "1"

  new MutationObserver(() => {
    if (explorer.classList.contains("collapsed")) {
      keepExplorerOpen()
    }
  }).observe(explorer, { attributes: true, attributeFilter: ["class"] })
}

function setupExplorer() {
  keepExplorerOpen()
  disableExplorerToggles()
  setupMobileExplorerClose()
  document.querySelectorAll(".explorer").forEach(observeExplorer)
}

document.addEventListener("nav", setupExplorer)
document.addEventListener("render", setupExplorer)
document.addEventListener("DOMContentLoaded", setupExplorer)
window.addEventListener("resize", setupExplorer)

export {}
