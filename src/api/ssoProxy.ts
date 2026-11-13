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

export async function getSsoProxyStatus(force = false): Promise<SsoProxyStatus> {
  if (cachedStatus && !force) {
    return cachedStatus
  }
  try {
    cachedStatus = await http.get('/sso_proxy/status', {
      doNotTriggerProgress: true,
      errorsHandleCustom: [404],
    })
  } catch (e) {
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

// Full sign-out: oauth2-proxy session, then the identity provider's end-session URL.
export function ssoSignOutUrl(status: SsoProxyStatus): string {
  const rd = status.logout_url || '/'
  return `/oauth2/sign_out?rd=${encodeURIComponent(rd)}`
}
