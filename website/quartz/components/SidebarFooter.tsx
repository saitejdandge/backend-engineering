import { QuartzComponent, QuartzComponentConstructor } from "./types"

export const SidebarFooter: QuartzComponentConstructor = () => {
  const Component: QuartzComponent = ({ displayClass }) => {
    return (
      <div class={["sidebar-footer", displayClass].filter(Boolean).join(" ")}>
        <p>
          Curated by{" "}
          <a href="https://www.linkedin.com/in/saitejdandge/" target="_blank" rel="noopener noreferrer">
            Saitej Dandge
          </a>
        </p>
      </div>
    )
  }

  Component.css = `
.sidebar-footer {
  margin-top: auto;
  padding-top: 1.25rem;
  border-top: 1px solid var(--tdd-rule-hair);
  font-size: 0.9375rem;
  color: var(--tdd-accent);
  line-height: 1.5;
}
.sidebar-footer p {
  margin: 0;
}
.sidebar-footer a {
  color: var(--tdd-accent);
  font-weight: 700;
  text-decoration: none;
}
.sidebar-footer a:hover {
  color: var(--tdd-ink);
  opacity: 0.9;
}
`

  return Component
}
