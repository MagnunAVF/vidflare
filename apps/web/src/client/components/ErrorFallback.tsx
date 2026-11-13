import { Button } from '@/components/ui/button'

// Shown when rendering fails: by the root Sentry.ErrorBoundary and as the router's default
// error component. The error itself is already reported to Sentry.
export function ErrorFallback({ reset }: { reset?: () => void }) {
  return (
    <main role="alert" className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">We've been notified. Try again, or reload the page.</p>
      <div className="flex gap-2">
        {reset && (
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        )}
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </main>
  )
}
