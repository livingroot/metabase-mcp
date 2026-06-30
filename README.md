# Metabase MCP Server

**Completely vibecoded** a TypeScript/Node.js MCP (Model Context Protocol) server that wraps the Metabase REST API, giving AI agents (Claude Desktop, Claude Code) full programmatic access to a Metabase v0.59.x instance. Agents can execute queries, explore schemas, and build dashboards entirely through structured tool calls — no human click-through required.

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

## Transports

The server supports two transport modes, selected via the `TRANSPORT` environment variable.

### stdio (default)

Used by Claude Desktop and Claude Code when running the server as a local process. The MCP protocol runs over stdin/stdout.

### HTTP (remote MCP)

Runs an HTTP server implementing the [MCP Streamable HTTP transport](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/#streamable-http). Each client authenticates with its own Metabase API key passed as a URL query parameter — there is no shared key on the server.

**Start the HTTP server:**

```bash
METABASE_URL=https://your-metabase.example.com \
TRANSPORT=http \
PORT=4000 \
node dist/index.js
```

**Connect from Claude Desktop / Claude Code (remote MCP):**

The API key is passed as a Bearer token in the `Authorization` header — not in the URL.

```json
{
  "mcpServers": {
    "metabase": {
      "url": "https://your-mcp-host:4000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_METABASE_API_KEY"
      }
    }
  }
}
```

**Docker (full stack):**

```bash
# Build and start Metabase + MCP server
docker compose up --build

# Or publish a multi-platform image to Docker Hub
make publish
```

The compose stack exposes the MCP server on port `4000`. Connect with `Authorization: Bearer <key>`.

**Curl smoke-test:**

```bash
curl -s -X POST http://localhost:4000/mcp \
  -H "Authorization: Bearer YOUR_METABASE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' \
  -D -
# Response headers will include: mcp-session-id: <uuid>
```

## Environment Variables

### stdio mode

| Variable | Required | Description |
|----------|----------|-------------|
| `METABASE_URL` | Yes | Base URL of your Metabase instance, e.g. `http://localhost:3000` |
| `METABASE_API_KEY` | Yes | API key created in Admin → Settings → Authentication → API Keys |

### HTTP mode

| Variable | Required | Description |
|----------|----------|-------------|
| `TRANSPORT` | Yes | Set to `http` to enable HTTP transport |
| `METABASE_URL` | Yes | Base URL of your Metabase instance (shared for all sessions) |
| `PORT` | No | Port to listen on (default: `4000`) |
| `HOST` | No | Host to bind to (default: `0.0.0.0`) |
| `METABASE_API_KEY` | — | **Not used in HTTP mode.** Each client passes `Authorization: Bearer <key>`. |

> **API Key Permissions:** The API key must belong to a Metabase group with sufficient permissions for the operations you need. For full agent access (read schema, execute queries, create/edit cards and dashboards), the key's group should have access to all relevant databases and admin capabilities. A key with only basic viewer permissions will return 403 errors on write operations.

## Adding to Claude Desktop (stdio)

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

## Adding to Claude Code (stdio)

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

Once connected, ask the agent to call the `server_ping` tool:

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

# Run server on stdio (requires env vars set)
npm start

# Run server on HTTP transport (port 4000)
npm run start:http
```

## Architecture

- **`src/client.ts`** — `MetabaseClient` class (HTTP, `X-Api-Key` auth, typed errors) and `MetabaseApiError`
- **`src/index.ts`** — MCP server factory (`createServer(credentials?)`), all tool registrations, stdio and HTTP bootstrap
- **`src/types.ts`** — Hand-written TypeScript interfaces for Metabase API responses

All MCP server logging goes to **stderr** exclusively. `stdout` is reserved for the JSON-RPC protocol stream — any non-protocol bytes there would corrupt the MCP session.

## Metabase Version

This server targets **Metabase v0.59.x**. APIs introduced after this version are not used.
