#!/usr/bin/env bun

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const CLI_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://zazu.ma";
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const FORMATS = new Set(["json", "pretty", "raw"]);
const LIST_PAGE_SIZE = 100;

const GLOBAL_FLAGS = new Set([
  "api-key",
  "api-key-stdin",
  "base-url",
  "output",
  "api-version",
  "timeout-ms",
  "format",
  "debug",
  "help",
  "json",
  "pretty",
  "quiet",
  "version",
]);

const BOOLEAN_FLAGS = new Set(["all", "api-key-stdin", "debug", "help", "json", "pretty", "quiet", "version", "stdin"]);

const HELP = `Zazu CLI

Usage:
  zazu [global flags] <resource> <command> [flags]

Global flags:
  --api-key <key>       API bearer token. Env: ZAZU_API_KEY
  --api-key-stdin       Read API key from stdin for zazu login
  --base-url <url>      API host. Env: ZAZU_BASE_URL. Default: ${DEFAULT_BASE_URL}
  --api-version <date>  Zazu-Version header. Env: ZAZU_VERSION
  --timeout-ms <ms>     Request timeout in milliseconds. Env: ZAZU_TIMEOUT_MS. Default: ${DEFAULT_REQUEST_TIMEOUT_MS}
  --output <format>     json, pretty, or raw. Default: json
  --format <format>     Alias for --output
  --json                Print compact JSON
  --pretty              Print indented JSON
  --quiet               Suppress successful response output
  --debug               Print request details to stderr
  --version             Print CLI version
  --help                Show this help

Commands:
  zazu login [--api-key-stdin] [--base-url <url>]
  zazu logout
  zazu config get [api-key|api-base|api-version]
  zazu config set <api-key|api-base|api-version> <value>
  zazu config unset <api-key|api-base|api-version>

  zazu entity get
  zazu status

  zazu accounts list [--status value] [--currency-code value] [--limit n] [--cursor value] [--all|--max-items n]
  zazu accounts get <id>
  zazu accounts transactions <account-id> [--operation value] [--posted-after time] [--posted-before time] [--limit n] [--cursor value] [--all|--max-items n]
  zazu accounts transaction <account-id> <transaction-id>
  zazu transactions list --account-id <account-id> [--operation value] [--posted-after time] [--posted-before time] [--limit n] [--cursor value] [--all|--max-items n]
  zazu transactions get --account-id <account-id> <transaction-id>

  zazu customers list [--q value] [--limit n] [--cursor value] [--all|--max-items n]
  zazu customers get <id>
  zazu customers create [--data json|--file path|--stdin] [customer flags]
  zazu customers update <id> [--data json|--file path|--stdin] [customer flags]
  zazu customers delete <id>

  zazu invoices list [--status value] [--customer-id id] [--limit n] [--cursor value] [--all|--max-items n]
  zazu invoices get <id>
  zazu invoices create [--data json|--file path|--stdin] [invoice flags]
  zazu invoices update <id> [--data json|--file path|--stdin] [invoice flags]
  zazu invoices send <id>
  zazu invoices mark-as-paid <id>
  zazu invoices cancel <id>
  zazu invoices credit-note <id>
  zazu invoices delete <id>
  zazu invoices payment-link <id> --account-id <account-id>

  zazu payment-links list [--status value] [--link-type value] [--limit n] [--cursor value] [--all|--max-items n]
  zazu payment-links get <id>
  zazu payment-links create [--data json|--file path|--stdin] [payment link flags]
  zazu payment-links cancel <id>

  zazu webhook-endpoints list [--limit n] [--cursor value] [--all|--max-items n]
  zazu webhook-endpoints get <id>
  zazu webhook-endpoints create [--data json|--file path|--stdin] [--url url] [--description text] [--event value]
  zazu webhook-endpoints update <id> [--data json|--file path|--stdin] [--url url] [--description text] [--event value]
  zazu webhook-endpoints delete <id>
  zazu webhook-endpoints test <id>
  zazu webhook-endpoints regenerate-secret <id>
  zazu webhook-endpoints enable <id>
  zazu webhook-endpoints disable <id>

  zazu request <method> <path> [--data json|--file path|--stdin] [--query key=value]
`;

const COMMAND_HELP = {
  accounts: `Zazu CLI - accounts

Usage:
  zazu accounts list [--status value] [--currency-code value] [--limit n] [--cursor value] [--all|--max-items n]
  zazu accounts get <id>
  zazu accounts transactions <account-id> [--operation value] [--posted-after time] [--posted-before time] [--limit n] [--cursor value] [--all|--max-items n]
  zazu accounts transaction <account-id> <transaction-id>
`,
  config: `Zazu CLI - config

Usage:
  zazu config get [api-key|api-base|api-version]
  zazu config set <api-key|api-base|api-version> <value>
  zazu config unset <api-key|api-base|api-version>
`,
  customers: `Zazu CLI - customers

Usage:
  zazu customers list [--q value] [--limit n] [--cursor value] [--all|--max-items n]
  zazu customers get <id>
  zazu customers create [--data json|--file path|--stdin] [--company-name value] [--email value] [--billing-address json]
  zazu customers update <id> [--data json|--file path|--stdin] [--company-name value] [--email value] [--billing-address json]
  zazu customers delete <id>
`,
  entity: `Zazu CLI - entity

Usage:
  zazu entity get
`,
  invoices: `Zazu CLI - invoices

Usage:
  zazu invoices list [--status value] [--customer-id id] [--limit n] [--cursor value] [--all|--max-items n]
  zazu invoices get <id>
  zazu invoices create [--data json|--file path|--stdin] [invoice flags]
  zazu invoices update <id> [--data json|--file path|--stdin] [invoice flags]
  zazu invoices send <id>
  zazu invoices mark-as-paid <id>
  zazu invoices cancel <id>
  zazu invoices credit-note <id>
  zazu invoices delete <id>
  zazu invoices payment-link <id> --account-id <account-id>
`,
  login: `Zazu CLI - login

Usage:
  zazu login [--api-key-stdin] [--base-url <url>]

Use zazu login for an interactive hidden prompt, or pipe a key with --api-key-stdin for scripts.
`,
  logout: `Zazu CLI - logout

Usage:
  zazu logout
`,
  "payment-links": `Zazu CLI - payment-links

Usage:
  zazu payment-links list [--status value] [--link-type value] [--limit n] [--cursor value] [--all|--max-items n]
  zazu payment-links get <id>
  zazu payment-links create [--data json|--file path|--stdin] [--account-id id] [--amount amount] [--description text] [--payment-reference ref]
  zazu payment-links cancel <id>
`,
  request: `Zazu CLI - request

Usage:
  zazu request <method> <path> [--data json|--file path|--stdin] [--query key=value]
`,
  status: `Zazu CLI - status

Usage:
  zazu status
`,
  transactions: `Zazu CLI - transactions

Usage:
  zazu transactions list --account-id <account-id> [--operation value] [--posted-after time] [--posted-before time] [--limit n] [--cursor value] [--all|--max-items n]
  zazu transactions get --account-id <account-id> <transaction-id>
`,
  "webhook-endpoints": `Zazu CLI - webhook-endpoints

Usage:
  zazu webhook-endpoints list [--limit n] [--cursor value] [--all|--max-items n]
  zazu webhook-endpoints get <id>
  zazu webhook-endpoints create [--data json|--file path|--stdin] [--url url] [--description text] [--event value]
  zazu webhook-endpoints update <id> [--data json|--file path|--stdin] [--url url] [--description text] [--event value]
  zazu webhook-endpoints delete <id>
  zazu webhook-endpoints test <id>
  zazu webhook-endpoints regenerate-secret <id>
  zazu webhook-endpoints enable <id>
  zazu webhook-endpoints disable <id>
`,
};

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.globals.version) {
    console.log(CLI_VERSION);
    return;
  }

  if (parsed.globals.help) {
    console.log(helpFor(parsed.positionals));
    return;
  }

  if (parsed.positionals.length === 0) {
    console.log(HELP);
    return;
  }

  if (isLocalCommand(parsed.positionals[0])) {
    // Recovery commands (login/logout/config) must work even if the
    // stored config is corrupted — that's exactly when you need them.
    const storedConfig = await loadStoredConfig({ ignoreInvalid: true });
    await runLocalCommand(parsed, storedConfig);
    return;
  }

  const storedConfig = await loadStoredConfig();

  const config = {
    apiKey: parsed.globals["api-key"] || process.env.ZAZU_API_KEY || storedConfig.api_key || "",
    baseURL: stripTrailingSlash(parsed.globals["base-url"] || process.env.ZAZU_BASE_URL || storedConfig.base_url || DEFAULT_BASE_URL),
    apiVersion: parsed.globals["api-version"] || process.env.ZAZU_VERSION || storedConfig.api_version || "",
    requestTimeoutMs: parseOptionalPositiveInteger(parsed.globals["timeout-ms"] || process.env.ZAZU_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS, "timeout-ms"),
    output: outputFormat(parsed.globals),
    quiet: Boolean(parsed.globals.quiet),
    debug: Boolean(parsed.globals.debug),
  };

  if (!FORMATS.has(config.output)) {
    throw new CliError(`Invalid output format "${config.output}". Use json, pretty, or raw.`);
  }

  const request = buildRequest(parsed.positionals, parsed.flags);
  await send(config, request);
}

function helpFor(positionals) {
  return COMMAND_HELP[positionals[0]] || HELP;
}

function parseArgs(argv) {
  const globals = {};
  const flags = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith("--") || token === "-") {
      positionals.push(token);
      continue;
    }

    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    const key = kebab(raw.slice(0, eq === -1 ? raw.length : eq));
    let value = eq === -1 ? undefined : raw.slice(eq + 1);

    if (value === undefined && BOOLEAN_FLAGS.has(key)) {
      value = true;
    } else if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i += 1;
      } else {
        throw new CliError(`Missing value for --${key}.`);
      }
    }

    const target = GLOBAL_FLAGS.has(key) ? globals : flags;
    if (target[key] === undefined) {
      target[key] = value;
    } else if (Array.isArray(target[key])) {
      target[key].push(value);
    } else {
      target[key] = [target[key], value];
    }
  }

  return { globals, flags, positionals };
}

function buildRequest(positionals, flags) {
  const [resource, command, arg] = positionals;

  switch (resource) {
    case "status":
      return { method: "GET", path: "/api/entity" };
    case "entity":
      requireCommand(command, "get", "entity");
      return { method: "GET", path: "/api/entity" };
    case "accounts":
      return accountRequest(positionals.slice(1), flags);
    case "transactions":
      return transactionRequest(command, arg, flags);
    case "customers":
      return customerRequest(command, arg, flags);
    case "invoices":
      return invoiceRequest(command, arg, flags);
    case "payment-links":
    case "payment_links":
      return paymentLinkRequest(command, arg, flags);
    case "webhook-endpoints":
    case "webhook_endpoints":
      return webhookEndpointRequest(command, arg, flags);
    case "request":
      return rawRequest(positionals.slice(1), flags);
    default:
      throw new CliError(`Unknown command "${resource}". Run zazu --help.`);
  }
}

function accountRequest(args, flags) {
  const [command, id, transactionId] = args;

  switch (command) {
    case "list":
      return listRequest("/api/accounts", pick(flags, ["status", "currency-code", "cursor", "limit"]), flags);
    case "get":
      requireValue(id, "account id");
      return { method: "GET", path: `/api/accounts/${encodeURIComponent(id)}` };
    case "transactions":
      requireValue(id, "account id");
      return listRequest(
        `/api/accounts/${encodeURIComponent(id)}/transactions`,
        pick(flags, ["operation", "posted-after", "posted-before", "cursor", "limit"]),
        flags
      );
    case "transaction":
      requireValue(id, "account id");
      requireValue(transactionId, "transaction id");
      return {
        method: "GET",
        path: `/api/accounts/${encodeURIComponent(id)}/transactions/${encodeURIComponent(transactionId)}`,
      };
    default:
      throw new CliError("Usage: zazu accounts list|get|transactions|transaction");
  }
}

function transactionRequest(command, id, flags) {
  const accountId = flags["account-id"];
  requireValue(accountId, "account id. Use --account-id <id>");

  switch (command) {
    case "list":
      return listRequest(
        `/api/accounts/${encodeURIComponent(accountId)}/transactions`,
        pick(flags, ["operation", "posted-after", "posted-before", "cursor", "limit"]),
        flags
      );
    case "get":
      requireValue(id, "transaction id");
      return {
        method: "GET",
        path: `/api/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(id)}`,
      };
    default:
      throw new CliError("Usage: zazu transactions list|get --account-id <account-id>");
  }
}

function customerRequest(command, id, flags) {
  switch (command) {
    case "list":
      return listRequest("/api/customers", pick(flags, ["q", "cursor", "limit"]), flags);
    case "get":
      requireValue(id, "customer id");
      return { method: "GET", path: `/api/customers/${encodeURIComponent(id)}` };
    case "create":
      return { method: "POST", path: "/api/customers", body: bodyFromFlags(flags, customerBody(flags)) };
    case "update":
      requireValue(id, "customer id");
      return { method: "PATCH", path: `/api/customers/${encodeURIComponent(id)}`, body: bodyFromFlags(flags, customerBody(flags)) };
    case "delete":
      requireValue(id, "customer id");
      return { method: "DELETE", path: `/api/customers/${encodeURIComponent(id)}` };
    default:
      throw new CliError("Usage: zazu customers list|get|create|update|delete");
  }
}

function invoiceRequest(command, id, flags) {
  switch (command) {
    case "list":
      return listRequest("/api/invoices", pick(flags, ["status", "customer-id", "cursor", "limit"]), flags);
    case "get":
      requireValue(id, "invoice id");
      return { method: "GET", path: `/api/invoices/${encodeURIComponent(id)}` };
    case "create":
      return { method: "POST", path: "/api/invoices", body: bodyFromFlags(flags, invoiceBody(flags)) };
    case "update":
      requireValue(id, "invoice id");
      return { method: "PATCH", path: `/api/invoices/${encodeURIComponent(id)}`, body: bodyFromFlags(flags, invoiceBody(flags)) };
    case "send":
      requireValue(id, "invoice id");
      return { method: "POST", path: `/api/invoices/${encodeURIComponent(id)}/send` };
    case "mark-as-paid":
    case "mark_as_paid":
      requireValue(id, "invoice id");
      return { method: "POST", path: `/api/invoices/${encodeURIComponent(id)}/mark_as_paid` };
    case "cancel":
      requireValue(id, "invoice id");
      return { method: "POST", path: `/api/invoices/${encodeURIComponent(id)}/cancel` };
    case "credit-note":
    case "credit_note":
      requireValue(id, "invoice id");
      return { method: "POST", path: `/api/invoices/${encodeURIComponent(id)}/credit_note` };
    case "delete":
      requireValue(id, "invoice id");
      return { method: "DELETE", path: `/api/invoices/${encodeURIComponent(id)}` };
    case "payment-link":
    case "payment_link":
      requireValue(id, "invoice id");
      return {
        method: "POST",
        path: `/api/invoices/${encodeURIComponent(id)}/payment_link`,
        body: bodyFromFlags(flags, pick(flags, ["account-id"])),
      };
    default:
      throw new CliError("Usage: zazu invoices list|get|create|update|send|mark-as-paid|cancel|credit-note|delete|payment-link");
  }
}

function paymentLinkRequest(command, id, flags) {
  switch (command) {
    case "list":
      return listRequest("/api/payment_links", pick(flags, ["status", "link-type", "cursor", "limit"]), flags);
    case "get":
      requireValue(id, "payment link id");
      return { method: "GET", path: `/api/payment_links/${encodeURIComponent(id)}` };
    case "create":
      return { method: "POST", path: "/api/payment_links", body: bodyFromFlags(flags, paymentLinkBody(flags)) };
    case "cancel":
      requireValue(id, "payment link id");
      return { method: "POST", path: `/api/payment_links/${encodeURIComponent(id)}/cancel` };
    default:
      throw new CliError("Usage: zazu payment-links list|get|create|cancel");
  }
}

function webhookEndpointRequest(command, id, flags) {
  switch (command) {
    case "list":
      return listRequest("/api/webhook_endpoints", pick(flags, ["cursor", "limit"]), flags);
    case "get":
      requireValue(id, "webhook endpoint id");
      return { method: "GET", path: `/api/webhook_endpoints/${encodeURIComponent(id)}` };
    case "create":
      return { method: "POST", path: "/api/webhook_endpoints", body: bodyFromFlags(flags, webhookEndpointBody(flags)) };
    case "update":
      requireValue(id, "webhook endpoint id");
      return { method: "PATCH", path: `/api/webhook_endpoints/${encodeURIComponent(id)}`, body: bodyFromFlags(flags, webhookEndpointBody(flags)) };
    case "delete":
      requireValue(id, "webhook endpoint id");
      return { method: "DELETE", path: `/api/webhook_endpoints/${encodeURIComponent(id)}` };
    case "test":
      requireValue(id, "webhook endpoint id");
      return { method: "POST", path: `/api/webhook_endpoints/${encodeURIComponent(id)}/test` };
    case "regenerate-secret":
    case "regenerate_secret":
    case "rotate-secret":
    case "rotate_secret":
      requireValue(id, "webhook endpoint id");
      return { method: "POST", path: `/api/webhook_endpoints/${encodeURIComponent(id)}/regenerate_secret` };
    case "enable":
      requireValue(id, "webhook endpoint id");
      return { method: "POST", path: `/api/webhook_endpoints/${encodeURIComponent(id)}/enable` };
    case "disable":
      requireValue(id, "webhook endpoint id");
      return { method: "POST", path: `/api/webhook_endpoints/${encodeURIComponent(id)}/disable` };
    default:
      throw new CliError("Usage: zazu webhook-endpoints list|get|create|update|delete|test|regenerate-secret|enable|disable");
  }
}

function listRequest(pathValue, query, flags) {
  const maxItems = parseOptionalPositiveInteger(flags["max-items"], "max-items");
  const all = Boolean(flags.all) || maxItems !== undefined;
  const pageLimit = parseOptionalPositiveInteger(query.limit, "limit");
  const nextQuery = { ...query };

  if (all && pageLimit === undefined) {
    nextQuery.limit = maxItems === undefined ? LIST_PAGE_SIZE : Math.min(maxItems, LIST_PAGE_SIZE);
  }

  return {
    method: "GET",
    path: pathValue,
    query: nextQuery,
    paginate: all,
    maxItems,
    pageLimit,
  };
}

function rawRequest(args, flags) {
  const [method, path] = args;
  requireValue(method, "HTTP method");
  requireValue(path, "request path");

  return {
    method: method.toUpperCase(),
    path: path.startsWith("/") ? path : `/${path}`,
    query: queryPairs(flags.query),
    body: bodyFromFlags(flags, {}),
  };
}

function customerBody(flags) {
  const body = pick(flags, [
    "person-name",
    "company-name",
    "email",
    "phone",
    "tax-id",
    "ice-number",
    "customer-type",
  ]);

  if (flags["billing-address"] !== undefined) {
    body.billing_address = parseMaybeJSON(flags["billing-address"], "billing-address");
  }

  return body;
}

function invoiceBody(flags) {
  const body = pick(flags, [
    "customer-id",
    "currency-code",
    "issue-date",
    "due-date",
    "reference",
    "notes",
    "payment-terms",
    "send-to-email",
  ]);

  if (flags.item !== undefined) {
    body.items = parseArrayJSON(flags.item, "item");
  }
  if (flags.discount !== undefined) {
    body.discounts = parseArrayJSON(flags.discount, "discount");
  }

  return body;
}

function paymentLinkBody(flags) {
  return pick(flags, [
    "account-id",
    "amount",
    "title",
    "description",
    "payment-reference",
    "expires-at",
    "link-type",
    "redirect-url",
    "max-payments",
  ]);
}

function webhookEndpointBody(flags) {
  const body = pick(flags, ["url", "description"]);

  if (flags.event !== undefined && flags.events !== undefined) {
    throw new CliError("Use only one of --event or --events.");
  }

  if (flags.event !== undefined) {
    body.events = arrayify(flags.event).map((event) => String(event));
  } else if (flags.events !== undefined) {
    body.events = parseStringList(flags.events, "events");
  }

  return body;
}

function pick(flags, names) {
  const out = {};
  for (const name of names) {
    if (flags[name] !== undefined) {
      out[snake(name)] = coerceValue(flags[name]);
    }
  }
  return out;
}

function queryPairs(value) {
  const values = arrayify(value);
  const query = {};
  for (const item of values) {
    if (item === undefined) continue;
    const text = String(item);
    const eq = text.indexOf("=");
    if (eq === -1) {
      throw new CliError(`Invalid --query "${text}". Use key=value.`);
    }
    query[text.slice(0, eq)] = text.slice(eq + 1);
  }
  return query;
}

async function bodyFromFlags(flags, body) {
  let base = {};
  const bodySources = ["data", "file", "stdin"].filter((name) => flags[name] !== undefined);
  if (bodySources.length > 1) {
    throw new CliError("Use only one of --data, --file, or --stdin.");
  }

  if (flags.data !== undefined) {
    base = parseJSON(flags.data, "data");
  } else if (flags.file !== undefined) {
    base = parseJSON(await fs.readFile(flags.file, "utf8"), flags.file);
  } else if (flags.stdin !== undefined) {
    base = parseJSON(await readStdin(), "stdin");
  }

  if (!isObject(base)) {
    throw new CliError("Request body must be a JSON object.");
  }

  return { ...base, ...body };
}

async function send(config, request) {
  if (!config.apiKey) {
    throw new CliError("Missing API key. Run `zazu login`, set ZAZU_API_KEY, or pass --api-key.");
  }

  if (request.paginate) {
    await sendPaginated(config, request);
    return;
  }

  const { response, parsed } = await fetchRequest(config, request);
  if (!response.ok) {
    printError(response, parsed, config.output);
    process.exitCode = 1;
    return;
  }

  printOutput(parsed, config);
}

async function sendPaginated(config, request) {
  const data = [];
  let cursor = request.query?.cursor;
  let lastPayload = null;

  while (true) {
    const query = { ...(request.query || {}) };
    if (cursor) {
      query.cursor = cursor;
    }

    const remaining = request.maxItems === undefined ? undefined : request.maxItems - data.length;
    if (remaining !== undefined && remaining <= 0) {
      break;
    }

    if (remaining !== undefined) {
      const currentLimit = parseOptionalPositiveInteger(query.limit, "limit") || request.pageLimit || LIST_PAGE_SIZE;
      query.limit = Math.min(currentLimit, remaining, LIST_PAGE_SIZE);
    }

    const { response, parsed } = await fetchRequest(config, { ...request, query });
    if (!response.ok) {
      printError(response, parsed, config.output);
      process.exitCode = 1;
      return;
    }

    if (!isObject(parsed) || !Array.isArray(parsed.data)) {
      printOutput(parsed, config);
      return;
    }

    lastPayload = parsed;
    data.push(...parsed.data);

    if (!parsed.has_more || !parsed.next_cursor) {
      break;
    }

    cursor = parsed.next_cursor;
  }

  printOutput({
    ...(lastPayload || {}),
    data,
    has_more: Boolean(lastPayload?.has_more && data.length === request.maxItems),
    next_cursor: lastPayload?.has_more && data.length === request.maxItems ? lastPayload.next_cursor : null,
  }, config);
}

async function fetchRequest(config, request) {
  const url = buildURL(config.baseURL, request.path, request.query);
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json",
  };

  const init = { method: request.method, headers };
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Request timed out"));
  }, config.requestTimeoutMs);
  init.signal = controller.signal;

  const resolvedBody = request.body instanceof Promise ? await request.body : request.body;
  if (resolvedBody && Object.keys(resolvedBody).length > 0) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(resolvedBody);
  }

  if (config.apiVersion) {
    headers["Zazu-Version"] = config.apiVersion;
  }

  if (config.debug) {
    console.error(`${init.method} ${url.toString()}`);
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CliError(`Request timed out after ${config.requestTimeoutMs}ms.`);
    }

    throw new CliError(`Request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const parsed = contentType.includes("application/json") && text ? parseJSON(text, "response") : text;

  return { response, parsed };
}

function buildURL(baseURL, path, query = {}) {
  const normalizedPath = path.startsWith("/api/") || path === "/api" ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
  const url = new URL(normalizedPath, `${baseURL}/`);

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

function printOutput(value, config) {
  if (config.quiet) {
    return;
  }

  if (value === "" || value === undefined || value === null) {
    return;
  }

  if (config.output === "raw") {
    console.log(typeof value === "string" ? value : JSON.stringify(value));
    return;
  }

  console.log(JSON.stringify(value, null, config.output === "pretty" ? 2 : 0));
}

function printError(response, value, format) {
  if (format === "raw") {
    console.error(typeof value === "string" ? value : JSON.stringify(value));
    return;
  }

  const payload = isObject(value) ? value : { error: { message: String(value || response.statusText) } };
  payload.status = response.status;
  const requestId = response.headers.get("x-request-id");
  if (requestId) payload.request_id = requestId;
  const zazuVersion = response.headers.get("zazu-version");
  if (zazuVersion) payload.zazu_version = zazuVersion;
  console.error(JSON.stringify(payload, null, format === "pretty" ? 2 : 0));
}

function parseArrayJSON(value, label) {
  return arrayify(value).map((item) => parseJSON(item, label));
}

function parseStringList(value, label) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseStringList(item, label));
  }

  const text = String(value);
  if (text.trim().startsWith("[")) {
    const parsed = parseJSON(text, label);
    if (!Array.isArray(parsed)) {
      throw new CliError(`Invalid JSON for ${label}: expected an array.`);
    }
    return parsed.map((item) => String(item));
  }

  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseMaybeJSON(value, label) {
  if (value === "null") return null;
  return parseJSON(value, label);
}

function parseJSON(value, label) {
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new CliError(`Invalid JSON for ${label}: ${error.message}`);
  }
}

function parseOptionalPositiveInteger(value, label) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new CliError(`Missing value for --${label}.`);
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new CliError(`Invalid --${label} "${value}". Use a positive integer.`);
  }

  return number;
}

function coerceValue(value) {
  if (Array.isArray(value)) {
    return value.map(coerceValue);
  }
  if (value === true) {
    return true;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  return value;
}

async function readStdin({ requirePipe = false } = {}) {
  if (process.stdin.isTTY) {
    if (requirePipe) {
      throw new CliError("No stdin input detected. Pipe the API key into `zazu login --api-key-stdin`.");
    }

    throw new CliError("Unable to read stdin.");
  }

  process.stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let data = "";

    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.on("error", (error) => {
      reject(new CliError(`Unable to read stdin: ${error.message}`));
    });
  });
}

async function promptSecret(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new CliError(`Cannot prompt for ${label} in a non-interactive shell. Use --api-key-stdin.`);
  }

  const stdin = process.stdin;
  const previousRawMode = stdin.isRaw;

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(previousRawMode);
      stdin.pause();
    };

    const finish = () => {
      cleanup();
      process.stdout.write("\n");
      resolve(value.trim());
    };

    const cancel = () => {
      cleanup();
      process.stdout.write("\n");
      reject(new CliError("Login cancelled.", 130));
    };

    const onData = (chunk) => {
      const text = chunk.toString("utf8");

      for (const char of text) {
        if (char === "\u0003") {
          cancel();
          return;
        }

        if (char === "\r" || char === "\n") {
          finish();
          return;
        }

        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }

        value += char;
      }
    };

    process.stdout.write(`${label}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function validateApiKey(apiKey) {
  if (!apiKey.startsWith("sk_live_") && !apiKey.startsWith("sk_test_")) {
    throw new CliError("API key must start with sk_live_ or sk_test_.");
  }
}

function requireCommand(actual, expected, resource) {
  if (actual !== expected) {
    throw new CliError(`Usage: zazu ${resource} ${expected}`);
  }
}

function requireValue(value, label) {
  if (!value) {
    throw new CliError(`Missing ${label}.`);
  }
}

function outputFormat(globals) {
  if (globals.pretty) return "pretty";
  if (globals.json) return "json";
  return globals.output || globals.format || "json";
}

function isLocalCommand(resource) {
  return ["login", "logout", "config"].includes(resource);
}

async function runLocalCommand(parsed, storedConfig) {
  const [resource, command, name, value] = parsed.positionals;
  const config = {
    output: outputFormat(parsed.globals),
    quiet: Boolean(parsed.globals.quiet),
  };

  if (!FORMATS.has(config.output)) {
    throw new CliError(`Invalid output format "${config.output}". Use json, pretty, or raw.`);
  }

  switch (resource) {
    case "login":
      await loginCommand(parsed, storedConfig, config);
      return;
    case "logout":
      await logoutCommand(storedConfig, config);
      return;
    case "config":
      await configCommand(command, name, value, storedConfig, config);
      return;
    default:
      throw new CliError(`Unknown command "${resource}". Run zazu --help.`);
  }
}

async function loginCommand(parsed, storedConfig, outputConfig) {
  const apiKey = await loginApiKey(parsed);
  if (!apiKey) {
    throw new CliError("Usage: zazu login [--api-key-stdin] [--base-url <url>]");
  }

  validateApiKey(apiKey);

  const nextConfig = { ...storedConfig, api_key: apiKey };
  const baseURL = parsed.globals["base-url"] || process.env.ZAZU_BASE_URL;
  if (baseURL) {
    nextConfig.base_url = stripTrailingSlash(baseURL);
  }

  await saveStoredConfig(nextConfig);
  printOutput({ ok: true, api_key: maskSecret(apiKey), base_url: nextConfig.base_url || DEFAULT_BASE_URL }, outputConfig);
}

async function loginApiKey(parsed) {
  if (parsed.globals["api-key-stdin"] || parsed.flags["api-key-stdin"]) {
    return (await readStdin({ requirePipe: true })).trim();
  }

  return parsed.globals["api-key"] ||
    parsed.flags["api-key"] ||
    parsed.positionals[1] ||
    process.env.ZAZU_API_KEY ||
    await promptSecret("API key");
}

async function logoutCommand(storedConfig, outputConfig) {
  const nextConfig = { ...storedConfig };
  delete nextConfig.api_key;
  await saveStoredConfig(nextConfig);
  printOutput({ ok: true }, outputConfig);
}

async function configCommand(command, name, value, storedConfig, outputConfig) {
  switch (command) {
    case "get":
    case undefined:
      printOutput(readConfigValue(storedConfig, name), outputConfig);
      return;
    case "set":
      requireValue(name, "config key");
      requireValue(value, "config value");
      await setConfigValue(storedConfig, name, value);
      printOutput({ ok: true, [publicConfigKey(name)]: displayConfigValue(name, value) }, outputConfig);
      return;
    case "unset":
      requireValue(name, "config key");
      await unsetConfigValue(storedConfig, name);
      printOutput({ ok: true }, outputConfig);
      return;
    default:
      throw new CliError("Usage: zazu config get|set|unset [api-key|api-base|api-version]");
  }
}

function readConfigValue(storedConfig, name) {
  if (!name) {
    return {
      api_key: storedConfig.api_key ? maskSecret(storedConfig.api_key) : null,
      api_base: storedConfig.base_url || DEFAULT_BASE_URL,
      api_version: storedConfig.api_version || null,
      config_path: storedConfigPath(),
    };
  }

  const key = normalizedConfigKey(name);
  if (key === "api_key") return { api_key: storedConfig.api_key ? maskSecret(storedConfig.api_key) : null };
  if (key === "base_url") return { api_base: storedConfig.base_url || DEFAULT_BASE_URL };
  if (key === "api_version") return { api_version: storedConfig.api_version || null };

  throw new CliError(`Unknown config key "${name}". Use api-key, api-base, or api-version.`);
}

async function setConfigValue(storedConfig, name, value) {
  const key = normalizedConfigKey(name);
  const nextConfig = { ...storedConfig };

  if (key === "api_key") {
    nextConfig.api_key = value;
  } else if (key === "base_url") {
    nextConfig.base_url = stripTrailingSlash(value);
  } else if (key === "api_version") {
    nextConfig.api_version = value;
  } else {
    throw new CliError(`Unknown config key "${name}". Use api-key, api-base, or api-version.`);
  }

  await saveStoredConfig(nextConfig);
}

async function unsetConfigValue(storedConfig, name) {
  const key = normalizedConfigKey(name);
  const nextConfig = { ...storedConfig };

  if (key === "api_key") {
    delete nextConfig.api_key;
  } else if (key === "base_url") {
    delete nextConfig.base_url;
  } else if (key === "api_version") {
    delete nextConfig.api_version;
  } else {
    throw new CliError(`Unknown config key "${name}". Use api-key, api-base, or api-version.`);
  }

  await saveStoredConfig(nextConfig);
}

function normalizedConfigKey(name) {
  switch (kebab(name)) {
    case "api-key":
      return "api_key";
    case "api-base":
    case "base-url":
      return "base_url";
    case "api-version":
      return "api_version";
    default:
      return name;
  }
}

function displayConfigValue(name, value) {
  return normalizedConfigKey(name) === "api_key" ? maskSecret(value) : value;
}

function publicConfigKey(name) {
  return normalizedConfigKey(name) === "base_url" ? "api_base" : normalizedConfigKey(name);
}

async function loadStoredConfig({ ignoreInvalid = false } = {}) {
  let raw;
  try {
    raw = await fs.readFile(storedConfigPath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }

  try {
    return parseJSON(raw, storedConfigPath());
  } catch (error) {
    if (ignoreInvalid) return {};
    throw error;
  }
}

async function saveStoredConfig(config) {
  const filePath = storedConfigPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function storedConfigPath() {
  const root = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(root, "zazu", "config.json");
}

function maskSecret(value) {
  const text = String(value);
  if (text.length <= 12) return "********";
  return `${text.slice(0, 8)}...${text.slice(-4)}`;
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function kebab(value) {
  return value.replace(/_/g, "-");
}

function snake(value) {
  return value.replace(/-/g, "_");
}

function arrayify(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

main().catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }

  console.error(error.stack || error.message);
  process.exit(1);
});
