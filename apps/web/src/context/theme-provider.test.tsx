import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ThemeProvider, useTheme } from './theme-provider'

function Probe() {
  const { theme, resolvedTheme, setTheme, resetTheme } = useTheme()
  return (
    <>
      <output>
        {theme}/{resolvedTheme}
      </output>
      <button onClick={() => setTheme('dark')}>Dark</button>
      <button onClick={resetTheme}>Reset</button>
    </>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.cookie = 'ui-test-theme=; path=/; max-age=0'
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.style.colorScheme = ''
})

describe('ThemeProvider', () => {
  it('persists a selected theme and restores it on remount', async () => {
    const screen = await render(
      <ThemeProvider storageKey='ui-test-theme' defaultTheme='light'>
        <Probe />
      </ThemeProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    await expect.element(screen.getByText('dark/dark')).toBeVisible()
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.cookie).toContain('ui-test-theme=dark')
    await screen.unmount()
    const restored = await render(
      <ThemeProvider storageKey='ui-test-theme'>
        <Probe />
      </ThemeProvider>
    )
    await expect.element(restored.getByText('dark/dark')).toBeVisible()
  })

  it('ignores invalid stored values and resets to the supplied default', async () => {
    document.cookie = 'ui-test-theme=invalid; path=/'
    const screen = await render(
      <ThemeProvider storageKey='ui-test-theme' defaultTheme='light'>
        <Probe />
      </ThemeProvider>
    )
    await expect.element(screen.getByText('light/light')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await expect.element(screen.getByText('light/light')).toBeVisible()
  })

  it('updates resolved theme and root class when the system preference changes', async () => {
    let listener: (() => void) | undefined
    const media = {
      matches: false,
      addEventListener: vi.fn((_, fn) => {
        listener = fn
      }),
      removeEventListener: vi.fn(),
    }
    vi.spyOn(window, 'matchMedia').mockReturnValue(
      media as unknown as MediaQueryList
    )
    const screen = await render(
      <ThemeProvider storageKey='ui-test-theme' defaultTheme='system'>
        <Probe />
      </ThemeProvider>
    )
    await expect.element(screen.getByText('system/light')).toBeVisible()
    media.matches = true
    listener?.()
    await expect.element(screen.getByText('system/dark')).toBeVisible()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    await screen.unmount()
    expect(media.removeEventListener).toHaveBeenCalled()
  })
})
