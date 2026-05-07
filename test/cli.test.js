import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "bin", "zazu.ts");
const runtime = process.env.ZAZU_CLI_RUNTIME || "bun";
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const cliVersion = packageJson.version;

test("login stores a masked API key and config commands can read and remove it", async () => {
  const configHome = await tempConfigHome();

  try {
    const login = await runCliWithInput(
      ["login", "--api-key-stdin", "--base-url", "https://api.example.test", "--pretty"],
      "sk_live_abcdefghijklmnopqrstuvwxyz1234567890\n",
      { configHome },
    );
    assert.deepEqual(JSON.parse(login.stdout), {
      ok: true,
      api_key: "sk_live_...7890",
      base_url: "https://api.example.test",
    });

    const config = JSON.parse(await readFile(path.join(configHome, "zazu", "config.json"), "utf8"));
    assert.equal(config.api_key, "sk_live_abcdefghijklmnopqrstuvwxyz1234567890");
    assert.equal(config.base_url, "https://api.example.test");

    const get = await runCli(["config", "get", "--pretty"], { configHome });
    assert.deepEqual(JSON.parse(get.stdout), {
      api_key: "sk_live_...7890",
      api_base: "https://api.example.test",
      api_version: null,
      config_path: path.join(configHome, "zazu", "config.json"),
    });

    const unset = await runCli(["logout", "--pretty"], { configHome });
    assert.deepEqual(JSON.parse(unset.stdout), { ok: true });

    const afterLogout = JSON.parse(
      await readFile(path.join(configHome, "zazu", "config.json"), "utf8"),
    );
    assert.equal(afterLogout.api_key, undefined);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("login still accepts --api-key for backwards compatibility", async () => {
  const configHome = await tempConfigHome();

  try {
    const login = await runCli(
      ["login", "--api-key", "sk_live_abcdefghijklmnopqrstuvwxyz1234567890", "--pretty"],
      { configHome },
    );
    assert.deepEqual(JSON.parse(login.stdout), {
      ok: true,
      api_key: "sk_live_...7890",
      base_url: "https://zazu.ma",
    });
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("resource help does not require authentication", async () => {
  const configHome = await tempConfigHome();

  try {
    await mkdir(path.join(configHome, "zazu"), { recursive: true });
    await writeFile(path.join(configHome, "zazu", "config.json"), "{not-json", "utf8");

    const result = await runCli(["invoices", "--help"], { configHome });
    assert.match(result.stdout, /Zazu CLI - invoices/);
    assert.match(result.stdout, /zazu invoices payment-link <id> --account-id <account-id>/);
    assert.doesNotMatch(result.stdout, /Global flags:/);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("version does not require readable config", async () => {
  const configHome = await tempConfigHome();

  try {
    await mkdir(path.join(configHome, "zazu"), { recursive: true });
    await writeFile(path.join(configHome, "zazu", "config.json"), "{not-json", "utf8");

    const result = await runCli(["--version"], { configHome });
    assert.equal(result.stdout, `${cliVersion}\n`);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("recovery commands tolerate a corrupt stored config", async () => {
  const configHome = await tempConfigHome();

  try {
    await mkdir(path.join(configHome, "zazu"), { recursive: true });
    await writeFile(path.join(configHome, "zazu", "config.json"), "{not-json", "utf8");

    const login = await runCliWithInput(
      ["login", "--api-key-stdin", "--base-url", "https://api.example.test", "--pretty"],
      "sk_live_abcdefghijklmnopqrstuvwxyz1234567890\n",
      { configHome },
    );
    assert.deepEqual(JSON.parse(login.stdout), {
      ok: true,
      api_key: "sk_live_...7890",
      base_url: "https://api.example.test",
    });

    const stored = JSON.parse(await readFile(path.join(configHome, "zazu", "config.json"), "utf8"));
    assert.equal(stored.api_key, "sk_live_abcdefghijklmnopqrstuvwxyz1234567890");
    assert.equal(stored.base_url, "https://api.example.test");
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("login validates API key shape before storing", async () => {
  const configHome = await tempConfigHome();

  try {
    const result = await runCli(["login", "--api-key", "not-a-key"], { configHome, reject: false });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /API key must start with sk_live_ or sk_test_/);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("login accepts test API keys", async () => {
  const configHome = await tempConfigHome();

  try {
    const login = await runCli(
      ["login", "--api-key", "sk_test_abcdefghijklmnopqrstuvwxyz1234567890", "--pretty"],
      { configHome },
    );
    assert.deepEqual(JSON.parse(login.stdout), {
      ok: true,
      api_key: "sk_test_...7890",
      base_url: "https://zazu.ma",
    });
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("missing non-boolean flag values return a clear error", async () => {
  const configHome = await tempConfigHome();

  try {
    const result = await runCli(["entity", "get", "--api-key"], { configHome, reject: false });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Missing value for --api-key/);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("config set supports api-base and api-version", async () => {
  const configHome = await tempConfigHome();

  try {
    const base = await runCli(["config", "set", "api-base", "https://api.zazu.test", "--pretty"], {
      configHome,
    });
    assert.deepEqual(JSON.parse(base.stdout), { ok: true, api_base: "https://api.zazu.test" });

    const version = await runCli(["config", "set", "api-version", "2026-04-29", "--pretty"], {
      configHome,
    });
    assert.deepEqual(JSON.parse(version.stdout), { ok: true, api_version: "2026-04-29" });

    const get = JSON.parse((await runCli(["config", "get", "--pretty"], { configHome })).stdout);
    assert.equal(get.api_base, "https://api.zazu.test");
    assert.equal(get.api_version, "2026-04-29");
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("missing API key returns a useful error", async () => {
  const configHome = await tempConfigHome();

  try {
    const result = await runCli(["entity", "get"], { configHome, reject: false });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Missing API key/);
    assert.match(result.stderr, /zazu login/);
  } finally {
    await rm(configHome, { recursive: true, force: true });
  }
});

test("top-level transactions list maps to account transactions endpoint", async () => {
  const configHome = await tempConfigHome();
  const requests = [];
  const server = await createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    sendJSON(res, { data: [], has_more: false, next_cursor: null });
  });

  try {
    const result = await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "transactions",
        "list",
        "--account-id",
        "acct_123",
        "--operation",
        "credit",
        "--limit",
        "25",
      ],
      { configHome },
    );

    assert.deepEqual(JSON.parse(result.stdout), { data: [], has_more: false, next_cursor: null });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/api/accounts/acct_123/transactions?operation=credit&limit=25");
    assert.equal(requests[0].authorization, "Bearer sk_live_test");
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("--max-items follows cursors and aggregates list data", async () => {
  const configHome = await tempConfigHome();
  const requests = [];
  const server = await createServer((req, res) => {
    requests.push(req.url);

    if (req.url === "/api/invoices?limit=2") {
      sendJSON(res, {
        data: [{ id: "inv_1" }, { id: "inv_2" }],
        has_more: true,
        next_cursor: "cursor_2",
      });
      return;
    }

    if (req.url === "/api/invoices?limit=1&cursor=cursor_2") {
      sendJSON(res, { data: [{ id: "inv_3" }], has_more: true, next_cursor: "cursor_3" });
      return;
    }

    sendJSON(res, { error: { message: `Unexpected URL: ${req.url}` } }, 500);
  });

  try {
    const result = await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "invoices",
        "list",
        "--max-items",
        "3",
        "--limit",
        "2",
        "--pretty",
      ],
      { configHome },
    );

    assert.deepEqual(JSON.parse(result.stdout), {
      data: [{ id: "inv_1" }, { id: "inv_2" }, { id: "inv_3" }],
      has_more: true,
      next_cursor: "cursor_3",
    });
    assert.deepEqual(requests, ["/api/invoices?limit=2", "/api/invoices?limit=1&cursor=cursor_2"]);
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("--quiet suppresses successful output", async () => {
  const configHome = await tempConfigHome();
  const server = await createServer((_req, res) => {
    sendJSON(res, { id: "entity_1" });
  });

  try {
    const result = await runCli(
      ["--api-key", "sk_live_test", "--base-url", server.baseURL, "--quiet", "entity", "get"],
      { configHome },
    );

    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("API errors include response status and body", async () => {
  const configHome = await tempConfigHome();
  const server = await createServer((_req, res) => {
    res.setHeader("X-Request-Id", "req_123");
    res.setHeader("Zazu-Version", "2026-04-29");
    sendJSON(
      res,
      {
        error: {
          message: "API key lacks the required scope: accounts:read",
          type: "insufficient_scope",
        },
      },
      403,
    );
  });

  try {
    const result = await runCli(
      ["--api-key", "sk_live_test", "--base-url", server.baseURL, "accounts", "list", "--pretty"],
      { configHome, reject: false },
    );

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), {
      error: {
        message: "API key lacks the required scope: accounts:read",
        type: "insufficient_scope",
      },
      status: 403,
      request_id: "req_123",
      zazu_version: "2026-04-29",
    });
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("requests time out with a clear error", async () => {
  const configHome = await tempConfigHome();
  const server = await createServer(() => {});

  try {
    const result = await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "--timeout-ms",
        "1",
        "entity",
        "get",
      ],
      { configHome, reject: false },
    );

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Request timed out after 1ms/);
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("webhook endpoint commands map to the API endpoints", async () => {
  const configHome = await tempConfigHome();
  const requests = [];
  const server = await createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      body: await readRequestBody(req),
    });
    sendJSON(res, { ok: true });
  });

  try {
    await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "webhook-endpoints",
        "create",
        "--url",
        "https://example.com/webhooks/zazu",
        "--description",
        "Production",
        "--event",
        "payment_link.paid",
        "--event",
        "transfer.executed",
      ],
      { configHome },
    );

    await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "webhook-endpoints",
        "regenerate-secret",
        "weh_123",
      ],
      { configHome },
    );

    await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "webhook-endpoints",
        "disable",
        "weh_123",
      ],
      { configHome },
    );

    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/api/webhook_endpoints",
        body: JSON.stringify({
          url: "https://example.com/webhooks/zazu",
          description: "Production",
          events: ["payment_link.paid", "transfer.executed"],
        }),
      },
      {
        method: "POST",
        url: "/api/webhook_endpoints/weh_123/regenerate_secret",
        body: "",
      },
      {
        method: "POST",
        url: "/api/webhook_endpoints/weh_123/disable",
        body: "",
      },
    ]);
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("webhook endpoints list supports pagination", async () => {
  const configHome = await tempConfigHome();
  const requests = [];
  const server = await createServer((req, res) => {
    requests.push(req.url);
    sendJSON(res, { data: [], has_more: false, next_cursor: null });
  });

  try {
    await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "webhook-endpoints",
        "list",
        "--limit",
        "25",
      ],
      { configHome },
    );

    assert.deepEqual(requests, ["/api/webhook_endpoints?limit=25"]);
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

test("checkout session commands map to the API endpoints", async () => {
  const configHome = await tempConfigHome();
  const requests = [];
  const server = await createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      body: await readRequestBody(req),
    });
    sendJSON(res, { ok: true });
  });

  try {
    await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "checkout-sessions",
        "create",
        "--account-id",
        "acc_123",
        "--amount",
        "100.00",
        "--success-url",
        "https://example.com/ok?session_id={CHECKOUT_SESSION_ID}",
        "--cancel-url",
        "https://example.com/cancel",
        "--description",
        "Order #1",
        "--customer-email",
        "buyer@example.com",
        "--metadata",
        '{"order_id":"ORD-1"}',
      ],
      { configHome },
    );

    await runCli(
      [
        "--api-key",
        "sk_live_test",
        "--base-url",
        server.baseURL,
        "checkout-sessions",
        "get",
        "cs_123",
      ],
      { configHome },
    );

    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/api/checkout_sessions",
        body: JSON.stringify({
          account_id: "acc_123",
          amount: "100.00",
          success_url: "https://example.com/ok?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "https://example.com/cancel",
          description: "Order #1",
          customer_email: "buyer@example.com",
          metadata: { order_id: "ORD-1" },
        }),
      },
      {
        method: "GET",
        url: "/api/checkout_sessions/cs_123",
        body: "",
      },
    ]);
  } finally {
    await server.close();
    await rm(configHome, { recursive: true, force: true });
  }
});

async function runCli(args, { configHome, reject = true } = {}) {
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    ZAZU_API_KEY: "",
    ZAZU_BASE_URL: "",
    ZAZU_VERSION: "",
  };

  try {
    const result = await execFileAsync(runtime, [cli, ...args], { env });
    return { ...result, code: 0 };
  } catch (error) {
    if (reject) throw error;
    return {
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

async function runCliWithInput(args, input, { configHome, reject = true, timeoutMs = 10000 } = {}) {
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    ZAZU_API_KEY: "",
    ZAZU_BASE_URL: "",
    ZAZU_VERSION: "",
  };

  return new Promise((resolve, rejectPromise) => {
    const child = spawn(runtime, [cli, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("error");
      child.removeAllListeners("close");
      fn(value);
    };

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error(`Command timed out after ${timeoutMs}ms`);
      error.code = 124;
      error.stdout = stdout;
      error.stderr = stderr;
      finish(rejectPromise, error);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(rejectPromise, error));
    child.on("close", (code) => {
      const result = { code, stdout, stderr };
      if (code !== 0 && reject) {
        const error = new Error(`Command failed with exit code ${code}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        finish(rejectPromise, error);
      } else {
        finish(resolve, result);
      }
    });

    child.stdin.end(input);
  });
}

async function tempConfigHome() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zazu-cli-test-"));
  return dir;
}

async function createServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    baseURL: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function sendJSON(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
