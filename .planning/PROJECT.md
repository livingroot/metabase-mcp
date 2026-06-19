# Metabase MCP Server

## What This Is

A TypeScript/Node.js MCP (Model Context Protocol) server that wraps the Metabase REST API, giving AI agents (like Claude) full programmatic access to a Metabase v0.59.x instance. It enables agents to execute queries, explore data sources and schemas, and build and manage dashboards, charts, and datasets entirely through tool calls — no human click-through required.

## Core Value

An AI agent can connect to any Metabase instance via API key and independently query data, explore schemas, and build complete dashboards with charts — all through structured MCP tool calls.

## Business Context

- **Customer**: AI agents and the developers who configure them to work with Metabase
- **Revenue model**: Internal/open-source tool
- **Success metric**: Agent can build a dashboard with filtered charts from a cold start using only MCP tools

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Agent can execute raw SQL against any connected data source
- [ ] Agent can run saved Metabase questions by ID or name
- [ ] Agent can list all data sources (databases) with connection metadata
- [ ] Agent can browse DB schemas: tables, columns, data types, display names/labels
- [ ] Agent can list, view, and search saved questions/cards
- [ ] Agent can create, update, and delete saved questions/cards (with filters)
- [ ] Agent can list, view, and search dashboards
- [ ] Agent can create dashboards from scratch
- [ ] Agent can add, remove, and reposition cards on a dashboard
- [ ] Agent can configure dashboard filters/parameters
- [ ] Agent can delete dashboards
- [ ] Server authenticates via API key (env var)
- [ ] Server is testable against a local Metabase instance running in Docker

### Out of Scope

- Username/password auth — API key is sufficient for agent use cases
- Metabase version upgrades — pinned to v0.59.x
- Metabase embedding/public sharing management — not needed for agent workflows
- User/permission management — out of agent scope

## Context

- Metabase version is **pinned to v0.59.x** — no upgrades possible. All API calls must be compatible with this version's REST API.
- Local Docker setup is available for testing.
- The MCP server communicates via the Model Context Protocol (stdio transport), making it usable by Claude Code, Claude Desktop, and other MCP-compatible AI agents.
- Metabase's REST API uses session tokens (obtained via `/api/session`) and supports API key auth via `X-Api-Key` header (available in v0.49+, confirmed present in v0.59.x).

## Constraints

- **Tech stack**: TypeScript + Node.js — MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- **Metabase version**: v0.59.x — must not use APIs introduced after this version
- **Auth**: API key only (`METABASE_API_KEY` env var + `METABASE_URL` env var)
- **Testing**: Local Docker Metabase instance for integration testing

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript/Node.js | Best MCP SDK support, easiest distribution | — Pending |
| API key auth only | Stateless, simple for AI agents, no session management | — Pending |
| Wrap REST API directly | v0.59.x is pinned — no room for SDK abstractions | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-20 after initialization*
