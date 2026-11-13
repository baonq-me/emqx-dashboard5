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

const RESTART_KEY = 'emqx-sso-proxy-restarts'

/*
 * oauth2-proxy (with --api-route=^/api/) answers API calls with a bare 401 once its own
 * session is gone. EMQX's own 401s always carry a JSON `code`. On a proxy 401, navigate to
 * /oauth2/start: a top-level request that always reaches the proxy (a reload could be served
 * from the browser cache) and runs the Keycloak login, then returns to the current page.
 * At most 3 attempts per minute, so a broken proxy cannot loop the browser.
 */
export function isProxySessionExpired(error: any): boolean {
  const resp = error?.response
  return resp?.status === 401 && !resp?.data?.code
}

export function restartProxyLogin(): boolean {
  try {
    const now = Date.now()
    const recent = JSON.parse(window.sessionStorage.getItem(RESTART_KEY) || '[]').filter(
      (t: number) => now - t < 60000,
    )
    if (recent.length && now - recent[recent.length - 1] < 5000) {
      return true // a restart is already under way (parallel API calls)
    }
    if (recent.length >= 3) {
      return false
    }
    recent.push(now)
    window.sessionStorage.setItem(RESTART_KEY, JSON.stringify(recent))
  } catch (e) {
    // storage unavailable: still try once
  }
  const back = window.location.pathname + window.location.search + window.location.hash
  window.location.href = `/oauth2/start?rd=${encodeURIComponent(back)}`
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
    if (isProxySessionExpired(e) && restartProxyLogin()) {
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
  let rd = status.logout_url || '/'
  if (rd.startsWith('/')) {
    // cache-buster: the dashboard's index.html has no Cache-Control, so a plain "/" may be served
    // from the browser cache instead of reaching oauth2-proxy (and Keycloak)
    rd += (rd.includes('?') ? '&' : '?') + `signed_out=${Date.now()}`
  }
  return `/oauth2/sign_out?rd=${encodeURIComponent(rd)}`
}
