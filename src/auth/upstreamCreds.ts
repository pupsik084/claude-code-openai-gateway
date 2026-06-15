import type { Config } from '../config.js';
import type { UpstreamCredentials } from '../claudecode/headers.js';
import { OAUTH_CLIENT_ID, OAUTH_TOKEN_ENDPOINT } from '../claudecode/constants.js';
import type { Logger } from '../util/logger.js';

/**
 * Holds the active upstream credentials and (in oauth mode) handles refreshing
 * the access token using the refresh token. The refreshed token is kept in
 * memory only; never logged.
 */
export class UpstreamCredentialStore {
  private oauthToken: string | undefined;
  private refreshToken: string | undefined;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    this.oauthToken = config.ANTHROPIC_OAUTH_TOKEN;
    this.refreshToken = config.ANTHROPIC_OAUTH_REFRESH_TOKEN;
  }

  current(): UpstreamCredentials {
    if (this.config.UPSTREAM_AUTH_MODE === 'oauth') {
      return { mode: 'oauth', oauthToken: this.oauthToken };
    }
    return { mode: 'api_key', apiKey: this.config.ANTHROPIC_API_KEY };
  }

  canRefresh(): boolean {
    return this.config.UPSTREAM_AUTH_MODE === 'oauth' && Boolean(this.refreshToken);
  }

  /**
   * Refresh the OAuth access token. Coalesces concurrent refreshes. Returns
   * true on success. The token endpoint shape may change with the CLI.
   */
  async refresh(): Promise<boolean> {
    if (!this.canRefresh()) return false;
    if (this.refreshing) {
      await this.refreshing;
      return Boolean(this.oauthToken);
    }

    this.refreshing = this.doRefresh();
    try {
      await this.refreshing;
      return Boolean(this.oauthToken);
    } finally {
      this.refreshing = null;
    }
  }

  private async doRefresh(): Promise<void> {
    // TODO: verify token endpoint, client id, and payload against the live CLI.
    const endpoint = this.config.OAUTH_TOKEN_ENDPOINT ?? OAUTH_TOKEN_ENDPOINT;
    const clientId = this.config.OAUTH_CLIENT_ID ?? OAUTH_CLIENT_ID;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: clientId,
      }),
    });

    if (!res.ok) {
      this.logger.error({ status: res.status }, 'OAuth token refresh failed');
      throw new Error(`OAuth refresh failed with status ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!data.access_token) {
      throw new Error('OAuth refresh response missing access_token');
    }
    this.oauthToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.logger.info('OAuth access token refreshed');
  }
}
