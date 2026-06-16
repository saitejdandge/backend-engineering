# Navigating Ambiguity

## Why Ambiguity Tolerance is a Staff Skill

Senior engineers are given well-defined problems and expected to find good solutions. Staff engineers are given fuzzy problems — or they find the problems themselves — and must define the work before solving it.

> "The difference between a senior engineer and a staff engineer is often the ability to figure out what problem to solve."

Managers shouldn't have to fully specify technical problems for staff engineers. You're expected to intake vague direction and produce concrete, actionable plans.

---

## Breaking Down Fuzzy Problems

### The Five Clarifying Questions

When faced with ambiguity, these questions cut through it quickly:

1. **What does success look like?** (Outcome, not output)
2. **What's the timeline and why?** (Understand urgency vs. importance)
3. **What constraints are real vs. assumed?** (Many constraints are negotiable)
4. **Who are the stakeholders?** (Who must be satisfied, who must be consulted)
5. **What happens if we do nothing?** (Understand the cost of inaction)

### Disaggregating a Vague Request

Example: "We need to improve our platform's scalability."

This is not actionable. Disaggregate:
- What specific bottleneck are we hitting? (CPU? DB? Network? Deployment speed?)
- Which traffic patterns are we trying to handle? (Current peak? 3x? 10x?)
- What's the business driver? (Specific launch? Projected growth? Performance complaints?)
- What's the acceptable cost? (Engineering time? Infrastructure spend?)
- By when? (Hard deadline? Best effort?)

After these questions, "improve scalability" becomes "add read replicas to the orders DB to handle the Q4 campaign load at 3x current peak, by November 1."

---

## Mapping the Problem Space

Before proposing solutions, map what you know and don't know.

### Known vs Unknown Matrix

|  | Known | Unknown |
|---|---|---|
| **Known** | Facts we have | Questions we know to ask |
| **Unknown** | Blind spots | Unknown unknowns (scary) |

Staff engineers actively work to reduce unknown unknowns: through prototypes, spikes, stakeholder interviews, reviewing prior incidents, and reading relevant literature.

### Spike Work

A time-boxed investigation into an unknown. Not production code — throwaway code or research designed to answer a specific question.

"We don't know if Kafka will handle our throughput requirements. Let's run a 3-day spike with a realistic load test before we commit to this architecture."

Spikes reduce the cost of being wrong by surfacing risks early.

---

## Making Decisions Under Uncertainty

Not every decision can wait for full information. Staff engineers must make good decisions with incomplete data.

### Decision Frameworks

**Reversible vs Irreversible:**
- Reversible decisions: make them fast, learn, adjust
- Irreversible decisions: slow down, gather more information, involve more stakeholders

**Cost of delay vs cost of being wrong:**
- If the cost of delay exceeds the cost of being wrong, decide now
- If the cost of being wrong is catastrophic, wait for more information

**Two-way vs one-way door (Amazon):**
- One-way door: can't easily go back (DB migration, API breaking change). More scrutiny.
- Two-way door: can be undone (feature flag, config change). Decide and ship quickly.

### Communicating Decision Confidence

Be explicit about your confidence level:
- "I'm highly confident this is the right approach because we've done it before and have data."
- "I believe this is directionally right, but we have one unknown: whether the third-party API can handle our volume. I propose we proceed while running a capacity test in parallel."
- "I see three viable options. I lean toward Option B, but this is a judgment call and I'd like the team's input."

This honesty builds trust. People follow leaders who know what they don't know.

---

## When to Go Deep vs Delegate

One of the hardest judgment calls at the staff level.

### Go Deep When

- The problem requires your unique expertise or context
- The consequences of getting it wrong are severe
- Nobody else is positioned to understand the full picture
- It's a one-way door decision

### Delegate (with context) When

- A senior engineer on the team is well-positioned to solve it
- Your involvement would remove a growth opportunity from them
- Your time is better spent on something only you can do
- The risk is manageable and reversible

**The mistake:** Doing deep technical work on low-stakes problems because it's comfortable and fun, while high-stakes ambiguous problems go unaddressed because they're uncomfortable.

---

## Dealing with Organizational Resistance

Technical decisions often fail not because they're wrong, but because the organization doesn't adopt them.

### Why Good Ideas Get Rejected

- **Not understanding the problem.** Your audience doesn't share your context. Solution: explain the problem first, always.
- **Feeling excluded.** If people weren't consulted, they resist. Solution: involve them early, even informally.
- **Perceived as criticism.** "We should use an event-driven approach" feels like "your synchronous approach was wrong." Solution: frame as additive, not corrective.
- **Risk aversion.** Changing a working system is scary. Solution: propose an incremental path with clear off-ramps.
- **Competing priorities.** Your proposal adds work to teams already over-committed. Solution: explicitly address the ask and offer to share the load.

### Building a Coalition

For large changes, align key stakeholders before the public proposal:

1. Identify the people whose support you need (or whose opposition would kill it)
2. Have 1:1 conversations with them before the RFC is published
3. Understand their concerns and address them in the proposal
4. When the RFC is posted, they're already informed and aligned

This is not manipulation — it's reducing the cost of change by doing alignment work upfront rather than in a large combative meeting.

---

## Creating Clarity from Chaos

The most underrated staff skill: when everyone is confused and stressed, being the person who creates a clear picture of what's happening, what needs to happen, and who should do what.

**During incidents:** "Here's what we know. Here's what we're investigating. Here's what needs to happen in parallel. Alice is on DB, Bob is on the API layer, I'll coordinate."

**During planning:** "We have 6 things labeled as P0. They can't all be P0. Let me help us understand which ones we can defer or descope."

**During design debates:** "We've been discussing this for 45 minutes. Here's where I think we agree, here's where we disagree, and here's the specific question we need to answer to resolve it."

This clarity is worth more than any line of code you could write.
