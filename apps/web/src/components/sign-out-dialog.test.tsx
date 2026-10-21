import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SignOutDialog } from './sign-out-dialog'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  signOut: vi.fn(),
  clearCache: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ clear: mocks.clearCache }),
}))

const MOCK_HREF = 'https://app.test/dashboard?tab=1'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: mocks.signOut,
    },
  },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ href: MOCK_HREF }),
  }
})

describe('SignOutDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.signOut.mockResolvedValue({ error: null })
  })

  it('calls Supabase signOut and navigates to sign-in', async () => {
    const { getByRole } = await render(
      <SignOutDialog open onOpenChange={vi.fn()} />
    )

    await userEvent.click(getByRole('button', { name: /^Çıxış$/i }))

    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce())
    expect(mocks.clearCache).toHaveBeenCalledOnce()
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { redirect: MOCK_HREF },
      replace: true,
    })
  })

  it('does not redirect when Supabase signOut fails', async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: 'Network error' },
    })

    const { getByRole } = await render(
      <SignOutDialog open onOpenChange={vi.fn()} />
    )

    await userEvent.click(getByRole('button', { name: /^Çıxış$/i }))

    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce())
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('does not call Supabase signOut or navigate when Cancel is clicked', async () => {
    const { getByRole } = await render(
      <SignOutDialog open onOpenChange={vi.fn()} />
    )

    await userEvent.click(getByRole('button', { name: /^Ləğv et$/i }))

    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
