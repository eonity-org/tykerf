<!-- tykerf:header -->
[<img src="../../../src/editor/public/brand/tykerf-logo.svg" alt="TYKERF" height="20">](../../../README.md) › [Documentation](../../README.md) › **TYKERF developer guide**
<!-- /tykerf:header -->

# TYKERF developer guide

For people who work on TYKERF itself, extend it (components, layouts, moves, MCP tools, AI runners), or build on it. To *use* TYKERF, read the [user guide](../../user-guide/en/README.md).

| Guide | What it covers |
|---|---|
| [Setup and tests](setup.md) | Install, run, the test suites, the project layout, the rules every change follows |
| [Architecture](architecture.md) | The core ideas (slicing tree, notation, moves, workspaces, history, scope, sites) and how the parts fit |
| [The editor](editor.md) | The HTTP server, page hosts, the browser client, the chooser, security |
| [The AI and MCP](ai-and-mcp.md) | The MCP tools, the scope, the AI runners (Claude Code, API, Gemini), the Claude Desktop extension |
| [Extending TYKERF](extending.md) | Step by step: a component, a layout, a theme preset, a move, an MCP tool, an AI runner, an editor operation, a translation |

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
