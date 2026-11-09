import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

// Route modules must export `Route`; the router plugin handles their HMR.
// eslint-disable-next-line react-refresh/only-export-components
function RootLayout() {
  return <Outlet />
}
