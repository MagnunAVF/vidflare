import * as Sentry from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import { ErrorFallback } from './components/ErrorFallback'
import { initSentry } from './lib/sentry'
import { routeTree } from './routeTree.gen'

const queryClient = new QueryClient()

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // Freshness is TanStack Query's job; let loaders always call ensureQueryData.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  // Route errors are caught by the router, not the root boundary: report and show the fallback.
  defaultOnCatch: (error) => Sentry.captureException(error),
  defaultErrorComponent: ({ reset }) => <ErrorFallback reset={reset} />,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

initSentry(router)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback reset={resetError} />}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
