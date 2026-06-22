import type { TestProject } from "vitest/node";

const METABASE_URL = process.env.METABASE_URL ?? "http://localhost:3000";

/**
 * Poll /api/health until Metabase reports status "ok" or maxMs is exceeded.
 * Uses native fetch only — no additional dependencies.
 */
async function waitForMetabase(url: string, maxMs: number): Promise<void> {
  const start = Date.now();
  const healthUrl = `${url}/api/health`;
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        const body = (await res.json()) as { status: string };
        if (body.status === "ok") return;
      }
    } catch {
      // Not ready yet — fall through to sleep
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`Metabase did not become healthy within ${maxMs}ms`);
}

export async function setup(project: TestProject): Promise<void> {
  // Step 1: Wait for Metabase to be healthy
  await waitForMetabase(METABASE_URL, 180_000);
  console.error("[globalSetup] Metabase is healthy");

  // Step 2: Get setup token (unauthenticated)
  const propsRes = await fetch(`${METABASE_URL}/api/session/properties`);
  if (!propsRes.ok) {
    const text = await propsRes.text();
    throw new Error(
      `GET /api/session/properties failed: ${propsRes.status} ${text}`
    );
  }
  const props = (await propsRes.json()) as { "setup-token": string | null };
  const setupToken = props["setup-token"];
  console.error(
    `[globalSetup] setup-token: ${setupToken ? "present" : "null (already initialized)"}`
  );

  // Step 3: Handle already-initialized Metabase
  if (!setupToken) {
    const existingApiKey = process.env.METABASE_API_KEY;
    if (!existingApiKey) {
      throw new Error(
        "Metabase is already initialized but METABASE_API_KEY is not set. " +
          "Pass an existing API key via METABASE_API_KEY env var, or start a fresh container " +
          "with: docker compose down -v && docker compose up -d --wait"
      );
    }
    console.error(
      "[globalSetup] Reusing existing METABASE_API_KEY from environment"
    );
    project.provide("apiKey", existingApiKey);
    project.provide("baseUrl", METABASE_URL);
    return;
  }

  // Step 4: Complete setup wizard (POST /api/setup)
  const setupRes = await fetch(`${METABASE_URL}/api/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: setupToken,
      user: {
        email: "admin@test.example",
        first_name: "Test",
        last_name: "Admin",
        password: "TestPassword1!",
        site_name: "Integration Test",
      },
      prefs: {
        allow_tracking: false,
        site_name: "Integration Test",
      },
      // Omit the database field — use embedded H2 by default (Pitfall 4)
    }),
  });
  if (!setupRes.ok) {
    const text = await setupRes.text();
    console.error(`[globalSetup] POST /api/setup response body: ${text}`);
    throw new Error(`POST /api/setup failed: ${setupRes.status} ${text}`);
  }
  const setupBody = (await setupRes.json()) as Record<string, unknown>;
  console.error(
    `[globalSetup] POST /api/setup response: ${JSON.stringify(setupBody)}`
  );
  const sessionId = setupBody["id"] as string;
  if (!sessionId) {
    throw new Error(
      `POST /api/setup did not return an id. Full body: ${JSON.stringify(setupBody)}`
    );
  }
  console.error(`[globalSetup] Admin setup complete, sessionId acquired`);

  // Step 5: Create API key via session auth (POST /api/api-key)
  const apiKeyRes = await fetch(`${METABASE_URL}/api/api-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Metabase-Session": sessionId,
    },
    body: JSON.stringify({ name: "integration-test-key", group_id: 1 }),
  });
  if (!apiKeyRes.ok) {
    const text = await apiKeyRes.text();
    console.error(
      `[globalSetup] POST /api/api-key response body: ${text}`
    );
    throw new Error(`POST /api/api-key failed: ${apiKeyRes.status} ${text}`);
  }
  const apiKeyBody = (await apiKeyRes.json()) as Record<string, unknown>;
  console.error(
    `[globalSetup] POST /api/api-key response fields: ${Object.keys(apiKeyBody).join(", ")}`
  );
  // Resilient fallback across known field names (Pitfall 2 / A3)
  const apiKey =
    (apiKeyBody["unmasked_key"] as string | undefined) ??
    (apiKeyBody["key"] as string | undefined) ??
    (apiKeyBody["masked_key"] as string | undefined);
  if (!apiKey) {
    throw new Error(
      `POST /api/api-key response contained neither unmasked_key, key, nor masked_key. ` +
        `Full body: ${JSON.stringify(apiKeyBody)}`
    );
  }
  console.error(`[globalSetup] API key acquired`);

  // Step 6: Restore sample database (POST /api/database/sample_database)
  // Non-fatal — cold-start test can fall back to SELECT 1 (A4)
  let sampleDbId: number | null = null;
  const sampleDbRes = await fetch(`${METABASE_URL}/api/database/sample_database`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Metabase-Session": sessionId,
    },
  });
  if (!sampleDbRes.ok) {
    console.error(
      `[globalSetup] POST /api/database/sample_database failed: ${sampleDbRes.status} (non-fatal)`
    );
  } else {
    const sampleDbBody = (await sampleDbRes.json()) as Record<string, unknown>;
    sampleDbId = (sampleDbBody["id"] as number | undefined) ?? null;
    console.error(
      `[globalSetup] Sample database restored, id: ${sampleDbId}`
    );

    // Step 7: Poll for schema sync completion (Pitfall 7)
    if (sampleDbId !== null) {
      const metadataUrl = `${METABASE_URL}/api/database/${sampleDbId}/metadata`;
      let synced = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const metaRes = await fetch(metadataUrl, {
            headers: { "X-Metabase-Session": sessionId },
          });
          if (metaRes.ok) {
            const meta = (await metaRes.json()) as { tables?: unknown[] };
            if (Array.isArray(meta.tables) && meta.tables.length > 0) {
              synced = true;
              console.error(
                `[globalSetup] Sample DB schema synced (${meta.tables.length} tables) after ${attempt + 1} poll(s)`
              );
              break;
            }
          }
        } catch {
          // Poll failure is non-fatal
        }
        await new Promise((r) => setTimeout(r, 3_000));
      }
      if (!synced) {
        console.error(
          "[globalSetup] Sample DB schema sync timed out (non-fatal)"
        );
      }
    }
  }

  // Step 8: Provide credentials to test workers
  project.provide("apiKey", apiKey);
  project.provide("baseUrl", METABASE_URL);
  console.error("[globalSetup] Setup complete — apiKey and baseUrl provided");
}

export async function teardown(): Promise<void> {
  // Docker container lifecycle is managed externally:
  // CI: docker compose down -v
  // Local: docker compose down (or keep running for subsequent dev runs)
  console.error("[globalSetup] teardown: no-op (Docker lifecycle is external)");
}
