import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { ResetPasswordForm } from './reset-password-form'

const FORM_MESSAGES = {
  passwordEmpty: 'Şifrənizi daxil edin.',
  confirmPasswordEmpty: 'Şifrənizi təsdiqləyin.',
  passwordMismatch: 'Şifrələr uyğun gəlmir.',
} as const

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  updateUser: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: mocks.updateUser,
    },
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
  }
})

async function fillValidForm(
  passwordInput: Locator,
  confirmPasswordInput: Locator
) {
  await userEvent.fill(passwordInput, '1234567')
  await userEvent.fill(confirmPasswordInput, '1234567')
}

describe('ResetPasswordForm', () => {
  let screen: RenderResult
  let passwordInput: Locator
  let confirmPasswordInput: Locator
  let submitButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.updateUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    screen = await render(<ResetPasswordForm />)
    passwordInput = screen.getByLabelText(/^Yeni şifrə$/i)
    confirmPasswordInput = screen.getByLabelText(/^Şifrəni təsdiqləyin$/i)
    submitButton = screen.getByRole('button', { name: /^Şifrəni yenilə$/i })
  })

  it('renders fields and submit button', async () => {
    await expect.element(passwordInput).toBeInTheDocument()
    await expect.element(confirmPasswordInput).toBeInTheDocument()
    await expect.element(submitButton).toBeInTheDocument()
  })

  it('shows validation messages and blocks empty submit', async () => {
    await userEvent.click(submitButton)

    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordEmpty))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(FORM_MESSAGES.confirmPasswordEmpty))
      .toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('shows a mismatch error and blocks Supabase call', async () => {
    await userEvent.fill(passwordInput, '1234567')
    await userEvent.fill(confirmPasswordInput, '7654321')

    await userEvent.click(submitButton)

    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordMismatch))
      .toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('updates password, shows success toast, and redirects to sign-in', async () => {
    await fillValidForm(passwordInput, confirmPasswordInput)

    await userEvent.click(submitButton)

    await vi.waitFor(() => {
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: '1234567' })
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Şifrəniz uğurla yeniləndi.'
      )
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/sign-in',
        replace: true,
      })
    })
  })

  it('shows Supabase error and does not redirect', async () => {
    mocks.updateUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Recovery session expired' },
    })

    await fillValidForm(passwordInput, confirmPasswordInput)

    await userEvent.click(submitButton)

    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Linkin və ya kodun vaxtı bitib. Zəhmət olmasa yenisini istəyin.'
      )
      expect(mocks.navigate).not.toHaveBeenCalled()
    })
  })

  it('disables submit while updating password', async () => {
    let resolveUpdate: (value: unknown) => void
    mocks.updateUser.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve
      })
    )

    await fillValidForm(passwordInput, confirmPasswordInput)

    await userEvent.click(submitButton)
    await expect
      .element(screen.getByRole('button', { name: /^Şifrə yenilənir/i }))
      .toBeDisabled()

    resolveUpdate!({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled())
  })
})
