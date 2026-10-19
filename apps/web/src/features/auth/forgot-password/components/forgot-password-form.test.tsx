import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { userEvent, type Locator } from 'vitest/browser'
import { ForgotPasswordForm } from './forgot-password-form'

const mocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

vi.mock('@tanstack/react-router', async (orig) => {
  const actual = await orig<typeof import('@tanstack/react-router')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

describe('ForgotPasswordForm', () => {
  let screen: RenderResult
  let emailInput: Locator
  let continueButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null })

    screen = await render(<ForgotPasswordForm />)
    emailInput = screen.getByRole('textbox', { name: /^Email$/i })
    continueButton = screen.getByRole('button')
  })

  it('renders email field and continue button', async () => {
    await expect.element(emailInput).toBeInTheDocument()
    await expect.element(continueButton).toBeInTheDocument()
  })

  it('shows validation and prevents Supabase call when submitting empty form', async () => {
    await userEvent.click(continueButton)

    await expect
      .element(screen.getByText(/^Email ünvanınızı daxil edin\.$/i))
      .toBeInTheDocument()
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('sends a Supabase password reset email and stays on forgot-password page', async () => {
    await userEvent.fill(emailInput, 'customer@example.com')
    await userEvent.click(continueButton)

    await vi.waitFor(() => {
      expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
        'customer@example.com',
        {
          redirectTo: `${window.location.origin}/reset-password`,
        }
      )
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Şifrə bərpası üçün link email ünvanınıza göndərildi.'
      )
      expect(mocks.navigate).not.toHaveBeenCalled()
    })

    await expect.element(emailInput).toHaveValue('')
  })

  it('shows Supabase error and does not navigate', async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { message: 'Email rate limit exceeded' },
    })

    await userEvent.fill(emailInput, 'customer@example.com')
    await userEvent.click(continueButton)

    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Email rate limit exceeded')
      expect(mocks.navigate).not.toHaveBeenCalled()
    })
  })

  it('disables submit while sending reset email', async () => {
    let resolveReset: (value: unknown) => void
    mocks.resetPasswordForEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveReset = resolve
      })
    )

    await userEvent.fill(emailInput, 'customer@example.com')
    await userEvent.click(continueButton)

    await expect.element(continueButton).toBeDisabled()

    resolveReset!({ error: null })

    await vi.waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())
  })
})
