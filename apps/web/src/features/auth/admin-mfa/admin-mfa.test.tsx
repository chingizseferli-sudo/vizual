import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { AdminMfa } from '.'

const QR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getSession: vi.fn(),
  aal: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  signOut: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  clearCache: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ clear: mocks.clearCache }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signOut: mocks.signOut,
      mfa: {
        getAuthenticatorAssuranceLevel: mocks.aal,
        listFactors: mocks.listFactors,
        enroll: mocks.enroll,
        unenroll: mocks.unenroll,
        challengeAndVerify: mocks.challengeAndVerify,
      },
    },
  },
}))

vi.mock('@/hooks/use-public-site-brand', () => ({
  usePublicSiteBrand: () => ({ siteName: 'Vizual.Az', logoUrl: null, iconUrl: null }),
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mocks.navigate,
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

describe('AdminMfa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'a' } } } })
    mocks.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
  })

  it('sets up an authenticator for an admin who has none, removing abandoned setups', async () => {
    mocks.aal.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null })
    mocks.listFactors.mockResolvedValue({
      data: { all: [{ id: 'old', factor_type: 'totp', status: 'unverified' }], totp: [] },
      error: null,
    })
    mocks.unenroll.mockResolvedValue({ error: null })
    mocks.enroll.mockResolvedValue({
      data: { id: 'new-factor', totp: { qr_code: QR, secret: 'ABCDEF123456', uri: 'otpauth://x' } },
      error: null,
    })

    const screen = await render(<AdminMfa redirectTo='/admin/users' />)

    await expect.element(screen.getByText('İki addımlı girişi qurun')).toBeInTheDocument()
    await expect.element(screen.getByAltText('İki addımlı giriş üçün QR kod')).toBeInTheDocument()
    await expect.element(screen.getByText('ABCDEF123456')).toBeInTheDocument()
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: 'old' })

    await userEvent.keyboard('123456')
    await screen.getByRole('button', { name: 'Təsdiqlə' }).click()

    await vi.waitFor(() => {
      expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'new-factor', code: '123456' })
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/admin/users', replace: true })
    })
  })

  it('asks an enrolled admin for the code and rejects a wrong one', async () => {
    mocks.aal.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null })
    mocks.listFactors.mockResolvedValue({
      data: { all: [], totp: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] },
      error: null,
    })
    mocks.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { message: 'Invalid TOTP code' } })

    const screen = await render(<AdminMfa redirectTo='https://evil.example' />)

    await expect.element(screen.getByText('İki addımlı giriş', { exact: true })).toBeInTheDocument()
    expect(mocks.enroll).not.toHaveBeenCalled()

    await userEvent.keyboard('000000')
    await screen.getByRole('button', { name: 'Təsdiqlə' }).click()
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.navigate).not.toHaveBeenCalled()

    await userEvent.keyboard('654321')
    await screen.getByRole('button', { name: 'Təsdiqlə' }).click()
    await vi.waitFor(() => {
      expect(mocks.challengeAndVerify).toHaveBeenLastCalledWith({ factorId: 'f1', code: '654321' })
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/admin', replace: true })
    })
  })

  it('goes straight on when the session already passed two-step login', async () => {
    mocks.aal.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null })
    await render(<AdminMfa redirectTo='/admin/news' />)
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/admin/news', replace: true })
    )
    expect(mocks.listFactors).not.toHaveBeenCalled()
  })

  it('sends a signed-out visitor to the admin sign-in', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    await render(<AdminMfa />)
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/admin/sign-in',
        search: { redirect: '/admin' },
        replace: true,
      })
    )
  })
})
