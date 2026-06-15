// Claude Code CLI emulation constants. These values mirror the real Claude Code
// client so the upstream accepts requests authenticated with Claude-Code-only
// credentials (e.g. sk-ant-oat-* OAuth tokens). They change frequently — keep
// them overridable via env (see config.ts) rather than hardcoded elsewhere.

// The mandatory first system block. For all models except Haiku, the Anthropic
// Messages API silently rejects OAuth-authenticated requests whose first system
// text block does NOT begin exactly with this string (HTTP 400 "Error").
// See: https://github.com/anthropics/claude-code/issues/40515
export const CLAUDE_CODE_SYSTEM_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

// beta flag added only in oauth mode.
export const OAUTH_BETA_FLAG = 'oauth-2025-04-20';

// Stainless SDK fingerprint headers sent by the Claude Code CLI (JS SDK).
export const STAINLESS_LANG = 'js';
export const STAINLESS_RUNTIME = 'node';

// x-app header value used by the CLI.
export const X_APP = 'cli';

// OAuth token refresh endpoint. May change; verify against the live client.
// TODO: verify token endpoint and payload shape against current Claude Code CLI.
export const OAUTH_TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
export const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
