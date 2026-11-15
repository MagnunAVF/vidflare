import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuthForm } from '@/components/AuthForm'
import { meQuery } from '@/lib/auth'

export const Route = createFileRoute('/login')({
  // Already signed in: nothing to do here.
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  return (
    <main className="flex justify-center px-4 py-16">
      <AuthForm mode="login" />
    </main>
  )
}
