/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
// Passwordless login behind oauth2-proxy (EMQX fork baonq-me/emqx v5.8.9-oauth).
import http from '@/common/http'

export interface SsoProxyStatus {
  enable: boolean
  password_login: boolean
  logout_url: string
  user_prefix: string
}

const SILENT = [401, 403, 404, 409, 503]

let cachedStatus: SsoProxyStatus | null = null

const RELOAD_KEY = 'emqx-sso-proxy-reload-at'

/*
 * oauth2-proxy (with --api-route=^/api/) answers API calls with a bare 401 once its own
 * session is gone. EMQX's own 401s always carry a JSON `code`. On a proxy 401, reload the
 * page: the top-level navigation lets oauth2-proxy run the Keycloak login again.
 * At most one reload per 30 s, so a broken proxy cannot loop the browser.
 */
export function isProxySessionExpired(error: any): boolean {
  const resp = error?.response
  return resp?.status === 401 && !resp?.data?.code
}

export function reloadForProxyLogin(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < 30000) {
      return false
    }
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch (e) {
    // storage unavailable: still reload once
  }
  window.location.reload()
  return true
}

export async function getSsoProxyStatus(force = false): Promise<SsoProxyStatus> {
  if (cachedStatus && !force) {
    return cachedStatus
  }
  try {
    cachedStatus = await http.get('/sso_proxy/status', {
      doNotTriggerProgress: true,
      errorsHandleCustom: [401, 404],
    })
  } catch (e) {
    if (isProxySessionExpired(e) && reloadForProxyLogin()) {
      return new Promise(() => undefined) // page is reloading
    }
    // older/unpatched backend: behave like upstream
    cachedStatus = { enable: false, password_login: true, logout_url: '', user_prefix: 'sso_' }
  }
  return cachedStatus as SsoProxyStatus
}

export function ssoProxyLogin(): Promise<{
  token: string
  username: string
  version: string
  license: { edition: string }
}> {
  return http.post('/sso_proxy/login', {}, { errorsHandleCustom: SILENT })
}

export function getSsoProxySettings(): Promise<{ password_login: boolean }> {
  return http.get('/sso_proxy/settings')
}

export async function setPasswordLogin(passwordLogin: boolean): Promise<{ password_login: boolean }> {
  const res: { password_login: boolean } = await http.put(
    '/sso_proxy/settings',
    { password_login: passwordLogin },
    { errorsHandleCustom: [409] },
  )
  if (cachedStatus) {
    cachedStatus.password_login = res.password_login
  }
  return res
}

export function isSsoProxyUser(username: string | undefined, status: SsoProxyStatus | null): boolean {
  if (!username || !status || !status.enable) {
    return false
  }
  return username.startsWith(status.user_prefix || 'sso_')
}

// Full sign-out through oauth2-proxy. With --backend-logout-url the proxy ends the Keycloak
// session server-side (id_token_hint), so logout_url is normally "/" and the browser lands on
// the Keycloak login page without a logout confirmation.
export function ssoSignOutUrl(status: SsoProxyStatus): string {
  const rd = status.logout_url || '/'
  return `/oauth2/sign_out?rd=${encodeURIComponent(rd)}`
}
