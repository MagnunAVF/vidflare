import { useQuery, type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet, useNavigate } from '@tanstack/react-router'

import { ChannelAvatar } from '@/components/ChannelAvatar'
import { Button } from '@/components/ui/button'
import { meQuery, useLogout } from '@/lib/auth'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  )
}

function Header() {
  const { data: me } = useQuery(meQuery)
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <Link to="/" className="font-semibold">
        vidflare
      </Link>
      <nav className="flex items-center gap-2">
        {me ? (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/feed/subscriptions">Subscriptions</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/studio">Studio</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/upload">Upload</Link>
            </Button>
            <Link
              to="/settings"
              title="Settings"
              className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChannelAvatar channel={me.channel} className="size-6 text-xs" />
              <span>{me.channel.name}</span>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              disabled={logout.isPending}
              onClick={async () => {
                await logout.mutateAsync()
                await navigate({ to: '/' })
              }}
            >
              Sign out
            </Button>
          </>
        ) : (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">Sign up</Link>
            </Button>
          </>
        )}
      </nav>
    </header>
  )
}
