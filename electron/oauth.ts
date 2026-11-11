import { createServer, type Server } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  Connection,
  OAuthCredentials,
  OAuthInput,
} from "../src/shared/types";

export function oauthEndpoints(kind: string, tenant = "common") {
  if (kind === "google")
    return {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      scope:
        "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events",
    };
  if (
    !/^(?:common|organizations|consumers|[a-f0-9-]{36}|[a-zA-Z0-9.-]+\.onmicrosoft\.com)$/.test(
      tenant,
    )
  )
    throw new Error("Microsoft 租户标识无效");
  return {
    authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope: "openid offline_access User.Read Calendars.ReadWrite",
  };
}

async function tokenRequest(
  endpoint: string,
  values: Record<string, string>,
  fetcher = fetch,
) {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `账号授权失败（HTTP ${response.status}），请检查应用注册或重新授权`,
    );
  const result = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!result.access_token) throw new Error("授权服务未返回访问令牌");
  return result;
}

export async function refreshOAuth(
  connection: Connection,
  fetcher = fetch,
): Promise<OAuthCredentials> {
  const credentials = connection.oauth;
  if (!credentials?.refreshToken)
    throw new Error("账号授权已失效，请在连接设置中重新授权");
  const endpoints = oauthEndpoints(connection.kind, credentials.tenant);
  const values: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: credentials.clientId,
    refresh_token: credentials.refreshToken,
  };
  if (credentials.clientSecret) values.client_secret = credentials.clientSecret;
  if (connection.kind === "microsoft") values.scope = endpoints.scope;
  const tokens = await tokenRequest(endpoints.token, values, fetcher);
  return {
    ...credentials,
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token || credentials.refreshToken,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  };
}

export class OAuthAuthorization {
  constructor(private fetcher = fetch) {}
  private server?: Server;
  private reject?: (reason: Error) => void;
  cancel() {
    this.reject?.(new Error("已取消账号授权"));
  }
  async connect(
    input: OAuthInput,
    open: (url: string) => Promise<void>,
  ): Promise<Connection> {
    if (this.server) throw new Error("已有授权正在进行，请先完成或取消");
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const endpoints = oauthEndpoints(input.kind, input.tenant);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let finish!: (code: string) => void;
    const received = new Promise<string>((resolve, reject) => {
      finish = resolve;
      this.reject = reject;
    });
    void received.catch(() => {});
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      if (
        request.method !== "GET" ||
        url.pathname !== "/" ||
        url.searchParams.get("state") !== state
      ) {
        response.writeHead(400);
        response.end("无效的授权回调");
        return;
      }
      if (url.searchParams.has("error")) {
        response.end("授权未完成，请返回飞历重试。");
        this.reject?.(new Error("账号授权被取消或拒绝"));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code || code.length > 10000) {
        response.writeHead(400);
        response.end("缺少授权码");
        return;
      }
      response.end("授权已收到，请返回飞历查看连接结果。可以关闭此页面。");
      finish(code);
    });
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("无法建立本机授权回调");
      const redirect = `http://${input.kind === "google" ? "127.0.0.1" : "localhost"}:${address.port}/`;
      const authorization = new URL(endpoints.authorize);
      authorization.search = new URLSearchParams({
        client_id: input.clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: endpoints.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: input.kind === "google" ? "consent" : "select_account",
        ...(input.kind === "google" ? { access_type: "offline" } : {}),
      }).toString();
      timeout = setTimeout(
        () => this.reject?.(new Error("账号授权已超时，请重新发起")),
        5 * 60_000,
      );
      await open(authorization.href);
      const code = await received;
      const values: Record<string, string> = {
        grant_type: "authorization_code",
        client_id: input.clientId,
        redirect_uri: redirect,
        code,
        code_verifier: verifier,
      };
      if (input.kind === "google" && input.clientSecret)
        values.client_secret = input.clientSecret;
      const tokens = await tokenRequest(endpoints.token, values, this.fetcher);
      if (!tokens.refresh_token)
        throw new Error(
          "授权未返回离线访问凭据，请撤销该应用的旧授权后重新连接",
        );
      const profileUrl =
        input.kind === "google"
          ? "https://openidconnect.googleapis.com/v1/userinfo"
          : "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName";
      const response = await this.fetcher(profileUrl, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(`无法读取授权账号身份（HTTP ${response.status}）`);
      const profile = (await response.json()) as Record<string, string>;
      const accountId = profile.sub || profile.id;
      if (!accountId) throw new Error("授权账号缺少稳定身份标识");
      return {
        id: input.id || randomUUID(),
        kind: input.kind,
        name: input.name,
        url:
          input.kind === "google"
            ? "https://www.googleapis.com/calendar/v3/"
            : "https://graph.microsoft.com/v1.0/",
        username:
          profile.email ||
          profile.userPrincipalName ||
          profile.displayName ||
          "",
        enabled: true,
        readOnly: false,
        oauthClientId: input.clientId,
        oauthTenant: input.tenant,
        oauth: {
          clientId: input.clientId,
          clientSecret:
            input.kind === "google" ? input.clientSecret : undefined,
          tenant: input.tenant,
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
          accountId,
        },
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      server.closeAllConnections();
      server.close();
      this.server = undefined;
      this.reject = undefined;
    }
  }
}
