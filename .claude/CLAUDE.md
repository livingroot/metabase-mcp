<!-- GSD:project-start source:PROJECT.md -->

## Project

**Metabase MCP Server**

A TypeScript/Node.js MCP (Model Context Protocol) server that wraps the Metabase REST API, giving AI agents (like Claude) full programmatic access to a Metabase v0.59.x instance. It enables agents to execute queries, explore data sources and schemas, and build and manage dashboards, charts, and datasets entirely through tool calls — no human click-through required.

**Core Value:** An AI agent can connect to any Metabase instance via API key and independently query data, explore schemas, and build complete dashboards with charts — all through structured MCP tool calls.

### Constraints

- **Tech stack**: TypeScript + Node.js — MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- **Metabase version**: v0.59.x — must not use APIs introduced after this version
- **Auth**: API key only (`METABASE_API_KEY` env var + `METABASE_URL` env var)
- **Testing**: Local Docker Metabase instance for integration testing

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### MCP Framework

### HTTP Client

- Injects `X-API-Key` header on every request
- Throws a typed `MetabaseApiError` on non-2xx responses (since fetch does not throw automatically)
- Has methods per API group: `databases`, `cards`, `dashboards`, `datasets`

### Build & Dev Tools

### Testing

## What NOT to Use

| Avoid | Reason |
|-------|--------|
| `@modelcontextprotocol/sdk` v2.x | Pre-alpha, unstable API, Q3 2026 target. Use v1.29.0. |
| `module: CommonJS` in tsconfig | MCP SDK is ESM. CommonJS causes `.js` import resolution failures. |
| `moduleResolution: Node` (old) | Does not handle `exports` field in package.json correctly. Use `NodeNext`. |
| `jest` as test runner | ESM support is painful. Requires `ts-jest` or babel transforms. Vitest handles ESM natively. |
| `got` HTTP client | Extra dependency, no advantage over native fetch for this use case. |
| esbuild/rollup bundler | Overkill for a stdio server process. tsc output is fine. |
| `console.log()` for logging | **Critical:** stdout is the JSON-RPC protocol channel in stdio transport. Any `console.log` corrupts the stream and breaks the client. Use `console.error()` exclusively. |
| Session token auth (`X-Metabase-Session`) | Tokens expire, require re-auth state management. API keys are stateless and preferred for agent use. |
| OpenAPI codegen for Metabase types | No official OpenAPI spec exists for Metabase. Hand-write TypeScript interfaces scoped to the endpoints actually used. |

## Metabase API Key Auth — Implementation Notes

- `METABASE_URL` — base URL, e.g. `http://localhost:3000`
- `METABASE_API_KEY` — the key created in Admin > Settings > Authentication > API Keys

## Metabase Type Coverage

## Confidence Levels

| Area | Confidence | Notes |
|------|------------|-------|
| MCP SDK version (1.29.0) | MEDIUM | Cross-checked npm page + GitHub — v1.29.0 confirmed as latest stable |
| tsconfig/package.json structure | MEDIUM | Consistent across multiple 2025-2026 tutorials and official docs |
| Node.js minimum (18, recommend 20) | MEDIUM | SDK package.json engines field confirmed >=18; 20 LTS is the safe production choice |
| Native fetch recommendation | MEDIUM | Multiple sources converge; consistent with Node 18+ baseline |
| Metabase X-API-Key header name | LOW | Fetched from Metabase docs page; header name casing may vary (HTTP is case-insensitive) |
| Metabase API key availability in v0.59 | MEDIUM | Introduced v0.47, cross-referenced in multiple sources |
| No official OpenAPI spec | MEDIUM | GitHub issue confirms; Metabase forum confirms |
| Vitest for testing | MEDIUM | Standard 2025 TypeScript ecosystem choice, multiple MCP testing guides confirm |
| InMemoryTransport test pattern | MEDIUM | Documented in MCP SDK and confirmed by multiple testing guides |
| stdout contamination pitfall | HIGH | Confirmed by MCP issues, official docs, multiple debugging guides |

## Sources

- [@modelcontextprotocol/sdk on GitHub](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP TypeScript SDK Docs — Server](https://ts.sdk.modelcontextprotocol.io/documents/server.html)
- [Build an MCP server — modelcontextprotocol.io](https://modelcontextprotocol.io/docs/develop/build-server)
- [Build MCP Servers in TypeScript — MCPcat guide](https://mcpcat.io/guides/building-mcp-server-typescript/)
- [TypeScript MCP E2E Testing Example — Creati.ai](https://creati.ai/mcp/mcp-server-e2e-testing-example/)
- [Unit Testing MCP Servers — MCPcat](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/)
- [Axios vs Fetch 2025 — LogRocket](https://blog.logrocket.com/axios-vs-fetch-2025/)
- [Metabase API Keys documentation](https://www.metabase.com/docs/latest/people-and-groups/api-keys)
- [Metabase Docker health check](https://www.metabase.com/docs/latest/installation-and-operation/running-metabase-on-docker)
- [stdout contamination issue — dirmacs/daedra](https://github.com/dirmacs/daedra/issues/4)
- [MCP stdio stdout corruption — claude-flow issue #835](https://github.com/ruvnet/claude-flow/issues/835)
- [OpenAPI spec request for Metabase — GitHub issue #27453](https://github.com/metabase/metabase/issues/27453)
- [OpenAPI/Swagger spec for Metabase — Discourse thread](https://discourse.metabase.com/t/openapi-swagger-spec-for-rest-api/4993)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
