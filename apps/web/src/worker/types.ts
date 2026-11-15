// The signed-in user, as loaded from the session cookie by the session middleware.
export interface SessionUser {
  id: string
  email: string
  sessionId: string
  channel: { id: string; handle: string; name: string; avatarKey: string | null }
}

export interface AppEnv {
  Bindings: Env
  Variables: {
    requestId: string
    user?: SessionUser
  }
}
