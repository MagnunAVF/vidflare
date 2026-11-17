import { zodResolver } from '@hookform/resolvers/zod'
import type { TurnstileInstance } from '@marsidev/react-turnstile'
import { Link, useNavigate } from '@tanstack/react-router'
import { loginInput, signupInput } from '@vidflare/shared'
import { useRef, type FormEventHandler, type ReactNode } from 'react'
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form'
import type { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TurnstileField } from '@/components/TurnstileField'
import { ApiRequestError } from '@/lib/api'
import { useLogin, useSignup } from '@/lib/auth'

const errorMessages: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  turnstile_failed: 'The challenge failed. Please try again.',
  email_taken: 'This email already has an account.',
  handle_taken: 'This handle is taken.',
}
const errorFields: Record<string, string> = { email_taken: 'email', handle_taken: 'handle' }

// Puts an API error on the field it belongs to, or on the form.
function showApiError<T extends FieldValues>(form: UseFormReturn<T>, err: unknown) {
  const fallback = 'Something went wrong. Please try again.'
  if (!(err instanceof ApiRequestError)) return form.setError('root', { message: fallback })
  const field = errorFields[err.code]
  if (field) return form.setError(field as Path<T>, { message: errorMessages[err.code] })
  if (err.code === 'invalid_request' && err.issues.length > 0) {
    for (const issue of err.issues) form.setError(issue.path as Path<T>, { message: issue.message })
    return
  }
  form.setError('root', { message: errorMessages[err.code] ?? fallback })
}

function Field<T extends FieldValues>(props: {
  form: UseFormReturn<T>
  name: Path<T>
  label: string
  type?: string
  autoComplete?: string
}) {
  const { form, name, label, type = 'text', autoComplete } = props
  const id = `auth-${name}`
  const error = form.getFieldState(name, form.formState).error?.message
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...form.register(name)}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function AuthCard(props: {
  title: string
  description: string
  submitLabel: string
  pending: boolean
  rootError?: string
  onSubmit: FormEventHandler<HTMLFormElement>
  footer: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <form onSubmit={props.onSubmit} noValidate>
        <CardContent className="grid gap-4">
          {props.children}
          {props.rootError && (
            <p role="alert" className="text-sm text-destructive">
              {props.rootError}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={props.pending}>
            {props.pending ? 'Please wait…' : props.submitLabel}
          </Button>
          <p className="text-sm text-muted-foreground">{props.footer}</p>
        </CardFooter>
      </form>
    </Card>
  )
}

function LoginForm() {
  const navigate = useNavigate()
  const login = useLogin()
  const form = useForm<z.input<typeof loginInput>, unknown, z.output<typeof loginInput>>({
    resolver: zodResolver(loginInput),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit: FormEventHandler<HTMLFormElement> = (event) =>
    form.handleSubmit(async (values) => {
      try {
        await login.mutateAsync(values)
        await navigate({ to: '/' })
      } catch (err) {
        showApiError(form, err)
      }
    })(event)

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back to vidflare."
      submitLabel="Sign in"
      pending={form.formState.isSubmitting}
      rootError={form.formState.errors.root?.message}
      onSubmit={onSubmit}
      footer={
        <>
          No account?{' '}
          <Link to="/signup" className="underline">
            Create one
          </Link>
        </>
      }
    >
      <Field form={form} name="email" label="Email" type="email" autoComplete="email" />
      <Field
        form={form}
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
      />
    </AuthCard>
  )
}

function SignupForm() {
  const navigate = useNavigate()
  const signup = useSignup()
  const turnstile = useRef<TurnstileInstance>(undefined)
  const form = useForm<z.input<typeof signupInput>, unknown, z.output<typeof signupInput>>({
    resolver: zodResolver(signupInput),
    defaultValues: { email: '', password: '', handle: '', name: '', turnstileToken: '' },
  })
  const setToken = (token: string) =>
    form.setValue('turnstileToken', token, { shouldValidate: form.formState.isSubmitted })

  const onSubmit: FormEventHandler<HTMLFormElement> = (event) =>
    form.handleSubmit(async (values) => {
      try {
        await signup.mutateAsync(values)
        await navigate({ to: '/' })
      } catch (err) {
        showApiError(form, err)
        // Turnstile tokens are single-use: get a fresh one for the next attempt.
        setToken('')
        turnstile.current?.reset()
      }
    })(event)

  return (
    <AuthCard
      title="Create your channel"
      description="One account, one channel."
      submitLabel="Sign up"
      pending={form.formState.isSubmitting}
      rootError={form.formState.errors.root?.message}
      onSubmit={onSubmit}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="underline">
            Sign in
          </Link>
        </>
      }
    >
      <Field form={form} name="email" label="Email" type="email" autoComplete="email" />
      <Field
        form={form}
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
      />
      <Field form={form} name="handle" label="Handle" autoComplete="username" />
      <Field form={form} name="name" label="Channel name" />
      <TurnstileField
        ref={turnstile}
        onToken={setToken}
        error={form.formState.errors.turnstileToken?.message}
      />
    </AuthCard>
  )
}

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  return mode === 'signup' ? <SignupForm /> : <LoginForm />
}
