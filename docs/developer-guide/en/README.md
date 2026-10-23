<!-- tykerf:header -->
&nbsp;

[<img src="../../../src/editor/public/brand/tykerf-logo-docs.svg" alt="TYKERF" height="22">](../../../README.md) › [Documentation](../../README.md) › **TYKERF developer guide**
<!-- /tykerf:header -->

# TYKERF developer guide

For people who work on TYKERF itself, extend it (components, layouts, moves, MCP tools, AI runners), or build on it. To *use* TYKERF, read the [user guide](../../user-guide/en/README.md).

**Where to start:**
- **To change TYKERF:** [Setup and tests](setup.md), then [Architecture](architecture.md) and [Following a change](following-a-change.md). After those, the other pages are reference: read the one for the part you're changing.
- **To add something** (a component, a layout, a move, a tool, a runner…): [Extending TYKERF](extending.md) has a recipe for each.
- **To use TYKERF from your own code** (scripts, your own agent, CI): [Building on TYKERF](building-on-tykerf.md).

| Guide | What it covers |
|---|---|
| [Setup and tests](setup.md) | Install, run, the test suites, the project layout, the rules every change follows, working with an AI coding assistant |
| [Architecture](architecture.md) | The core ideas (slicing tree, notation, moves, workspaces, history, scope, sites) and how the parts fit |
| [Following a change](following-a-change.md) | One change followed through the code: a click in the editor, the same change by Kaity, undo, rendering; and where to look when something misbehaves |
| [The editor](editor.md) | The HTTP server, page hosts, the browser client, the chooser, security |
| [The AI and MCP](ai-and-mcp.md) | The MCP tools, the scope, the AI runners (Claude Code, API, Gemini), the Claude Desktop extension |
| [Extending TYKERF](extending.md) | Step by step: a component, a layout, a theme preset, a move, an MCP tool, an AI runner, an editor operation, a translation |
| [Building on TYKERF](building-on-tykerf.md) | Using TYKERF from your own code: pages from a script, your own agent through MCP, checks in CI, and what is stable |
| [Writing the docs](documentation.md) | What goes where, which page to update for a change, the house style, headers and footers, screenshots and the demo video |

Other references:
- [docs/slicing-notation.md](../../slicing-notation.md): the formal definition of the notation; keep it in sync with the code.
- [CONTRIBUTING.md](../../../CONTRIBUTING.md): how to send a change.
- [SECURITY.md](../../../SECURITY.md): what TYKERF trusts.
- [DEPLOY.md](../../../DEPLOY.md): running TYKERF for others.
- [ROADMAP.md](../../../ROADMAP.md) and [docs/plans/](../../plans/): what comes next.
- [CLAUDE.md](../../../CLAUDE.md): a dense map of the code for AI coding assistants. It is also a quick reference for people.

<!-- tykerf:footer -->
---

[Setup and tests](setup.md) →

[TYKERF](../../../README.md) · [Documentation](../../README.md) · [GitHub](https://github.com/eonity-org/tykerf) · Apache-2.0 · an [eonity](https://eonity.org) project
<!-- /tykerf:footer -->
