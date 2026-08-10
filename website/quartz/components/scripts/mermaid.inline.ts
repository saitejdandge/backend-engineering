import { registerEscapeHandler, removeAllChildren } from "./util"

interface Position {
  x: number
  y: number
}

class DiagramPanZoom {
  private isDragging = false
  private startPan: Position = { x: 0, y: 0 }
  private currentPan: Position = { x: 0, y: 0 }
  private scale = 1
  private readonly MIN_SCALE = 0.5
  private readonly MAX_SCALE = 3

  cleanups: (() => void)[] = []

  private showingSource = false
  private svgSnapshot: SVGElement | null = null

  constructor(
    private container: HTMLElement,
    private content: HTMLElement,
    private sourceText?: string,
  ) {
    this.setupEventListeners()
    this.setupNavigationControls()
    this.resetTransform()
  }

  private setupEventListeners() {
    const mouseDownHandler = this.onMouseDown.bind(this)
    const mouseMoveHandler = this.onMouseMove.bind(this)
    const mouseUpHandler = this.onMouseUp.bind(this)

    const touchStartHandler = this.onTouchStart.bind(this)
    const touchMoveHandler = this.onTouchMove.bind(this)
    const touchEndHandler = this.onTouchEnd.bind(this)

    const resizeHandler = this.resetTransform.bind(this)

    this.container.addEventListener("mousedown", mouseDownHandler)
    document.addEventListener("mousemove", mouseMoveHandler)
    document.addEventListener("mouseup", mouseUpHandler)

    this.container.addEventListener("touchstart", touchStartHandler, { passive: false })
    document.addEventListener("touchmove", touchMoveHandler, { passive: false })
    document.addEventListener("touchend", touchEndHandler)

    window.addEventListener("resize", resizeHandler)

    this.cleanups.push(
      () => this.container.removeEventListener("mousedown", mouseDownHandler),
      () => document.removeEventListener("mousemove", mouseMoveHandler),
      () => document.removeEventListener("mouseup", mouseUpHandler),
      () => this.container.removeEventListener("touchstart", touchStartHandler),
      () => document.removeEventListener("touchmove", touchMoveHandler),
      () => document.removeEventListener("touchend", touchEndHandler),
      () => window.removeEventListener("resize", resizeHandler),
    )
  }

  cleanup() {
    for (const cleanup of this.cleanups) {
      cleanup()
    }
  }

  private sourceButton: HTMLButtonElement | null = null

  private setupNavigationControls() {
    const controls = document.createElement("div")
    controls.className = "mermaid-controls"

    if (this.sourceText) {
      this.sourceButton = this.createIconButton(
        MERMAID_CODE_ICON,
        "Show mermaid source",
        () => this.toggleSourceView(),
      )
      controls.appendChild(this.sourceButton)
      controls.appendChild(this.createDivider())
    }

    controls.appendChild(this.createIconButton(MERMAID_ZOOM_OUT_ICON, "Zoom out", () => this.zoom(-0.1)))
    controls.appendChild(
      this.createIconButton(MERMAID_RESET_ICON, "Reset view", () => this.resetTransform()),
    )
    controls.appendChild(this.createIconButton(MERMAID_ZOOM_IN_ICON, "Zoom in", () => this.zoom(0.1)))

    this.container.appendChild(controls)
  }

  private createDivider(): HTMLSpanElement {
    const divider = document.createElement("span")
    divider.className = "mermaid-control-divider"
    divider.setAttribute("aria-hidden", "true")
    return divider
  }

  private createIconButton(
    icon: string,
    ariaLabel: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "mermaid-control-button"
    button.setAttribute("aria-label", ariaLabel)
    button.innerHTML = icon
    button.addEventListener("click", onClick)
    window.addCleanup(() => button.removeEventListener("click", onClick))
    return button
  }

  private toggleSourceView() {
    if (!this.sourceText) return

    this.showingSource = !this.showingSource
    if (this.showingSource) {
      const svg = this.content.querySelector("svg")
      if (svg) this.svgSnapshot = svg.cloneNode(true) as SVGElement
      removeAllChildren(this.content)
      const pre = document.createElement("pre")
      pre.className = "mermaid-source-panel"
      pre.textContent = this.sourceText
      this.content.appendChild(pre)
      this.sourceButton?.classList.add("active")
      this.sourceButton?.setAttribute("aria-label", "Show diagram")
      return
    }

    removeAllChildren(this.content)
    if (this.svgSnapshot) {
      this.content.appendChild(this.svgSnapshot.cloneNode(true))
    }
    this.sourceButton?.classList.remove("active")
    this.sourceButton?.setAttribute("aria-label", "Show mermaid source")
    this.resetTransform()
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    this.isDragging = true
    this.startPan = { x: e.clientX - this.currentPan.x, y: e.clientY - this.currentPan.y }
    this.container.style.cursor = "grabbing"
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.isDragging) return
    e.preventDefault()

    this.currentPan = {
      x: e.clientX - this.startPan.x,
      y: e.clientY - this.startPan.y,
    }

    this.updateTransform()
  }

  private onMouseUp() {
    this.isDragging = false
    this.container.style.cursor = "grab"
  }

  private onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) return
    this.isDragging = true
    const touch = e.touches[0]
    this.startPan = { x: touch.clientX - this.currentPan.x, y: touch.clientY - this.currentPan.y }
  }

  private onTouchMove(e: TouchEvent) {
    if (!this.isDragging || e.touches.length !== 1) return
    e.preventDefault()

    const touch = e.touches[0]
    this.currentPan = {
      x: touch.clientX - this.startPan.x,
      y: touch.clientY - this.startPan.y,
    }

    this.updateTransform()
  }

  private onTouchEnd() {
    this.isDragging = false
  }

  private zoom(delta: number) {
    const newScale = Math.min(Math.max(this.scale + delta, this.MIN_SCALE), this.MAX_SCALE)

    const rect = this.content.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2

    const scaleDiff = newScale - this.scale
    this.currentPan.x -= centerX * scaleDiff
    this.currentPan.y -= centerY * scaleDiff

    this.scale = newScale
    this.updateTransform()
  }

  private updateTransform() {
    this.content.style.transform = `translate(${this.currentPan.x}px, ${this.currentPan.y}px) scale(${this.scale})`
  }

  private resetTransform() {
    const svg = this.content.querySelector("svg")
    if (!svg) return

    const rect = svg.getBoundingClientRect()
    const width = rect.width / this.scale
    const height = rect.height / this.scale

    this.scale = 1
    this.currentPan = {
      x: (this.container.clientWidth - width) / 2,
      y: (this.container.clientHeight - height) / 2,
    }
    this.updateTransform()
  }
}

function cssVar(name: string, fallback = ""): string {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

const MERMAID_CODE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M5.5 4.5 3 8l2.5 3.5M10.5 4.5 13 8l-2.5 3.5"/></svg>`

const MERMAID_ZOOM_IN_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 3.5v9M3.5 8h9"/></svg>`

const MERMAID_ZOOM_OUT_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M3.5 8h9"/></svg>`

const MERMAID_RESET_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M3.75 8a4.25 4.25 0 1 0 1.24-3.01M3.75 3.75V8H8"/></svg>`

function createMermaidCodeButton(): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "mermaid-code-button"
  button.setAttribute("aria-label", "Show mermaid source")
  button.innerHTML = MERMAID_CODE_ICON
  return button
}

function positionMermaidToolbar(
  pre: HTMLPreElement,
  clipboardBtn: HTMLButtonElement | null,
  toolbarButtons: HTMLButtonElement[],
) {
  for (const button of toolbarButtons) {
    pre.prepend(button)
  }

  const clipboardStyle = clipboardBtn ? window.getComputedStyle(clipboardBtn) : null
  const clipboardWidth = clipboardBtn
    ? clipboardBtn.offsetWidth +
      parseFloat(clipboardStyle?.marginLeft || "0") +
      parseFloat(clipboardStyle?.marginRight || "0")
    : 0

  let offset = clipboardWidth
  for (const button of toolbarButtons) {
    const style = window.getComputedStyle(button)
    offset +=
      button.offsetWidth +
      parseFloat(style.marginLeft || "0") +
      parseFloat(style.marginRight || "0")
    button.style.right = `${offset}px`
    offset += 4.8 // ~0.3rem gap between toolbar buttons
  }
}

/** Read fixed dark palette from CSS — same values for inline and expanded view. */
function mermaidThemeVariables() {
  const bg = cssVar("--mermaid-bg", "#1c1913")
  const surface = cssVar("--mermaid-surface", "#2a2724")
  const text = cssVar("--mermaid-text", "#d9d0bd")
  const accent = cssVar("--mermaid-accent", "#cc9a56")
  const accentSoft = cssVar("--mermaid-accent-soft", "rgba(204, 154, 86, 0.15)")

  return {
    fontFamily: cssVar("--tdd-font-mono", cssVar("--codeFont")),
    darkMode: true,
    background: bg,
    mainBkg: bg,
    secondBkg: bg,
    primaryColor: surface,
    primaryTextColor: text,
    primaryBorderColor: accent,
    lineColor: text,
    secondaryColor: accent,
    tertiaryColor: accent,
    clusterBkg: bg,
    edgeLabelBackground: accentSoft,
    titleColor: text,
    textColor: text,
    nodeBorder: accent,
    actorBorder: accent,
    actorBkg: surface,
    actorTextColor: text,
    actorLineColor: accent,
    signalColor: text,
    signalTextColor: text,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: accent,
    labelTextColor: text,
    loopTextColor: text,
    noteBkgColor: surface,
    noteTextColor: text,
    noteBorderColor: accent,
  }
}

let mermaidImport = undefined
document.addEventListener("nav", async () => {
  const center = document.querySelector(".center") as HTMLElement
  const nodes = center.querySelectorAll("code.mermaid") as NodeListOf<HTMLElement>
  if (nodes.length === 0) return

  mermaidImport ||= await import(
    // @ts-ignore
    "https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.0/mermaid.esm.min.mjs"
  )
  const mermaid = mermaidImport.default

  const textMapping: WeakMap<HTMLElement, string> = new WeakMap()
  for (const node of nodes) {
    textMapping.set(node, node.innerText)
  }

  async function renderMermaid() {
    for (const node of nodes) {
      node.removeAttribute("data-processed")
      const oldText = textMapping.get(node)
      if (oldText) {
        node.innerHTML = oldText
      }
    }

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      themeVariables: mermaidThemeVariables(),
    })

    await mermaid.run({ nodes })
  }

  await renderMermaid()
  document.addEventListener("themechange", renderMermaid)
  window.addCleanup(() => document.removeEventListener("themechange", renderMermaid))

  for (let i = 0; i < nodes.length; i++) {
    const codeBlock = nodes[i] as HTMLElement
    const pre = codeBlock.parentElement as HTMLPreElement
    const clipboardBtn = pre.querySelector(".clipboard-button") as HTMLButtonElement | null
    const expandBtn = pre.querySelector(".expand-button") as HTMLButtonElement
    const codeBtn = createMermaidCodeButton()

    positionMermaidToolbar(pre, clipboardBtn, [expandBtn, codeBtn])

    const popupContainer = pre.querySelector("#mermaid-container") as HTMLElement
    if (!popupContainer) return

    const sourceText = textMapping.get(codeBlock) ?? codeBlock.innerText
    let showingSource = false
    let panZoom: DiagramPanZoom | null = null

    async function toggleInlineSource() {
      showingSource = !showingSource
      if (showingSource) {
        codeBlock.dataset.view = "source"
        codeBlock.textContent = sourceText
        codeBtn.classList.add("active")
        codeBtn.setAttribute("aria-label", "Show diagram")
        expandBtn.style.display = "none"
        return
      }

      delete codeBlock.dataset.view
      codeBlock.innerHTML = sourceText
      codeBlock.removeAttribute("data-processed")
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "base",
        themeVariables: mermaidThemeVariables(),
      })
      await mermaid.run({ nodes: [codeBlock] })
      codeBtn.classList.remove("active")
      codeBtn.setAttribute("aria-label", "Show mermaid source")
      expandBtn.style.display = ""
    }

    function showMermaid() {
      if (showingSource) return

      const container = popupContainer.querySelector("#mermaid-space") as HTMLElement
      const content = popupContainer.querySelector(".mermaid-content") as HTMLElement
      if (!content) return
      removeAllChildren(content)

      const mermaidContent = codeBlock.querySelector("svg")!.cloneNode(true) as SVGElement
      content.appendChild(mermaidContent)

      popupContainer.classList.add("active")
      container.style.cursor = "grab"

      panZoom = new DiagramPanZoom(container, content, sourceText)
    }

    function hideMermaid() {
      popupContainer.classList.remove("active")
      panZoom?.cleanup()
      panZoom = null
    }

    const onToggleSource = () => {
      void toggleInlineSource()
    }

    codeBtn.addEventListener("click", onToggleSource)
    expandBtn.addEventListener("click", showMermaid)
    registerEscapeHandler(popupContainer, hideMermaid)

    window.addCleanup(() => {
      panZoom?.cleanup()
      codeBtn.removeEventListener("click", onToggleSource)
      expandBtn.removeEventListener("click", showMermaid)
    })
  }
})
