import { Graph as BaseGraphFactory, type GraphOptions } from "@quartz-community/graph"
import graphScript from "./scripts/graph.inline"

/** Graph view with always-visible node labels and highlighted current page node. */
export const Graph = (userOpts?: Partial<GraphOptions>) => {
  const GraphComponent = BaseGraphFactory(userOpts)
  GraphComponent.afterDOMLoaded = graphScript
  return GraphComponent
}
