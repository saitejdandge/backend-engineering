import { StaticResources } from "../util/resources"
import { BuildCtx } from "../util/ctx"
// @ts-ignore — bundled inline script string
import mermaidScript from "../components/scripts/mermaid.inline"
// @ts-ignore — bundled inline script string
import explorerAlwaysOpenScript from "../components/scripts/explorer-always-open.inline"
// @ts-ignore — bundled inline script string
import explorerActiveScript from "../components/scripts/explorer-active.inline"

function isMermaidInlineScript(script: string | undefined): boolean {
  return !!script && script.includes("code.mermaid") && script.includes("mermaid.esm")
}

function isMermaidPluginCss(content: string | undefined): boolean {
  return !!content && content.includes("#mermaid-container") && content.includes(".expand-button")
}

export function getStaticResourcesFromPlugins(ctx: BuildCtx) {
  const staticResources: StaticResources = {
    css: [],
    js: [],
    additionalHead: [],
  }

  for (const transformer of [...ctx.cfg.plugins.transformers, ...ctx.cfg.plugins.emitters]) {
    const res = transformer.externalResources ? transformer.externalResources(ctx) : {}
    if (res?.js) {
      staticResources.js.push(...res.js)
    }
    if (res?.css) {
      staticResources.css.push(...res.css)
    }
    if (res?.additionalHead) {
      staticResources.additionalHead.push(...res.additionalHead)
    }
  }

  // Mermaid always uses the dark palette (diagrams sit on code-block background).
  for (const resource of staticResources.js) {
    if (resource.contentType === "inline" && isMermaidInlineScript(resource.script)) {
      resource.script = mermaidScript
      resource.moduleType = "module"
    }
  }

  // Drop plugin mermaid CSS — it loads after index.css and forces light modal controls.
  staticResources.css = staticResources.css.filter(
    (css) => !(css.inline && isMermaidPluginCss(css.content)),
  )

  staticResources.js.push({
    loadTime: "afterDOMReady",
    contentType: "inline",
    script: explorerAlwaysOpenScript,
  })

  staticResources.js.push({
    loadTime: "afterDOMReady",
    contentType: "inline",
    script: explorerActiveScript,
  })

  // if serving locally, listen for rebuilds and reload the page
  if (ctx.argv.serve) {
    const wsUrl = ctx.argv.remoteDevHost
      ? `wss://${ctx.argv.remoteDevHost}:${ctx.argv.wsPort}`
      : `ws://localhost:${ctx.argv.wsPort}`

    staticResources.js.push({
      loadTime: "afterDOMReady",
      contentType: "inline",
      script: `
        const socket = new WebSocket('${wsUrl}')
        // reload(true) ensures resources like images and scripts are fetched again in firefox
        socket.addEventListener('message', () => document.location.reload(true))
      `,
    })
  }

  return staticResources
}

export * from "./transformers"
export * from "./filters"
export * from "./emitters"
export * from "./types"
export * from "./config"
export * as PageTypes from "./pageTypes"
export * as PluginLoader from "./loader"
