# Metabase MCP Server

Complietly vibecoded a TypeScript/Node.js MCP (Model Context Protocol) server that wraps the Metabase REST API, giving AI agents (Claude Desktop, Claude Code) full programmatic access to a Metabase v0.59.x instance. Agents can execute queries, explore schemas, and build dashboards entirely through structured tool calls — no human click-through required.

## Prerequisites

- **Node.js 20 LTS** or later
- **Docker** (for running a local Metabase instance during development)
- A Metabase instance reachable over HTTP/HTTPS with an API key

## Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Build the server:**

   ```bash
   npm run build
   ```

   Compiled output is written to `dist/`. The entry point is `dist/index.js`.

3. **Configure environment variables** (copy `.env.example` and fill in values):

   ```bash
   cp .env.example .env
   ```

4. **(Optional) Start a local Metabase instance for development:**

   ```bash
   docker compose up -d
   ```

   Metabase is available at `http://localhost:3000` once healthy (allow ~2 minutes on first boot).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `METABASE_URL` | Yes | Base URL of your Metabase instance, e.g. `http://localhost:3000` |
| `METABASE_API_KEY` | Yes | API key created in Admin → Settings → Authentication → API Keys |

> **API Key Permissions:** The API key must belong to a Metabase group with sufficient permissions for the operations you need. For full agent access (read schema, execute queries, create/edit cards and dashboards), the key's group should have access to all relevant databases and admin capabilities. A key with only basic viewer permissions will return 403 errors on write operations.

## Adding to Claude Desktop

Add the following to your Claude Desktop MCP config file (typically `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "metabase": {
      "command": "node",
      "args": ["/absolute/path/to/metabase-mcp/dist/index.js"],
      "env": {
        "METABASE_URL": "http://localhost:3000",
        "METABASE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Replace `/absolute/path/to/metabase-mcp` with the actual path to this project.

## Adding to Claude Code

Add the same config to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "metabase": {
      "command": "node",
      "args": ["/absolute/path/to/metabase-mcp/dist/index.js"],
      "env": {
        "METABASE_URL": "http://localhost:3000",
        "METABASE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Verifying the Connection

Once added to Claude Desktop or Claude Code, ask the agent to call the `server_ping` tool:

> "Call the server_ping tool to verify the Metabase MCP server is running."

A successful response looks like:

```json
{"ok": true, "server": "metabase-mcp", "version": "0.1.0"}
```

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Lint
npm run lint

# Type check without building
npm run typecheck

# Build
npm run build

# Run server directly (requires env vars set)
npm start
```

## Architecture

- **`src/client.ts`** — `MetabaseClient` class (HTTP, `X-Api-Key` auth, typed errors) and `MetabaseApiError`
- **`src/index.ts`** — MCP server factory (`createServer()`), tool registrations, and stdio bootstrap
- **`src/types.ts`** — Hand-written TypeScript interfaces for Metabase API responses

All MCP server logging goes to **stderr** exclusively. `stdout` is reserved for the JSON-RPC protocol stream — any non-protocol bytes there would corrupt the MCP session.

## Metabase Version

This server targets **Metabase v0.59.x**. APIs introduced after this version are not used.
