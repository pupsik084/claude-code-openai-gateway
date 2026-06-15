# claude-code-openai-gateway

An **OpenAI-compatible API gateway** that, on the inside, talks to the **Anthropic
Messages API** while **fully emulating the official Claude Code CLI** — same HTTP
headers, the mandatory system-prompt prefix, the same `anthropic-beta` flags and
`user-agent`.

This converts a "key that only works inside Claude Code" (e.g. a Claude Max
subscription OAuth token, `sk-ant-oat-*`) into a **universal OpenAI key** that any
OpenAI-compatible tool can use unmodified — just point it at this gateway.

```
OpenAI client ──(OpenAI Chat Completions)──► GATEWAY ──(emulate Claude Code → Anthropic Messages)──► api.anthropic.com
              ◄──(OpenAI response / SSE)─────         ◄──(Anthropic SSE)──────────────────────────
```

Any tool that speaks OpenAI (Cursor, Continue, Aider, LangChain, the official
`openai` Python/JS SDKs, Open WebUI, LibreChat, …) works by changing only
`base_url` and `api_key`.

> **Why?** The upstream validates that requests "look like Claude Code". In
> particular, when authenticating with an OAuth token, the Messages API silently
> requires that the **first** `system` text block begins **exactly** with
> `You are Claude Code, Anthropic's official CLI for Claude.` for all non-Haiku
> models — otherwise it returns an unhelpful `HTTP 400 "Error"`
> ([issue #40515](https://github.com/anthropics/claude-code/issues/40515)). This
> gateway hides all of that compatibility magic behind a clean OpenAI interface.

## Why Fastify?

Fastify is used for its speed and first-class streaming support (we stream
Anthropic SSE straight through to OpenAI SSE with backpressure). The only runtime
dependencies are `fastify`, `zod` (validation/config) and `pino` (logging). The
upstream HTTP client is the native `fetch`/`undici` — no `axios`.

## Quick start

Requires **Node.js ≥ 20**.

```bash
npm install
cp .env.example .env       # then edit .env (see Configuration below)
npm run dev                # tsx watch, serves http://localhost:3000
# or for production:
npm run build && npm start
```

Smoke test with curl:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Say hi"}]}'
```

### Docker

```bash
docker compose up --build
# or
docker build -t claude-code-openai-gateway .
docker run --rm -p 3000:3000 --env-file .env -e HOST=0.0.0.0 claude-code-openai-gateway
```

## Configuration

All configuration is via environment variables (validated with zod — the process
exits with a clear message if a required field is missing). See `.env.example`.

| Variable                        | Required | Default                     | Purpose                                                               |
| ------------------------------- | -------- | --------------------------- | --------------------------------------------------------------------- |
| `PORT`                          | no       | `3000`                      | Gateway port.                                                         |
| `HOST`                          | no       | `127.0.0.1`                 | Bind address. Localhost-only by default.                              |
| `PROXY_API_KEY`                 | **yes**  | —                           | Key(s) downstream clients present. Comma-separated list supported.    |
| `UPSTREAM_BASE_URL`             | no       | `https://api.anthropic.com` | Anthropic base URL.                                                   |
| `UPSTREAM_AUTH_MODE`            | **yes**  | `api_key`                   | `api_key` or `oauth`.                                                 |
| `ANTHROPIC_API_KEY`             | cond.    | —                           | Required when `UPSTREAM_AUTH_MODE=api_key` (`sk-ant-api-*`).          |
| `ANTHROPIC_OAUTH_TOKEN`         | cond.    | —                           | Required when `oauth` (`sk-ant-oat-*`).                               |
| `ANTHROPIC_OAUTH_REFRESH_TOKEN` | no       | —                           | Enables auto-refresh of the access token on 401.                      |
| `ANTHROPIC_VERSION`             | no       | `2023-06-01`                | `anthropic-version` header.                                           |
| `CLAUDE_CODE_VERSION`           | no       | `2.1.85`                    | Version in `user-agent: claude-cli/<ver> (external, cli)`.            |
| `ANTHROPIC_BETA`                | no       | `claude-code-20250219`      | beta flags. The oauth flag is added automatically in oauth mode.      |
| `DEFAULT_MODEL`                 | no       | `claude-sonnet-4-6`         | Fallback for unknown/empty model names.                               |
| `MODEL_MAP`                     | no       | (see below)                 | JSON string overriding the OpenAI→Anthropic map.                      |
| `INJECT_CLAUDE_CODE_SYSTEM`     | no       | `true`                      | Force-inject the mandatory Claude Code system prefix.                 |
| `REQUEST_TIMEOUT_MS`            | no       | `300000`                    | Upstream request timeout.                                             |
| `MAX_RETRIES`                   | no       | `2`                         | Retries on 429/5xx (exponential backoff + jitter).                    |
| `DEFAULT_MAX_TOKENS`            | no       | `4096`                      | `max_tokens` when the client omits it (Anthropic requires it).        |
| `MAX_BODY_BYTES`                | no       | `10485760`                  | Request body size limit.                                              |
| `EMIT_REASONING_CONTENT`        | no       | `true`                      | Map Anthropic extended-thinking deltas to OpenAI `reasoning_content`. |
| `LOG_LEVEL`                     | no       | `info`                      | pino log level.                                                       |
| `LOG_BODIES`                    | no       | `false`                     | Log request/response bodies (secrets always masked).                  |
| `OAUTH_TOKEN_ENDPOINT`          | no       | (built-in)                  | Override the OAuth refresh endpoint.                                  |
| `OAUTH_CLIENT_ID`               | no       | (built-in)                  | Override the OAuth client id used for refresh.                        |

## Connecting clients

Set the base URL to `http://localhost:3000/v1` and the API key to your
`PROXY_API_KEY` everywhere.

**openai-python**

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3000/v1", api_key="YOUR_PROXY_API_KEY")
print(client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
).choices[0].message.content)
```

**openai-js**

```js
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://localhost:3000/v1', apiKey: 'YOUR_PROXY_API_KEY' });
const res = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

**Cursor / Continue** — set the OpenAI base URL/override to `http://localhost:3000/v1`
and the API key to your `PROXY_API_KEY`.

**Aider** — `OPENAI_API_BASE=http://localhost:3000/v1 OPENAI_API_KEY=YOUR_PROXY_API_KEY aider --model gpt-4o`

**Open WebUI / LibreChat** — add an OpenAI-compatible connection pointing at the
gateway URL and key.

## Supported models & mapping

`GET /v1/models` returns the keys of the model map. The default map (override with
`MODEL_MAP`):

```jsonc
{
  "gpt-4o": "claude-sonnet-4-6",
  "gpt-4o-mini": "claude-haiku-4-5",
  "gpt-4-turbo": "claude-sonnet-4-6",
  "gpt-4": "claude-opus-4-6",
  "gpt-3.5-turbo": "claude-haiku-4-5",
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5": "claude-haiku-4-5",
}
```

Resolution order: exact match → `claude-*` pass-through → prefix rule
(`gpt-4o*`, `gpt-4*`, `gpt-3.5*`) → `DEFAULT_MODEL`.

## Endpoints

- `POST /v1/chat/completions` — streaming and non-streaming, tools/function
  calling, images (`image_url`), `response_format: json_object` (best-effort).
- `GET /v1/models`, `GET /v1/models/:id`
- `GET /healthz` (liveness), `GET /readyz` (checks upstream credentials)

## Limitations

- `n > 1` is rejected (`400`). Only `n=1` is supported.
- `/v1/embeddings` is **not** implemented.
- Extended thinking is surfaced via the non-standard (but widely supported)
  `reasoning_content` delta field; disable with `EMIT_REASONING_CONTENT=false`.
- The Claude Code CLI version, beta flags and the OAuth token endpoint are
  **undocumented and change over time** — they are configurable (see above) and
  marked with `// TODO: verify` in the code.

## Troubleshooting

- **`400 "Error"` in oauth mode** → the mandatory Claude Code system prefix is
  missing. Keep `INJECT_CLAUDE_CODE_SYSTEM=true`. The gateway logs a hint when it
  detects this case.
- **`401` / `429`** → check `UPSTREAM_AUTH_MODE` and your upstream credentials. In
  oauth mode, set `ANTHROPIC_OAUTH_REFRESH_TOKEN` to enable automatic refresh.
- **`401` from the gateway itself** → the downstream `Authorization: Bearer` key
  does not match `PROXY_API_KEY`.

## Development

```bash
npm run dev          # watch mode
npm test             # vitest (unit + integration against a fake upstream)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
```

## Security

- Binds to `127.0.0.1` by default. With `HOST=0.0.0.0` the gateway refuses to
  start unless a strong, non-default `PROXY_API_KEY` is set.
- All secrets (`authorization`, `x-api-key`, `*token*`) are masked in logs.
- A request body size limit (`MAX_BODY_BYTES`) and timeouts guard against abuse.

## License

MIT
