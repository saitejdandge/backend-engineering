import { registerLocalComponents } from "./quartz/register-local-components.ts"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"

registerLocalComponents()

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
