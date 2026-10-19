import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

const FORM_MESSAGES = {
  emailEmpty: 'Email ünvanınızı daxil edin.',
  passwordEmpty: 'Şifrənizi daxil edin.',
  passwordShort: 'Şifrə ən azı 7 simvol olmalıdır.',
} as const

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
    from: mocks.from,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    Link: ({
      children,
      to,
      className,
      ...rest
    }: {
      children?: React.ReactNode
      to: string
      className?: string
    }) => (
      <a href={to} className={className} {...rest}>
        {children}
      </a>
    ),
  }
})

function mockProfileQuery() {
  mocks.from.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: mocks.maybeSingle,
      })),
    })),
  })
}

function mockSuccessfulSignIn(userId = 'user-1', email = 'user@example.com') {
  mocks.signInWithPassword.mockResolvedValue({
    data: {
      user: {
        id: userId,
        email,
      },
    },
    error: null,
  })
}

function mockProfile(role: string, status = 'active') {
  mocks.maybeSingle.mockResolvedValue({
    data: {
      user_id: 'user-1',
      email: 'user@example.com',
      role,
      status,
    },
    error: null,
  })
}

async function fillAndSubmit(
  emailInput: Locator,
  passwordInput: Locator,
  signInButton: Locator
) {
  await userEvent.fill(emailInput, 'user@example.com')
  await userEvent.fill(passwordInput, '1234567')
  await userEvent.click(signInButton)
}

describe('UserAuthForm', () => {
  let screen: RenderResult
  let emailInput: Locator
  let passwordInput: Locator
  let signInButton: Locator
  let forgotPasswordLink: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    mockProfileQuery()
    mocks.signOut.mockResolvedValue({ error: null })
    screen = await render(<UserAuthForm />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    passwordInput = screen.getByLabelText(/^Şifrə$/i)
    signInButton = screen.getByRole('button', { name: /^Daxil ol$/i })
    forgotPasswordLink = screen.getByText(/^Şifrəni unutmusunuz\?$/i)
  })

  it('renders fields, submit button, and forgot password link', async () => {
    await expect.element(emailInput).toBeInTheDocument()
    await expect.element(passwordInput).toBeInTheDocument()
    await expect.element(signInButton).toBeInTheDocument()
    await expect.element(forgotPasswordLink).toBeInTheDocument()
  })

  it('shows validation messages when submitting empty form', async () => {
    await userEvent.click(signInButton)

    await expect
      .element(screen.getByText(FORM_MESSAGES.emailEmpty))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordEmpty))
      .toBeInTheDocument()
  })

  it('redirects a superadmin to admin dashboard on successful sign-in', async () => {
    mockSuccessfulSignIn()
    mockProfile('superadmin')

    await screen.rerender(<UserAuthForm mode='admin' />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    passwordInput = screen.getByLabelText(/^Şifrə$/i)
    signInButton = screen.getByRole('button', { name: /^Daxil ol$/i })

    await fillAndSubmit(emailInput, passwordInput, signInButton)

    await vi.waitFor(() => {
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: '1234567',
      })
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/admin',
        replace: true,
      })
    })
  })

  it('redirects a customer to monitor dashboard on successful sign-in', async () => {
    mockSuccessfulSignIn()
    mockProfile('customer')

    await fillAndSubmit(emailInput, passwordInput, signInButton)

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/monitor',
        replace: true,
      })
    )
  })

  it('shows an error and does not navigate when password is wrong', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })

    await fillAndSubmit(emailInput, passwordInput, signInButton)

    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Email və ya şifrə yanlışdır.'
      )
      expect(mocks.navigate).not.toHaveBeenCalled()
    })
  })

  it('signs out and shows an error when profile is missing', async () => {
    mockSuccessfulSignIn()
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })

    await fillAndSubmit(emailInput, passwordInput, signInButton)

    await vi.waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledOnce()
      expect(mocks.toastError).toHaveBeenCalledWith(
        'İstifadəçi profili tapılmadı. Adminlə əlaqə saxlayın.'
      )
      expect(mocks.navigate).not.toHaveBeenCalled()
    })
  })

  it('signs out and shows an error when account is blocked', async () => {
    mockSuccessfulSignIn()
    mockProfile('customer', 'blocked')

    await fillAndSubmit(emailInput, passwordInput, signInButton)

    await vi.waitFor(() => {
      expect(mocks.signOut).toHaveBeenCalledOnce()
      expect(mocks.toastError).toHaveBeenCalledWith('Hesab aktiv deyil.')
      expect(mocks.navigate).not.toHaveBeenCalled()
    })
  })

  it('uses a safe admin redirect only for admin users', async () => {
    vi.clearAllMocks()
    mockProfileQuery()
    mockSuccessfulSignIn()
    mockProfile('superadmin')

    await screen.rerender(
      <UserAuthForm mode='admin' redirectTo='/admin/monitor/sources' />
    )

    await fillAndSubmit(
      screen.getByRole('textbox', { name: /Email/i }),
      screen.getByLabelText('Şifrə'),
      screen.getByRole('button', { name: /Daxil ol/i })
    )

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/admin/monitor/sources',
        replace: true,
      })
    )
  })

  it('falls back to monitor dashboard for unsafe customer redirects', async () => {
    vi.clearAllMocks()
    mockProfileQuery()
    mockSuccessfulSignIn()
    mockProfile('customer')

    await screen.rerender(<UserAuthForm redirectTo='/settings' />)

    await fillAndSubmit(
      screen.getByRole('textbox', { name: /Email/i }),
      screen.getByLabelText('Şifrə'),
      screen.getByRole('button', { name: /Daxil ol/i })
    )

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/monitor',
        replace: true,
      })
    )
  })
})
