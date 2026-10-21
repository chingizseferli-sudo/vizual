import '@/styles/index.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SignIn } from './index'

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ clear: vi.fn() }),
}))
vi.mock('@/hooks/use-public-site-brand', () => ({
  usePublicSiteBrand: () => ({ siteName: 'UI test', logoUrl: '', iconUrl: '' }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signOut: vi.fn() } },
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    to,
    ...props
  }: React.ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

function luminance(color: string) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

afterEach(() => document.documentElement.classList.remove('light', 'dark'))

describe.each(['light', 'dark'] as const)(
  'Sign-in readability in %s',
  (theme) => {
    it.each(['customer', 'admin'] as const)(
      'supports %s inputs, focus, reveal and validation',
      async (mode) => {
        document.documentElement.classList.add(theme)
        const screen = await render(<SignIn mode={mode} />)
        const email = screen.getByLabelText(/^Email$/)
        const password = screen.getByLabelText(/^Şifrə$/)
        await expect.element(email).toHaveValue('')
        await expect.element(password).toHaveValue('')
        for (const locator of [email, password]) {
          const input = locator.element() as HTMLInputElement
          const styles = getComputedStyle(input)
          expect(
            contrast(styles.color, styles.backgroundColor)
          ).toBeGreaterThanOrEqual(4.5)
          expect(
            contrast(
              getComputedStyle(input, '::placeholder').color,
              styles.backgroundColor
            )
          ).toBeGreaterThanOrEqual(4.5)
          expect(styles.borderStyle).toBe('solid')
          expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        }
        await userEvent.type(email, 'ui-test@example.invalid')
        await userEvent.type(password, 'synthetic-password')
        await expect.element(email).toHaveValue('ui-test@example.invalid')
        await expect.element(password).toHaveValue('synthetic-password')
        expect(getComputedStyle(password.element()).boxShadow).not.toBe('none')
        await userEvent.click(
          screen.getByRole('button', { name: 'Şifrəni göstər' })
        )
        await expect.element(password).toHaveAttribute('type', 'text')
        await userEvent.click(
          screen.getByRole('button', { name: 'Şifrəni gizlət' })
        )
        await expect.element(password).toHaveAttribute('type', 'password')
        await userEvent.clear(email)
        await userEvent.clear(password)
        await userEvent.click(
          screen.getByRole('button', { name: 'Daxil ol', exact: true })
        )
        await expect.element(email).toHaveAttribute('aria-invalid', 'true')
        await expect.element(password).toHaveAttribute('aria-invalid', 'true')
        await expect
          .element(screen.getByText('Email ünvanınızı daxil edin.'))
          .toBeVisible()
        await expect
          .element(screen.getByText('Şifrənizi daxil edin.'))
          .toBeVisible()
      }
    )
  }
)
