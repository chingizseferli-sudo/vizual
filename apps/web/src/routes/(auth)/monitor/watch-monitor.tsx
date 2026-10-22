import {
  Fragment,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ProtectedRoute } from '@/features/auth/components/protected-route'
import { toast } from 'sonner'
import { getCurrentSupabaseProfile } from '@/lib/auth-session'
import {
  buildPixelPickerHtml,
  type PixelPickedElement,
} from '@/lib/selector-picker'
import { supabase } from '@/lib/supabase'
import { openExternalUrl } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { dateLocale, t } from '@/lib/i18n'
import { friendlyError } from '@/lib/friendly-error'

type ChangeSourceStatus = 'active' | 'inactive' | 'paused'

type ChangeMonitorAccess = {
  userId: string
  isAdmin: boolean
}

type WatchFilter = 'all' | 'active' | 'inactive' | 'error' | 'changed24h'

type ChangeSource = {
  id: string
  user_id: string | null
  name: string | null
  url: string | null
  domain: string | null
  selector: string | null
  status: string | null
  interval_minutes: number | null
  telegram_chat_id: string | null
  next_check_at: string | null
  last_checked_at: string | null
  last_changed_at: string | null
  last_success_at: string | null
  last_error: string | null
  consecutive_fail_count: number | null
  content_hash?: string | null
  created_at: string | null
  updated_at: string | null
}

type ChangeEvent = {
  id: string
  source_id: string | null
  old_snapshot_id?: string | null
  new_snapshot_id?: string | null
  old_hash?: string | null
  new_hash?: string | null
  diff_summary?: string | null
  created_at: string | null
}

type ChangeSnapshot = {
  id: string
  source_id: string | null
  content_text: string | null
  content_hash?: string | null
  captured_at: string | null
}

type DiffCellTone = 'normal' | 'added' | 'removed' | 'modified' | 'empty'

type DiffRow = {
  left: string
  right: string
  leftTone: DiffCellTone
  rightTone: DiffCellTone
}

type DiffResult = {
  rows: DiffRow[]
  added: number
  removed: number
  modified: number
  unchanged: number
}

type LinkItem = {
  title: string
  url: string
}

type SnapshotItem = {
  title: string
  url: string
  published?: string
  image?: string
}

type SnapshotItemChange = {
  before: SnapshotItem
  after: SnapshotItem
}

type SnapshotItemCompare = {
  added: SnapshotItem[]
  removed: SnapshotItem[]
  changed: SnapshotItemChange[]
}

type SnapshotComparisonStatus = 'normal' | 'new' | 'changed' | 'removed'

type SnapshotComparisonRow = {
  before: SnapshotItem | null
  after: SnapshotItem | null
  status: SnapshotComparisonStatus
}

type SnapshotViewMode = 'visual' | 'text'

// Kept behind a named switch until the legacy snapshot panel is extracted.
const LEGACY_SNAPSHOT_VIEW_ENABLED = false

function readStoredAlertIds() {
  try {
    const stored = window.localStorage.getItem(
      'visual-customer-change-monitor-read-alerts'
    )
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

type ChangeAlert = {
  id: string
  event_id?: string | null
  source_id: string | null
  status: string | null
  created_at: string | null
  sent_at: string | null
  error: string | null
}

type ChangeNotificationItem = {
  alert: ChangeAlert
  source: ChangeSource | null
  event: ChangeEvent | null
  isRead: boolean
  title: string
  summary: string
  time: string | null
  url: string | null
  kind: 'new' | 'removed' | 'changed' | 'generic'
}

type ExpandedSourceDetails = {
  events: ChangeEvent[]
  snapshots: Record<string, ChangeSnapshot>
  latestSnapshots: ChangeSnapshot[]
  alert: ChangeAlert | null
}

type SourceFormState = {
  name: string
  url: string
  selector: string
  interval_minutes: string
  telegram_chat_id: string
  status: ChangeSourceStatus
}

type PickedElement = PixelPickedElement

type SelectorTestResult = {
  ok: boolean
  matchedCount: number
  previewText: string
  error?: string | null
}

const emptyForm: SourceFormState = {
  name: '',
  url: '',
  selector: '',
  interval_minutes: '5',
  telegram_chat_id: '',
  status: 'active',
}

function buildPickerHtml(html: string, baseUrl: string) {
  return buildPixelPickerHtml(html, { baseUrl, autoSuggest: true })

  const safeBaseUrl = baseUrl.replace(/"/g, '&quot;')
  const baseTag = `<base href="${safeBaseUrl}">`
  const pickerStyle = `
    <style id="visual-monitor-picker-style">
      html, body { min-height: 100% !important; }
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        transition-delay: 0s !important;
      }
      [data-aos], [data-animate], [data-animation],
      .aos-init, .aos-animate, .wow, .animated, .fade, .fade-in,
      .reveal, .revealed, .invisible, .lazy-hidden {
        opacity: 1 !important;
        visibility: visible !important;
        transform: none !important;
      }
      li:hover > ul,
      li:hover > ol,
      li:hover > div,
      .dropdown:hover > .dropdown-menu,
      .menu-item:hover > .sub-menu,
      .menu-item:hover > .submenu,
      .nav-item:hover > .dropdown-menu,
      .has-dropdown:hover > ul,
      .has-dropdown:hover > div,
      .group:hover .group-hover\\:block,
      .group:hover .group-hover\\:flex {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        transform: none !important;
        height: auto !important;
        max-height: none !important;
      }
    </style>`
  const pickerHead = `${baseTag}${pickerStyle}`
  const normalizedHtml = /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>${pickerHead}`)
    : `${pickerHead}${html}`
  const pickerScript = `
    <script>
      (() => {
        let selectorMode = false;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #22c55e;background:rgba(34,197,94,.14);box-shadow:0 0 0 99999px rgba(15,23,42,.08);display:none";
        document.body.appendChild(overlay);

        const wakeLazyContent = () => {
          const assetAttrs = ["data-src", "data-original", "data-lazy-src", "data-url", "data-image", "data-bg"];
          document.querySelectorAll("img, iframe").forEach((node) => {
            for (const attr of assetAttrs) {
              const value = node.getAttribute(attr);
              if (value && !node.getAttribute("src")) {
                node.setAttribute("src", value);
                break;
              }
            }
            node.removeAttribute("loading");
            node.removeAttribute("decoding");
          });
          document.querySelectorAll("source").forEach((node) => {
            const srcset = node.getAttribute("data-srcset") || node.getAttribute("data-src");
            if (srcset && !node.getAttribute("srcset")) node.setAttribute("srcset", srcset);
          });
          document.querySelectorAll("[data-bg], [data-background], [data-bg-src]").forEach((node) => {
            const value = node.getAttribute("data-bg") || node.getAttribute("data-background") || node.getAttribute("data-bg-src");
            if (value && !node.style.backgroundImage) node.style.backgroundImage = "url('" + value + "')";
          });
          document.querySelectorAll("[data-aos], [data-animate], [data-animation], .aos-init, .wow, .animated, .fade, .fade-in, .reveal, .invisible, .lazy-hidden").forEach((node) => {
            node.style.opacity = "1";
            node.style.visibility = "visible";
            node.style.transform = "none";
          });
          window.dispatchEvent(new Event("scroll"));
          window.dispatchEvent(new Event("resize"));
        };

        wakeLazyContent();
        setTimeout(wakeLazyContent, 250);
        setTimeout(wakeLazyContent, 1000);
        setTimeout(wakeLazyContent, 2000);

        const safeCss = (value) => {
          if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
          return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
        };

        const cssPath = (element) => {
          if (!element || element.nodeType !== 1) return "";
          if (element === document.documentElement) return "html";
          if (element === document.body) return "body";
          if (element.id) return "#" + safeCss(element.id);

          const parts = [];
          let current = element;

          while (current && current.nodeType === 1 && current !== document.body) {
            let part = current.tagName.toLowerCase();
            const classes = Array.from(current.classList || [])
              .filter((item) => item && !/^[0-9]+$/.test(item))
              .slice(0, 3);

            if (classes.length) {
              part += "." + classes.map((item) => safeCss(item)).join(".");
            } else if (current.parentElement) {
              const same = Array.from(current.parentElement.children)
                .filter((item) => item.tagName === current.tagName);
              if (same.length > 1) {
                part += ":nth-of-type(" + (same.indexOf(current) + 1) + ")";
              }
            }

            parts.unshift(part);
            current = current.parentElement;
            if (parts.length >= 6) break;
          }

          return parts.join(" > ") || "body";
        };

        const isUsefulElement = (element) => {
          if (!element || element === document.documentElement) return false;
          const rect = element.getBoundingClientRect();
          const text = (element.innerText || element.textContent || "").trim();
          if (element === document.body) return Boolean(text || element.querySelector("a[href], img, main, section, article"));
          if (rect.width < 20 || rect.height < 12) return false;
          if (!text && !element.querySelector("a[href], img")) return false;
          return true;
        };

        const pickTarget = (target, exact = false) => {
          if (exact && isUsefulElement(target)) return target;

          const selectors = [
            "a[href]",
            "article",
            "li",
            "[role='article']",
            "[class*='news' i]",
            "[class*='post' i]",
            "[class*='item' i]",
            "[class*='card' i]",
            "[class*='list' i]",
            "[class*='content' i]",
            "[class*='result' i]",
            "section",
            "ul",
            "ol",
            "main",
            "table",
            "div"
          ];

          for (const selector of selectors) {
            const candidate = target.closest(selector);
            if (isUsefulElement(candidate)) return candidate;
          }

          if (target === document.body || target === document.documentElement) {
            return document.body;
          }

          return target;
        };

        const scoreCandidate = (element) => {
          if (!isUsefulElement(element)) return 0;
          const text = (element.innerText || element.textContent || "").trim();
          const links = element.querySelectorAll("a[href]").length;
          const rect = element.getBoundingClientRect();
          let score = Math.min(text.length, 2000) + links * 120;
          const className = String(element.className || "").toLowerCase();
          if (/news|xeber|xəbər|post|article|item|list|content|elan|media/.test(className)) score += 450;
          if (element.tagName && /^(MAIN|SECTION|ARTICLE|UL|OL)$/i.test(element.tagName)) score += 250;
          if (rect.width > 300 && rect.height > 120) score += 150;
          if (element === document.body) score -= 400;
          return score;
        };

        const pickAutoCandidate = () => {
          const selectors = [
            "main [class*='news' i]",
            "main [class*='post' i]",
            "main [class*='list' i]",
            "main section",
            "[class*='news' i]",
            "[class*='xeber' i]",
            "[class*='post' i]",
            "[class*='article' i]",
            "[class*='item' i]",
            "[class*='list' i]",
            "[class*='content' i]",
            "section",
            "article",
            "main"
          ];
          const candidates = [];
          selectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((node) => candidates.push(node));
          });
          const best = candidates
            .filter((node, index, list) => list.indexOf(node) === index)
            .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
          if (best && scoreCandidate(best) > 0) return best;
          return document.querySelector("main") || document.body;
        };

        const sendAutoSuggestion = () => {
          const target = pickAutoCandidate();
          const selector = cssPath(target) || "body";
          window.parent.postMessage({
            type: "visual-monitor-selector-suggested",
            selector,
            text: (target.innerText || target.textContent || "").trim().slice(0, 240),
            href: null,
            tag: target.tagName ? target.tagName.toLowerCase() : "body",
          }, "*");
        };

        setTimeout(sendAutoSuggestion, 600);
        setTimeout(sendAutoSuggestion, 1800);
        const hideOverlay = () => {
          overlay.style.display = "none";
        };

        const showOverlay = (event) => {
          if (!selectorMode) {
            hideOverlay();
            return;
          }

          const target = pickTarget(event.target, true);
          const rect = target.getBoundingClientRect();
          overlay.style.display = "block";
          overlay.style.left = rect.left + "px";
          overlay.style.top = rect.top + "px";
          overlay.style.width = rect.width + "px";
          overlay.style.height = rect.height + "px";
        };

        const openNearbyMenu = (node) => {
          const root = node?.closest?.("li, .dropdown, .nav-item, .menu-item, .has-dropdown, [class*='menu' i], [class*='nav' i]");
          if (!root) return false;
          const menu = root.querySelector("ul, ol, .dropdown-menu, .sub-menu, .submenu, [class*='dropdown' i], [class*='submenu' i]");
          if (!menu) return false;
          menu.style.display = "block";
          menu.style.opacity = "1";
          menu.style.visibility = "visible";
          menu.style.pointerEvents = "auto";
          menu.style.transform = "none";
          menu.style.height = "auto";
          menu.style.maxHeight = "none";
          root.classList.add("open", "show", "active", "visual-monitor-menu-open");
          return true;
        };
        const handleClick = (event) => {
          const link = event.target.closest("a[href]");

          if (!selectorMode) {
            if (link && link.href) {
              const href = link.getAttribute("href") || "";
              const lowerHref = href.trim().toLowerCase();
              const isInPageAction = lowerHref === "#" || lowerHref.startsWith("#") || lowerHref.startsWith("javascript:") || lowerHref.startsWith("mailto:") || lowerHref.startsWith("tel:");
              const isMenuAction = link.getAttribute("data-bs-toggle") || link.getAttribute("data-toggle") || link.getAttribute("aria-expanded") !== null || openNearbyMenu(link);
              if (isInPageAction || isMenuAction) {
                window.setTimeout(() => openNearbyMenu(link), 50);
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              window.parent.postMessage({
                type: "visual-monitor-navigate",
                url: link.href,
              }, "*");
            }
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const target = pickTarget(event.target, true);
          const selectedLink = target.closest("a[href]");

          window.parent.postMessage({
            type: "visual-monitor-selector-picked",
            selector: cssPath(target) || "body",
            text: (target.innerText || target.textContent || "").trim().slice(0, 240),
            href: selectedLink ? selectedLink.href : null,
            tag: target.tagName.toLowerCase(),
          }, "*");
        };

        window.addEventListener("message", (event) => {
          if (event.data?.type !== "visual-monitor-selector-mode") return;
          selectorMode = Boolean(event.data.enabled);
          if (!selectorMode) hideOverlay();
        });

        document.addEventListener("mouseover", showOverlay, true);
        document.addEventListener("mouseout", () => {
          if (!selectorMode) hideOverlay();
        }, true);
        document.addEventListener("click", handleClick, true);
      })();
    </script>
  `

  if (/<\/body>/i.test(normalizedHtml)) {
    return normalizedHtml.replace(/<\/body>/i, `${pickerScript}</body>`)
  }

  return `${normalizedHtml}${pickerScript}`
}

function splitSnapshotLines(text: string | null | undefined) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function buildDiffRows(
  oldText: string | null | undefined,
  newText: string | null | undefined
): DiffResult {
  const oldLines = splitSnapshotLines(oldText)
  const newLines = splitSnapshotLines(newText)
  const m = oldLines.length
  const n = newLines.length
  const dp = Array.from(
    { length: m + 1 },
    () => Array(n + 1).fill(0) as number[]
  )

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rawRows: DiffRow[] = []
  let i = 0
  let j = 0

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      rawRows.push({
        left: oldLines[i],
        right: newLines[j],
        leftTone: 'normal',
        rightTone: 'normal',
      })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rawRows.push({
        left: oldLines[i],
        right: '',
        leftTone: 'removed',
        rightTone: 'empty',
      })
      i += 1
    } else {
      rawRows.push({
        left: '',
        right: newLines[j],
        leftTone: 'empty',
        rightTone: 'added',
      })
      j += 1
    }
  }

  while (i < m) {
    rawRows.push({
      left: oldLines[i],
      right: '',
      leftTone: 'removed',
      rightTone: 'empty',
    })
    i += 1
  }

  while (j < n) {
    rawRows.push({
      left: '',
      right: newLines[j],
      leftTone: 'empty',
      rightTone: 'added',
    })
    j += 1
  }

  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let modified = 0
  let unchanged = 0

  for (let index = 0; index < rawRows.length; index += 1) {
    const current = rawRows[index]
    const next = rawRows[index + 1]

    if (current.leftTone === 'removed' && next?.rightTone === 'added') {
      rows.push({
        left: current.left,
        right: next.right,
        leftTone: 'modified',
        rightTone: 'modified',
      })
      modified += 1
      index += 1
      continue
    }

    rows.push(current)
    if (current.leftTone === 'normal' && current.rightTone === 'normal')
      unchanged += 1
    if (current.leftTone === 'removed') removed += 1
    if (current.rightTone === 'added') added += 1
  }

  return { rows, added, removed, modified, unchanged }
}

function extractLinksFromLines(lines: string[]) {
  const seen = new Set<string>()
  const links: LinkItem[] = []
  const urlRegex = /https?:\/\/[^\s)\]}>"']+/gi

  for (const line of lines) {
    const urls = line.match(urlRegex) || []
    for (const rawUrl of urls) {
      const url = rawUrl.replace(/[.,;:]+$/, '')
      if (seen.has(url)) continue
      seen.add(url)
      links.push({ title: line.replace(url, '').trim() || url, url })
    }
  }

  return links
}

function normalizeSnapshotItemUrl(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const url = new URL(raw)
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw.replace(/#.*$/, '').replace(/\/$/, '')
  }
}

function parseSnapshotItems(text: string | null | undefined): SnapshotItem[] {
  const raw = String(text || '').trim()
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    const items = Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed)
        ? parsed
        : []
    const seen = new Set<string>()

    return items
      .map((item: Record<string, unknown>) => {
        const title = String(item.title || item.text || item.name || '').trim()
        const url = String(item.url || item.link || item.href || '').trim()
        const normalizedUrl = normalizeSnapshotItemUrl(url)
        const published = String(
          item.published || item.published_at || item.date || item.time || ''
        ).trim()
        const image = String(
          item.image || item.image_url || item.thumbnail || ''
        ).trim()

        if (!title && !normalizedUrl) return null
        const key = normalizedUrl || title
        if (seen.has(key)) return null
        seen.add(key)

        return {
          title:
            title && title !== '0' ? title : normalizedUrl || t("Başlıq yoxdur"),
          url: normalizedUrl,
          published,
          image,
        }
      })
      .filter(Boolean) as SnapshotItem[]
  } catch {
    return []
  }
}

function normalizeSnapshotTitle(value: string | null | undefined) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function snapshotTitleFingerprint(value: string | null | undefined) {
  return normalizeSnapshotTitle(value)
    .replace(/[-“”"'«».,:;!?()[\]{}–—]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 96)
}

function snapshotTitleChanged(
  before: SnapshotItem | null | undefined,
  after: SnapshotItem | null | undefined
) {
  const beforeTitle = normalizeSnapshotTitle(before?.title)
  const afterTitle = normalizeSnapshotTitle(after?.title)
  return Boolean(beforeTitle && afterTitle && beforeTitle !== afterTitle)
}

function uniqueSnapshotItems(items: SnapshotItem[]) {
  const seen = new Set<string>()
  const unique: SnapshotItem[] = []

  for (const item of items) {
    const titleKey = snapshotTitleFingerprint(item.title)
    const urlKey = normalizeSnapshotItemUrl(item.url)
    const key = titleKey || urlKey
    if (!key || seen.has(key) || (urlKey && seen.has(`url:${urlKey}`))) continue
    seen.add(key)
    if (urlKey) seen.add(`url:${urlKey}`)
    unique.push(item)
  }

  return unique
}

function buildSnapshotComparisonRows(
  event: ChangeEvent,
  snapshots: Record<string, ChangeSnapshot>,
  limit = 6
): SnapshotComparisonRow[] {
  const oldSnapshot = event.old_snapshot_id
    ? snapshots[event.old_snapshot_id]
    : null
  const newSnapshot = event.new_snapshot_id
    ? snapshots[event.new_snapshot_id]
    : null
  const oldItems = uniqueSnapshotItems(
    parseSnapshotItems(oldSnapshot?.content_text)
  )
  const newItems = uniqueSnapshotItems(
    parseSnapshotItems(newSnapshot?.content_text)
  )

  if (!oldItems.length && !newItems.length) return []

  const oldByUrl = new Map(
    oldItems
      .map((item) => [normalizeSnapshotItemUrl(item.url), item] as const)
      .filter(([url]) => Boolean(url))
  )
  const oldUrlSet = new Set(oldByUrl.keys())
  const newUrlSet = new Set(
    newItems.map((item) => normalizeSnapshotItemUrl(item.url)).filter(Boolean)
  )
  const newTop = newItems.slice(0, limit)
  const rows: SnapshotComparisonRow[] = []

  for (const after of newTop) {
    const afterUrl = normalizeSnapshotItemUrl(after.url)
    const oldMatch = afterUrl ? oldByUrl.get(afterUrl) || null : null
    let status: SnapshotComparisonStatus = 'normal'

    if (afterUrl && !oldUrlSet.has(afterUrl)) {
      status = 'new'
    } else if (oldMatch && snapshotTitleChanged(oldMatch, after)) {
      status = 'changed'
    }

    rows.push({ before: oldMatch, after, status })
  }

  const existingRemovedUrls = new Set(
    rows
      .flatMap((row) => [
        normalizeSnapshotItemUrl(row.before?.url),
        normalizeSnapshotItemUrl(row.after?.url),
      ])
      .filter(Boolean)
  )

  for (const removedItem of parseConfirmedRemovedItems(event.diff_summary)) {
    const removedUrl = normalizeSnapshotItemUrl(removedItem.url)
    if (
      removedUrl &&
      (newUrlSet.has(removedUrl) || existingRemovedUrls.has(removedUrl))
    )
      continue
    rows.push({ before: removedItem, after: null, status: 'removed' })
    if (rows.length >= limit) break
  }

  return rows.slice(0, limit)
}

function getDiffToneClass(tone: DiffCellTone) {
  if (tone === 'added')
    return 'border-emerald-200 bg-emerald-50 text-emerald-950'
  if (tone === 'removed') return 'border-red-200 bg-red-50 text-red-950'
  if (tone === 'modified') return 'border-amber-200 bg-amber-50 text-amber-950'
  if (tone === 'empty')
    return 'border-transparent bg-muted/30 text-muted-foreground'
  return 'border-border bg-background text-foreground'
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'

  return new Date(value).toLocaleString(dateLocale(), {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeInputUrl(value: string) {
  const raw = value.trim()
  if (!raw) return ''
  return raw.startsWith('http://') || raw.startsWith('https://')
    ? raw
    : `https://${raw}`
}

function getDomainFromUrl(value: string) {
  try {
    return new URL(normalizeInputUrl(value)).hostname
      .replace(/^www\./, '')
      .toLowerCase()
  } catch {
    return ''
  }
}

function getDomain(source: ChangeSource) {
  if (source.domain) return source.domain
  if (!source.url) return '-'

  return (
    getDomainFromUrl(source.url) ||
    source.url.replace(/^https?:\/\//, '').split('/')[0] ||
    '-'
  )
}

function getStatusLabel(status: string | null | undefined) {
  if (status === 'active') return t("Aktiv")
  if (status === 'inactive') return t("Passiv")
  if (status === 'paused') return t("Dayandırılıb")
  if (status === 'error') return t("Xətalı")
  return status || '-'
}

function getStatusVariant(status: string | null | undefined) {
  if (status === 'active') return 'default'
  if (status === 'error') return 'destructive'
  return 'secondary'
}

function getAlertStatusLabel(status: string | null | undefined) {
  if (status === 'sent') return t("Göndərildi")
  if (status === 'pending') return t("Gözləyir")
  if (status === 'failed') return t("Xəta")
  return status || 'Alert yoxdur'
}

function parseChangeSummaryForNotification(summary: string | null | undefined) {
  const text = String(summary || '').trim()
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const urlMatch = text.match(/https?:\/\/[^\s)\]}>'"]+/i)
  const itemUrl = urlMatch ? urlMatch[0].replace(/[.,;:]+$/, '') : ''

  const readValueAfterLabel = (labels: string[]) => {
    const index = lines.findIndex((line) =>
      labels.some((label) => line.toLowerCase().startsWith(label.toLowerCase()))
    )
    if (index < 0) return ''
    const inline = lines[index].replace(/^.*?:\s*/, '').trim()
    return inline || lines[index + 1] || ''
  }

  let title = readValueAfterLabel([t("Başlıq:"), 'Title:'])
  let published = readValueAfterLabel([
    t("Saytda yayımlandığı tarix:"),
    t("Yayımlanma vaxtı:"),
    'Published:',
  ])

  if (!title) {
    const itemLine =
      lines.find((line) => line.startsWith('- ') || line.startsWith('• ')) || ''
    if (itemLine) {
      const withoutBullet = itemLine.replace(/^[-•]\s*/, '').trim()
      const pieces = withoutBullet
        .split(' — ')
        .map((piece) => piece.trim())
        .filter(Boolean)
      title = pieces[0] || withoutBullet
      if (!published && pieces.length > 2)
        published = pieces.slice(2).join(' — ')
    }
  }

  if (itemUrl && title)
    title = title
      .replace(itemUrl, '')
      .replace(/[—-]\s*$/, '')
      .trim()

  return {
    title: title || text || t("Dəyişiklik tapılıb."),
    itemUrl,
    published,
  }
}

function hasError(source: ChangeSource) {
  return (
    Boolean(source.last_error) ||
    (source.consecutive_fail_count || 0) > 0 ||
    source.status === 'error'
  )
}

function getReadableWatchError(error: string | null | undefined) {
  const code = (error || '').trim()
  if (!code) return ''
  const lower = code.toLowerCase()

  if (lower === 'selector_missing') {
    return t("Selector səhifədə tapılmadı. Saytın quruluşu dəyişib və ya seçilən hissə başqa bölmədədir. Selectoru yenidən seç.")
  }
  if (lower === 'empty_content') {
    return t("Selector tapıldı, amma oxunaqlı mətn və ya link çıxmadı. Daha geniş xəbər bloku seçilməlidir.")
  }
  if (lower === 'http_403') {
    return t("Sayt botun sorğusunu bloklayır (403). Sistem browser kimi təkrar yoxlayacaq; davam edərsə həmin səhifə server tərəfindən qorunur.")
  }
  if (lower === 'http_429') {
    return t("Sayt çox sorğuya görə müvəqqəti məhdudlaşdırıb (429). Interval artırılmalı və ya gözlənilməlidir.")
  }
  if (lower === 'timeout') {
    return t("Sayt vaxtında cavab vermədi. Səhifə yavaşdır və ya müvəqqəti əlçatmazdır.")
  }
  if (lower === 'network_error') {
    return t("Sayta qoşulmaq mümkün olmadı. Domen, SSL və ya şəbəkə problemi ola bilər.")
  }
  if (lower === 'unsupported_content_type') {
    return t("Bu URL HTML səhifə kimi oxunmadı. İzləmə üçün normal səhifə URL-i seçilməlidir.")
  }
  if (lower.startsWith('http_')) {
    return t("Sayt HTTP xəta qaytardı ({0}). URL və seçilən səhifə yoxlanmalıdır.", [code])
  }
  return code
}

function getWatchDiagnostic(
  source: ChangeSource,
  event?: ChangeEvent | null,
  hasSnapshot = false
) {
  if (source.status !== 'active') {
    return {
      label: 'Passivdir',
      tone: 'muted' as const,
      reason: t("Bu izləmə hazırda aktiv deyil. Bot passiv izləmələri yoxlamır."),
    }
  }

  if (!source.selector?.trim()) {
    return {
      label: 'Selector yoxdur',
      tone: 'danger' as const,
      reason: t("İzlənəcək hissə seçilməyib. Saytı aç və selector seç."),
    }
  }

  if (source.last_error) {
    return {
      label: t("Xəta var"),
      tone: 'danger' as const,
      reason: getReadableWatchError(source.last_error),
    }
  }

  if ((source.consecutive_fail_count || 0) > 0) {
    return {
      label: t("Yoxlama alınmayıb"),
      tone: 'warning' as const,
      reason: t("{0} uğursuz yoxlama var. Selector və URL yoxlanmalıdır.", [source.consecutive_fail_count || 0]),
    }
  }

  if (event) {
    return {
      label: t("Dəyişiklik tapılıb"),
      tone: 'success' as const,
      reason: t("Bu izləmə üçün dəyişiklik hadisəsi var."),
    }
  }

  if (hasSnapshot) {
    return {
      label: t("Snapshot var"),
      tone: 'info' as const,
      reason:
        t("Bot seçilmiş hissəni oxuyub. Hələ yeni dəyişiklik hadisəsi yaranmayıb."),
    }
  }

  if (!source.last_checked_at) {
    return {
      label: t("Hələ yoxlanmayıb"),
      tone: 'warning' as const,
      reason:
        t("Bot bu izləməni hələ yoxlamayıb və baseline snapshot yaratmayıb."),
    }
  }

  return {
    label: t("Snapshot gözlənilir"),
    tone: 'warning' as const,
    reason:
      t("Bot yoxlama aparıb, amma bu izləmə üçün snapshot tapılmadı. Selector boş nəticə verə bilər."),
  }
}

function getDiagnosticBadgeClass(
  tone: 'success' | 'info' | 'warning' | 'danger' | 'muted'
) {
  if (tone === 'success')
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (tone === 'info') return 'border-sky-200 bg-sky-50 text-sky-700'
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (tone === 'danger') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-border bg-muted/50 text-muted-foreground'
}

function getWatchStatusBadge(
  source: ChangeSource,
  latestEvent?: ChangeEvent | null,
  hasSnapshot = false
) {
  if (source.last_error || source.status === 'error') {
    return {
      label: t("Xəta"),
      className: 'border-red-200 bg-red-50 text-red-700',
    }
  }

  if (
    (source.consecutive_fail_count || 0) > 0 ||
    !source.selector?.trim() ||
    (!source.last_checked_at && source.status === 'active')
  ) {
    return {
      label: t("Xəbərdarlıq"),
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    }
  }

  if (latestEvent) {
    return {
      label: t("Dəyişib"),
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    }
  }

  if (hasSnapshot || source.last_checked_at || source.last_success_at) {
    return {
      label: t("Dəyişiklik yoxdur"),
      className: 'border-sky-200 bg-sky-50 text-sky-700',
    }
  }

  return {
    label: t("Sağlam"),
    className: 'border-border bg-muted/50 text-foreground',
  }
}

function comparableSnapshotItem(item: SnapshotItem) {
  return {
    title: String(item.title || '').trim(),
    published: String(item.published || '').trim(),
    image: String(item.image || '').trim(),
  }
}

function compareSnapshotItems(
  oldText: string | null | undefined,
  newText: string | null | undefined
): SnapshotItemCompare {
  const oldItems = parseSnapshotItems(oldText)
  const newItems = parseSnapshotItems(newText)
  const oldByUrl = new Map(
    oldItems
      .filter((item) => item.url)
      .map((item) => [normalizeSnapshotItemUrl(item.url), item])
  )
  const newByUrl = new Map(
    newItems
      .filter((item) => item.url)
      .map((item) => [normalizeSnapshotItemUrl(item.url), item])
  )

  const added: SnapshotItem[] = []
  const changed: SnapshotItemChange[] = []

  for (const [url, item] of newByUrl) {
    const oldItem = oldByUrl.get(url)
    if (!oldItem) {
      added.push(item)
      continue
    }
    if (
      JSON.stringify(comparableSnapshotItem(oldItem)) !==
      JSON.stringify(comparableSnapshotItem(item))
    ) {
      changed.push({ before: oldItem, after: item })
    }
  }

  // A URL missing from the current selected list is not necessarily deleted.
  // It may simply have moved to another page after newer content appeared.
  // Real removals are counted by the worker only after URL availability checks.
  return { added, removed: [], changed }
}

function parseSummaryCount(summary: string | null | undefined, label: string) {
  const match = String(summary || '').match(
    new RegExp(`${label}:\\s*(\\d+)`, 'i')
  )
  return match ? Number(match[1]) || 0 : 0
}

function parseConfirmedRemovedItems(
  summary: string | null | undefined
): SnapshotItem[] {
  const lines = String(summary || '').split(/\r?\n/)
  const startIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === 'təsdiqlənmiş silinən linklər:'
  )
  if (startIndex < 0) return []

  const items: SnapshotItem[] = []
  for (const line of lines.slice(startIndex + 1)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('- ')) break
    const content = trimmed.slice(2)
    const match = content.match(/^(.*?)\s+—\s+(https?:\/\/\S+)(?:\s+—\s+.*)?$/)
    items.push({
      title: match?.[1]?.trim() || content,
      url: match?.[2]?.trim() || '',
    })
  }
  return items
}

function parseNotificationTarget(
  summary: string | null | undefined,
  sourceUrl: string | null | undefined
) {
  const text = String(summary || '')
  const addedMatch = text.match(
    /Yeni linklər:\s*\n-\s*(.*?)\s+—\s+(https?:\/\/\S+)/i
  )
  if (addedMatch) {
    return {
      kind: 'new' as const,
      title: addedMatch[1]?.trim() || t("Yeni məlumat əlavə olunub"),
      summary: t("Yeni məlumat əlavə olunub."),
      url: addedMatch[2]?.trim() || null,
    }
  }

  const removedMatch = text.match(
    /Təsdiqlənmiş silinən linklər:\s*\n-\s*(.*?)\s+—\s+(https?:\/\/\S+)/i
  )
  if (removedMatch) {
    return {
      kind: 'removed' as const,
      title: removedMatch[1]?.trim() || t("Məlumat silinib"),
      summary: t("Əvvəl mövcud olan məlumat artıq saytda tapılmadı."),
      url: removedMatch[2]?.trim() || sourceUrl || null,
    }
  }

  const changedCount = parseSummaryCount(text, t("Dəyişən"))
  if (changedCount > 0) {
    return {
      kind: 'changed' as const,
      title: t("Məlumatda dəyişiklik var"),
      summary: t("{0} məlumatda dəyişiklik aşkarlanıb.", [changedCount]),
      url: sourceUrl || null,
    }
  }

  return {
    kind: 'generic' as const,
    title: t("Dəyişiklik bildirişi"),
    summary: t("Yeni dəyişiklik bildirişi var."),
    url: sourceUrl || null,
  }
}
function getEventItemCompare(
  event: ChangeEvent,
  snapshots: Record<string, ChangeSnapshot>
): SnapshotItemCompare {
  const oldSnapshot = event.old_snapshot_id
    ? snapshots[event.old_snapshot_id]
    : null
  const newSnapshot = event.new_snapshot_id
    ? snapshots[event.new_snapshot_id]
    : null
  const compare = compareSnapshotItems(
    oldSnapshot?.content_text,
    newSnapshot?.content_text
  )

  if (oldSnapshot || newSnapshot) {
    const confirmedRemovedItems = parseConfirmedRemovedItems(event.diff_summary)
    const realRemovedCount = parseSummaryCount(event.diff_summary, t("Silinən"))
    return {
      ...compare,
      removed:
        confirmedRemovedItems.length > 0
          ? confirmedRemovedItems
          : Array.from({ length: realRemovedCount }, (_, index) => ({
              title: t("Təsdiqlənmiş silinən element {0}", [index + 1]),
              url: '',
            })),
    }
  }

  return {
    added: Array.from(
      { length: parseSummaryCount(event.diff_summary, t("Əlavə olunan")) },
      (_, index) => ({
        title: t("Yeni paylaşım {0}", [index + 1]),
        url: '',
      })
    ),
    removed: Array.from(
      { length: parseSummaryCount(event.diff_summary, t("Silinən")) },
      (_, index) => ({
        title: t("Silinən element {0}", [index + 1]),
        url: '',
      })
    ),
    changed: Array.from(
      { length: parseSummaryCount(event.diff_summary, t("Dəyişən")) },
      (_, index) => ({
        before: { title: t("Əvvəlki element {0}", [index + 1]), url: '' },
        after: { title: t("Dəyişən element {0}", [index + 1]), url: '' },
      })
    ),
  }
}

function getSourceDisplayName(source: ChangeSource | null) {
  if (!source) return t("Mənbə")
  return (
    source.name ||
    source.domain ||
    getDomainFromUrl(source.url || '') ||
    t("Mənbə")
  )
}

function sourceToForm(source: ChangeSource): SourceFormState {
  return {
    name: source.name || '',
    url: source.url || '',
    selector: source.selector || '',
    interval_minutes: String(source.interval_minutes || 5),
    telegram_chat_id: source.telegram_chat_id || '',
    status:
      source.status === 'inactive' || source.status === 'paused'
        ? source.status
        : 'active',
  }
}

function validateForm(form: SourceFormState) {
  const name = form.name.trim()
  const url = form.url.trim()
  const selector = form.selector.trim()
  const interval = Number(form.interval_minutes)

  if (!name) return t("İzləmə adı yazılmalıdır.")
  if (!url) return t("URL yazılmalıdır.")
  if (!getDomainFromUrl(url)) return t("URL düzgün formatda deyil.")
  if (!selector) return t("CSS selector yazılmalıdır.")
  if (!Number.isFinite(interval) || interval < 5)
    return t("Interval ən azı 5 dəqiqə olmalıdır.")

  return ''
}

function ChangeMonitorPage() {
  const isMobile = useIsMobile()
  const [sources, setSources] = useState<ChangeSource[]>([])
  const [events24h, setEvents24h] = useState<ChangeEvent[]>([])
  const [recentEvents, setRecentEvents] = useState<ChangeEvent[]>([])
  const [alerts, setAlerts] = useState<ChangeAlert[]>([])
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [readAlertIds, setReadAlertIds] = useState<string[]>(readStoredAlertIds)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<ChangeSource | null>(null)
  const [form, setForm] = useState<SourceFormState>(emptyForm)
  const [formError, setFormError] = useState('')
  const [visualOpen, setVisualOpen] = useState(false)
  const [visualHtml, setVisualHtml] = useState('')
  const [visualLoading, setVisualLoading] = useState(false)
  const [visualMessage, setVisualMessage] = useState('')
  const [selectorMode, setSelectorMode] = useState(false)
  const [pickedElement, setPickedElement] = useState<PickedElement | null>(null)
  const [selectorTestResult, setSelectorTestResult] =
    useState<SelectorTestResult | null>(null)
  const [selectorTesting, setSelectorTesting] = useState(false)
  const [currentVisualUrl, setCurrentVisualUrl] = useState('')
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [activeFilter, setActiveFilter] = useState<WatchFilter>('all')
  const [deleting, setDeleting] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailSource, setDetailSource] = useState<ChangeSource | null>(null)
  const [detailEvent, setDetailEvent] = useState<ChangeEvent | null>(null)
  const [detailOldSnapshot, setDetailOldSnapshot] =
    useState<ChangeSnapshot | null>(null)
  const [detailNewSnapshot, setDetailNewSnapshot] =
    useState<ChangeSnapshot | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [expandedDetails, setExpandedDetails] = useState<
    Record<string, ExpandedSourceDetails>
  >({})
  const [expandedLoading, setExpandedLoading] = useState<
    Record<string, boolean>
  >({})
  const [expandedErrors, setExpandedErrors] = useState<Record<string, string>>(
    {}
  )
  const [expandedViewModes, setExpandedViewModes] = useState<
    Record<string, SnapshotViewMode>
  >({})
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const previousUnreadCountRef = useRef<number | null>(null)
  const extensionSaveInFlightRef = useRef<Set<string>>(new Set())
  const lastExtensionSaveRef = useRef<{ key: string; at: number } | null>(null)
  const [currentAccess, setCurrentAccess] =
    useState<ChangeMonitorAccess | null>(null)

  function playNotificationSound() {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!AudioContextClass) return

      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(880, context.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(
        1320,
        context.currentTime + 0.08
      )
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.24)
      window.setTimeout(() => void context.close(), 320)
    } catch {
      // Browsers may block sound until the user interacts with the page.
    }
  }

  function persistReadAlertIds(nextIds: string[]) {
    const uniqueIds = Array.from(new Set(nextIds)).slice(-300)
    setReadAlertIds(uniqueIds)
    try {
      window.localStorage.setItem(
        'visual-customer-change-monitor-read-alerts',
        JSON.stringify(uniqueIds)
      )
    } catch {
      // Local read state is a UI convenience; ignore storage failures.
    }
  }

  async function requireChangeMonitorAccess() {
    if (currentAccess) return currentAccess

    const sessionProfile = await getCurrentSupabaseProfile()
    if (!sessionProfile.user) {
      throw new Error(t("Sessiya tapılmadı. Yenidən daxil olun."))
    }

    const role = sessionProfile.profile?.role || 'customer'
    const access = {
      userId: sessionProfile.user.id,
      isAdmin: role === 'admin' || role === 'superadmin',
    }
    setCurrentAccess(access)
    return access
  }
  async function loadData() {
    setLoading(true)
    setError('')

    try {
      const access = await requireChangeMonitorAccess()
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const sourcesQuery = supabase
        .from('change_sources')
        .select(
          'id,user_id,name,url,domain,selector,status,interval_minutes,telegram_chat_id,next_check_at,last_checked_at,last_changed_at,last_success_at,last_error,consecutive_fail_count,content_hash,created_at,updated_at'
        )
        .eq('user_id', access.userId)
        .order('created_at', { ascending: false })

      const sourcesRes = await sourcesQuery

      if (sourcesRes.error) {
        setError(t("İzləmələr oxunmadı: {0}", [friendlyError(sourcesRes.error)]))
        return
      }

      const loadedSources = (sourcesRes.data || []) as ChangeSource[]
      const sourceIds = loadedSources.map((source) => source.id)

      setSources(loadedSources)
      setSelectedSourceIds((current) =>
        current.filter((id) => sourceIds.includes(id))
      )

      if (sourceIds.length === 0) {
        setEvents24h([])
        setRecentEvents([])
        setAlerts([])
        return
      }

      const [eventsRes, recentEventsRes, alertsRes] = await Promise.all([
        supabase
          .from('change_events')
          .select('id,source_id,created_at')
          .in('source_id', sourceIds)
          .gte('created_at', since24h)
          .order('created_at', { ascending: false }),
        supabase
          .from('change_events')
          .select(
            'id,source_id,old_snapshot_id,new_snapshot_id,old_hash,new_hash,diff_summary,created_at'
          )
          .in('source_id', sourceIds)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('change_alerts')
          .select('id,event_id,source_id,status,created_at,sent_at,error')
          .in('source_id', sourceIds)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      if (eventsRes.error) {
        setError(t("Dəyişiklik tarixçəsi oxunmadı: {0}", [friendlyError(eventsRes.error)]))
        return
      }
      if (recentEventsRes.error) {
        setError(t("Son nəticələr oxunmadı: {0}", [friendlyError(recentEventsRes.error)]))
        return
      }
      if (alertsRes.error) {
        setError(t("Bildirişlər oxunmadı: {0}", [friendlyError(alertsRes.error)]))
        return
      }

      setEvents24h((eventsRes.data || []) as ChangeEvent[])
      setRecentEvents((recentEventsRes.data || []) as ChangeEvent[])
      setAlerts((alertsRes.data || []) as ChangeAlert[])
    } catch (err) {
      setError(friendlyError(err, t("İzləmələr oxunmadı.")))
    } finally {
      setLoading(false)
    }
  }
  function resetVisualPicker() {
    setVisualOpen(false)
    setVisualHtml('')
    setVisualMessage('')
    setVisualLoading(false)
    setSelectorMode(false)
    setPickedElement(null)
    setSelectorTestResult(null)
    setSelectorTesting(false)
    setCurrentVisualUrl('')
  }

  function openCreateDialog() {
    setEditingSource(null)
    setForm(emptyForm)
    setFormError('')
    resetVisualPicker()
    setDialogOpen(true)
  }

  function openEditDialog(source: ChangeSource) {
    setEditingSource(source)
    setForm(sourceToForm(source))
    setFormError('')
    resetVisualPicker()
    setDialogOpen(true)
  }

  function updateForm<K extends keyof SourceFormState>(
    key: K,
    value: SourceFormState[K]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function openInBrowserForExtension() {
    const rawUrl = normalizeInputUrl(form.url)
    if (!rawUrl || !getDomainFromUrl(rawUrl)) {
      toast.error(t("Əvvəl düzgün domen və ya URL yaz. Məsələn: apa.az"))
      return
    }

    if (rawUrl !== form.url.trim()) {
      updateForm('url', rawUrl)
    }

    const domain = getDomainFromUrl(rawUrl)
    if (!form.name.trim() && domain) {
      updateForm('name', domain)
    }

    openExternalUrl(rawUrl)
    toast.message(
      t("Sayt yeni tabda açıldı. Extension panelindən Selector seç düyməsini istifadə et.")
    )
  }

  function publishExtensionSaveResult(
    payload: { selector?: string; pageUrl?: string; selectedAt?: string },
    status: 'saved' | 'exists' | 'error',
    message: string
  ) {
    window.postMessage(
      {
        type: 'visual-monitor-extension-save-result',
        payload: {
          status,
          message,
          selector: payload.selector || '',
          pageUrl: payload.pageUrl || '',
          selectedAt: payload.selectedAt || '',
        },
      },
      '*'
    )
  }

  async function saveExtensionSelection(payload: {
    selector?: string
    text?: string
    href?: string | null
    tag?: string
    pageUrl?: string
    pageTitle?: string
    selectedAt?: string
  }) {
    const selector = String(payload.selector || '').trim()
    const url = normalizeInputUrl(payload.pageUrl || form.url)
    const domain = getDomainFromUrl(url)
    const dedupeKey = `${url}::${selector}`

    if (!url || !domain || !selector) {
      const message = t("Selector saxlanmadı: URL və selector məlumatı tam deyil.")
      toast.error(message)
      publishExtensionSaveResult(payload, 'error', message)
      return
    }

    const lastSave = lastExtensionSaveRef.current
    if (
      extensionSaveInFlightRef.current.has(dedupeKey) ||
      (lastSave?.key === dedupeKey && Date.now() - lastSave.at < 5000)
    ) {
      publishExtensionSaveResult(
        payload,
        'exists',
        t("Bu selector artıq emal olunur.")
      )
      return
    }

    extensionSaveInFlightRef.current.add(dedupeKey)
    window.setTimeout(() => {
      extensionSaveInFlightRef.current.delete(dedupeKey)
    }, 10000)

    let access: ChangeMonitorAccess
    try {
      access = await requireChangeMonitorAccess()
    } catch (err) {
      const message =
        friendlyError(err, t("Sessiya tapılmadı. Yenidən daxil olun."))
      toast.error(message)
      publishExtensionSaveResult(payload, 'error', message)
      return
    }

    const interval = Math.max(5, Number(form.interval_minutes) || 5)
    const name =
      String(payload.pageTitle || form.name || domain).trim() || domain

    const existingQuery = supabase
      .from('change_sources')
      .select('id')
      .eq('url', url)
      .eq('selector', selector)
      .eq('user_id', access.userId)
      .limit(1)

    const { data: existing, error: existingError } = await existingQuery

    if (existingError) {
      const message = t("İzləmə yoxlanmadı: {0}", [friendlyError(existingError)])
      toast.error(message)
      publishExtensionSaveResult(payload, 'error', message)
      return
    }

    if (existing?.length) {
      const message = t("Bu hissə artıq bazada var.")
      toast.message(message)
      publishExtensionSaveResult(payload, 'exists', message)
      await loadData()
      lastExtensionSaveRef.current = { key: dedupeKey, at: Date.now() }
      extensionSaveInFlightRef.current.delete(dedupeKey)
      return
    }

    const { error: insertError } = await supabase
      .from('change_sources')
      .insert({
        user_id: access.userId,
        name,
        url,
        domain,
        selector,
        interval_minutes: interval,
        telegram_chat_id: form.telegram_chat_id.trim() || null,
        status: 'active',
        next_check_at: new Date().toISOString(),
        consecutive_fail_count: 0,
        last_error: null,
      })

    if (insertError) {
      const message = t("İzləmə əlavə edilmədi: {0}", [friendlyError(insertError)])
      toast.error(message)
      publishExtensionSaveResult(payload, 'error', message)
      return
    }

    setDialogOpen(false)
    setEditingSource(null)
    setForm(emptyForm)
    resetVisualPicker()
    const message = t("İzləmə siyahısına əlavə edildi.")
    toast.success(message)
    publishExtensionSaveResult(payload, 'saved', message)
    lastExtensionSaveRef.current = { key: dedupeKey, at: Date.now() }
    extensionSaveInFlightRef.current.delete(dedupeKey)
    await loadData()
  }
  async function loadVisualPage(nextUrl?: string) {
    const rawUrl = normalizeInputUrl(nextUrl || form.url)
    if (!rawUrl || !getDomainFromUrl(rawUrl)) {
      setVisualMessage(t("Əvvəl düzgün domen və ya URL yaz. Məsələn: apa.az"))
      setVisualOpen(true)
      return
    }

    if (rawUrl !== form.url.trim()) {
      updateForm('url', rawUrl)
    }

    const domain = getDomainFromUrl(rawUrl)
    if (!form.name.trim() && domain) {
      updateForm('name', domain)
    }

    setVisualOpen(true)
    setVisualLoading(true)
    setSelectorMode(false)
    setVisualMessage(t("Sayt açılır..."))
    setPickedElement(null)
    setSelectorTestResult(null)
    setCurrentVisualUrl(rawUrl)

    const { data, error: invokeError } = await supabase.functions.invoke(
      'selector-proxy',
      {
        body: { url: rawUrl },
      }
    )

    if (invokeError) {
      setVisualHtml('')
      setVisualMessage(
        t("Proxy xətası: {0}. Sayt pəncərədə açılmırsa, \"Saytı ayrıca aç\" düyməsi ilə brauzer extension-dan selector seçin.", [friendlyError(invokeError)])
      )
      setVisualLoading(false)
      return
    }

    if (!data?.html) {
      setVisualHtml('')
      setVisualMessage(
        data?.error
          ? t("{0} Sayt pəncərədə açılmırsa, \"Saytı ayrıca aç\" düyməsi ilə brauzer extension-dan selector seçin.", [data.error])
          : t("Sayt pəncərədə göstərilə bilmədi. \"Saytı ayrıca aç\" düyməsi ilə brauzer extension-dan selector seçin.")
      )
      setVisualLoading(false)
      return
    }

    setCurrentVisualUrl(data.finalUrl || rawUrl)
    setVisualHtml(buildPickerHtml(data.html, data.finalUrl || rawUrl))
    setVisualMessage(
      t("Sayt açıldı. Bölmələrə daxil ola bilərsən; seçmək üçün selector rejimini aktiv et.")
    )
    setVisualLoading(false)
  }

  async function saveSource(nextForm = form) {
    const validationError = validateForm(nextForm)
    if (validationError) {
      setFormError(validationError)
      return false
    }

    setSaving(true)
    setFormError('')

    let access: ChangeMonitorAccess
    try {
      access = await requireChangeMonitorAccess()
    } catch (err) {
      const message =
        friendlyError(err, t("Sessiya tapılmadı. Yenidən daxil olun."))
      setSaving(false)
      setFormError(message)
      toast.error(message)
      return false
    }

    const url = normalizeInputUrl(nextForm.url)
    const interval = Math.max(5, Number(nextForm.interval_minutes))
    const payload = {
      user_id: access.userId,
      name: nextForm.name.trim(),
      url,
      domain: getDomainFromUrl(url),
      selector: nextForm.selector.trim(),
      interval_minutes: interval,
      telegram_chat_id: nextForm.telegram_chat_id.trim() || null,
      status: nextForm.status,
      next_check_at: new Date().toISOString(),
      consecutive_fail_count: 0,
      last_error: null,
    }

    const response = editingSource
      ? await supabase
          .from('change_sources')
          .update(payload)
          .eq('id', editingSource.id)
          .eq('user_id', access.userId)
      : await supabase.from('change_sources').insert(payload)

    setSaving(false)

    if (response.error) {
      const message = editingSource
        ? t("İzləmə yenilənmədi: {0}", [friendlyError(response.error)])
        : t("İzləmə əlavə edilmədi: {0}", [friendlyError(response.error)])
      setFormError(message)
      toast.error(message)
      return false
    }

    toast.success(
      editingSource ? t("İzləmə yeniləndi.") : t("Yeni veb izləmə əlavə edildi.")
    )
    setDialogOpen(false)
    setEditingSource(null)
    setForm(emptyForm)
    resetVisualPicker()
    await loadData()
    return true
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await saveSource()
  }

  async function testPickedSelector(picked = pickedElement) {
    if (!picked?.selector) {
      toast.error(t("Əvvəl izlənəcək hissəni seç."))
      return null
    }

    const url = currentVisualUrl || normalizeInputUrl(form.url)
    if (!url || !getDomainFromUrl(url)) {
      toast.error(t("Selectoru test etmək üçün düzgün URL lazımdır."))
      return null
    }

    setSelectorTesting(true)
    setVisualMessage('Selector test edilir...')

    const { data, error: invokeError } = await supabase.functions.invoke(
      'change-selector-test',
      {
        body: { url, selector: picked.selector },
      }
    )

    const result: SelectorTestResult = {
      ok: Boolean(data?.ok) && Number(data?.matchedCount || 0) > 0,
      matchedCount: Number(data?.matchedCount || 0),
      previewText: String(data?.previewText || ''),
      error: invokeError
        ? friendlyError(invokeError)
        : data?.error
          ? friendlyError({ message: data.error }, t("Seçilmiş hissə oxunmadı. Daha dəqiq element seçin."))
          : null,
    }

    setSelectorTesting(false)
    setSelectorTestResult(result)

    if (!result.ok) {
      setVisualMessage(
        result.error || t("Seçilmiş hissə oxunmadı. Daha dəqiq element seçin.")
      )
      return result
    }

    setVisualMessage(
      t("Selector işləyir: {0} uyğun element tapıldı.", [result.matchedCount])
    )
    return result
  }

  function adjustVisualSelection(direction: 'parent' | 'child') {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'visual-monitor-selector-adjust', direction },
      '*'
    )
  }

  async function handleConfirmSelector() {
    if (!pickedElement?.selector) {
      toast.error(t("Əvvəl izlənəcək hissəni seç."))
      return
    }

    const result =
      selectorTestResult?.ok && selectorTestResult.matchedCount > 0
        ? selectorTestResult
        : await testPickedSelector(pickedElement)

    if (!result?.ok || result.matchedCount < 1) {
      toast.error(t("Seçilmiş hissə boşdur. Başqa element seçin."))
      return
    }

    const nextForm = { ...form, selector: pickedElement.selector }
    setForm(nextForm)
    setVisualOpen(false)
    setSelectorMode(false)
    setVisualMessage('')

    if (editingSource) {
      const saved = await saveSource(nextForm)
      if (saved) toast.success(t("Selector bazaya yazıldı."))
      return
    }

    toast.success(t("Selector formaya yazıldı. İndi izləməni yadda saxla."))
  }

  function toggleSourceSelection(sourceId: string, checked: boolean) {
    setSelectedSourceIds((current) =>
      checked
        ? Array.from(new Set([...current, sourceId]))
        : current.filter((id) => id !== sourceId)
    )
  }

  function toggleAllSources(checked: boolean, visibleSources = sources) {
    setSelectedSourceIds(
      checked ? visibleSources.map((source) => source.id) : []
    )
  }

  function isMissingDeleteRpcError(message: string) {
    const normalized = message.toLowerCase()
    return (
      normalized.includes('delete_user_change_source') &&
      (normalized.includes('schema cache') ||
        normalized.includes('could not find the function') ||
        normalized.includes('pgrst202'))
    )
  }

  async function deleteSourceWithFallback(sourceId: string, userId: string) {
    const rpcResult = await supabase.rpc('delete_user_change_source', {
      p_source_id: sourceId,
    })

    if (!rpcResult.error) return null

    const rpcMessage = rpcResult.error.message || ''
    if (!isMissingDeleteRpcError(rpcMessage)) return rpcResult.error

    const { error: deleteError } = await supabase
      .from('change_sources')
      .delete()
      .eq('id', sourceId)
      .eq('user_id', userId)

    return deleteError || null
  }

  async function deleteSources(sourceIds: string[]) {
    const ids = Array.from(new Set(sourceIds)).filter(Boolean)
    if (ids.length === 0) return

    const confirmed = window.confirm(
      ids.length === 1
        ? t("Bu izləmə silinsin? Bu əməliyyat geri qaytarılmır.")
        : t("{0} izləmə silinsin? Bu əməliyyat geri qaytarılmır.", [ids.length])
    )
    if (!confirmed) return

    let access: ChangeMonitorAccess
    try {
      access = await requireChangeMonitorAccess()
    } catch (err) {
      const message =
        friendlyError(err, t("Sessiya tapılmadı. Yenidən daxil olun."))
      toast.error(message)
      setError(message)
      return
    }

    setDeleting(true)
    const deleteErrors: string[] = []
    try {
      for (const id of ids) {
        const error = await deleteSourceWithFallback(id, access.userId)
        if (error) deleteErrors.push(friendlyError(error))
      }
    } catch (err) {
      deleteErrors.push(
        friendlyError(err, t("İzləmə silinmədi."))
      )
    } finally {
      setDeleting(false)
    }

    if (deleteErrors.length > 0) {
      const message = t("İzləmə silinmədi: {0}", [deleteErrors[0]])
      toast.error(message)
      setError(message)
      return
    }

    toast.success(
      ids.length === 1 ? t("İzləmə silindi.") : t("{0} izləmə silindi.", [ids.length])
    )
    setSelectedSourceIds((current) => current.filter((id) => !ids.includes(id)))
    await loadData()
  }

  async function toggleSourceStatus(source: ChangeSource) {
    const currentStatus = source.status === 'active' ? 'active' : 'inactive'
    const nextStatus = currentStatus === 'active' ? 'inactive' : 'active'

    let access: ChangeMonitorAccess
    try {
      access = await requireChangeMonitorAccess()
    } catch (err) {
      const message =
        friendlyError(err, t("Sessiya tapılmadı. Yenidən daxil olun."))
      toast.error(message)
      setError(message)
      return
    }

    const statusQuery = supabase
      .from('change_sources')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', source.id)
      .eq('user_id', access.userId)

    const { error: statusError } = await statusQuery

    if (statusError) {
      const message = t("Status dəyişmədi: {0}", [friendlyError(statusError)])
      toast.error(message)
      setError(message)
      return
    }

    toast.success(
      nextStatus === 'active' ? t("İzləmə aktiv edildi.") : t("İzləmə passiv edildi.")
    )
    setSources((current) =>
      current.map((item) =>
        item.id === source.id
          ? {
              ...item,
              status: nextStatus,
              updated_at: new Date().toISOString(),
            }
          : item
      )
    )
  }
  async function openEventDetails(event: ChangeEvent) {
    const source = sources.find((item) => item.id === event.source_id) || null
    setDetailOpen(true)
    setDetailSource(source)
    setDetailEvent(event)
    setDetailOldSnapshot(null)
    setDetailNewSnapshot(null)
    setDetailError('')
    setDetailLoading(true)

    const snapshotIds = [event.old_snapshot_id, event.new_snapshot_id].filter(
      Boolean
    ) as string[]
    if (snapshotIds.length === 0) {
      setDetailError(t("Bu nəticə üçün snapshot məlumatı tapılmadı."))
      setDetailLoading(false)
      return
    }

    const { data: snapshotData, error: snapshotError } = await supabase
      .from('change_snapshots')
      .select('id,source_id,content_text,content_hash,captured_at')
      .in('id', snapshotIds)

    if (snapshotError) {
      setDetailError(t("Snapshot məlumatı oxunmadı: {0}", [friendlyError(snapshotError)]))
      setDetailLoading(false)
      return
    }

    const snapshots = (snapshotData || []) as ChangeSnapshot[]
    setDetailOldSnapshot(
      snapshots.find((item) => item.id === event.old_snapshot_id) || null
    )
    setDetailNewSnapshot(
      snapshots.find((item) => item.id === event.new_snapshot_id) || null
    )
    setDetailLoading(false)
  }

  async function toggleInlineDetails(source: ChangeSource) {
    if (expandedSourceId === source.id) {
      setExpandedSourceId(null)
      return
    }

    setExpandedSourceId(source.id)
    if (expandedLoading[source.id]) return

    setExpandedLoading((current) => ({ ...current, [source.id]: true }))
    setExpandedErrors((current) => ({ ...current, [source.id]: '' }))

    try {
      const { data: eventData, error: eventError } = await supabase
        .from('change_events')
        .select(
          'id,source_id,old_snapshot_id,new_snapshot_id,old_hash,new_hash,diff_summary,created_at'
        )
        .eq('source_id', source.id)
        .order('created_at', { ascending: false })
        .limit(10)

      if (eventError)
        throw new Error(t("Dəyişiklik nəticəsi oxunmadı: {0}", [friendlyError(eventError)]))

      const events = (eventData || []) as ChangeEvent[]
      const snapshotIds = Array.from(
        new Set(
          events
            .flatMap((event) => [event.old_snapshot_id, event.new_snapshot_id])
            .filter(Boolean) as string[]
        )
      )
      const snapshots: Record<string, ChangeSnapshot> = {}
      let latestSnapshots: ChangeSnapshot[] = []

      if (snapshotIds.length > 0) {
        const { data: snapshotData, error: snapshotError } = await supabase
          .from('change_snapshots')
          .select('id,source_id,content_text,content_hash,captured_at')
          .in('id', snapshotIds)

        if (snapshotError)
          throw new Error(
            t("Snapshot məlumatı oxunmadı: {0}", [friendlyError(snapshotError)])
          )

        for (const snapshot of (snapshotData || []) as ChangeSnapshot[]) {
          snapshots[snapshot.id] = snapshot
        }
      }

      let latestSnapshotQuery = supabase
        .from('change_snapshots')
        .select('id,source_id,content_text,content_hash,captured_at')
        .order('captured_at', { ascending: false })
        .limit(2)

      if (source.content_hash) {
        latestSnapshotQuery = latestSnapshotQuery.or(
          `source_id.eq.${source.id},content_hash.eq.${source.content_hash}`
        )
      } else {
        latestSnapshotQuery = latestSnapshotQuery.eq('source_id', source.id)
      }

      const { data: latestSnapshotData, error: latestSnapshotError } =
        await latestSnapshotQuery

      if (latestSnapshotError)
        throw new Error(
          t("Son snapshot məlumatı oxunmadı: {0}", [friendlyError(latestSnapshotError)])
        )

      latestSnapshots = (latestSnapshotData || []) as ChangeSnapshot[]

      for (const snapshot of latestSnapshots) {
        snapshots[snapshot.id] = snapshot
      }

      const { data: alertData, error: alertError } = await supabase
        .from('change_alerts')
        .select('id,event_id,source_id,status,created_at,sent_at,error')
        .eq('source_id', source.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (alertError)
        throw new Error(t("Bildiriş məlumatı oxunmadı: {0}", [friendlyError(alertError)]))

      setExpandedDetails((current) => ({
        ...current,
        [source.id]: {
          events,
          snapshots,
          latestSnapshots,
          alert: (alertData || null) as ChangeAlert | null,
        },
      }))
    } catch (detailLoadError) {
      const message =
        detailLoadError instanceof Error
          ? friendlyError(detailLoadError)
          : t("Məlumat oxunmadı.")
      setExpandedErrors((current) => ({ ...current, [source.id]: message }))
    } finally {
      setExpandedLoading((current) => ({ ...current, [source.id]: false }))
    }
  }
  function markAlertRead(alertId: string) {
    if (!alertId || readAlertIds.includes(alertId)) return
    persistReadAlertIds([...readAlertIds, alertId])
  }

  function markAllNotificationsRead() {
    persistReadAlertIds([...readAlertIds, ...alerts.map((alert) => alert.id)])
  }

  async function openNotification(item: ChangeNotificationItem) {
    markAlertRead(item.alert.id)
    setNotificationOpen(false)

    if (item.url && openExternalUrl(item.url)) return

    if (item.source) {
      if (expandedSourceId !== item.source.id) {
        await toggleInlineDetails(item.source)
      }
      setTimeout(() => {
        document
          .getElementById(`change-watch-${item.source?.id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 80)
    }
  }

  async function openSourceDetails(source: ChangeSource) {
    setDetailOpen(true)
    setDetailSource(source)
    setDetailEvent(null)
    setDetailOldSnapshot(null)
    setDetailNewSnapshot(null)
    setDetailError('')
    setDetailLoading(true)

    const { data: eventData, error: eventError } = await supabase
      .from('change_events')
      .select(
        'id,source_id,old_snapshot_id,new_snapshot_id,old_hash,new_hash,diff_summary,created_at'
      )
      .eq('source_id', source.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (eventError) {
      setDetailError(t("Dəyişiklik hadisəsi oxunmadı: {0}", [friendlyError(eventError)]))
      setDetailLoading(false)
      return
    }

    if (!eventData) {
      setDetailError(t("Bu izləmə üçün hələ dəyişiklik hadisəsi yoxdur."))
      setDetailLoading(false)
      return
    }

    const event = eventData as ChangeEvent
    setDetailEvent(event)

    const snapshotIds = [event.old_snapshot_id, event.new_snapshot_id].filter(
      Boolean
    ) as string[]
    if (snapshotIds.length === 0) {
      setDetailError(t("Bu hadisə üçün snapshot məlumatı tapılmadı."))
      setDetailLoading(false)
      return
    }

    const { data: snapshotData, error: snapshotError } = await supabase
      .from('change_snapshots')
      .select('id,source_id,content_text,content_hash,captured_at')
      .in('id', snapshotIds)

    if (snapshotError) {
      setDetailError(t("Snapshot məlumatı oxunmadı: {0}", [friendlyError(snapshotError)]))
      setDetailLoading(false)
      return
    }

    const snapshots = (snapshotData || []) as ChangeSnapshot[]
    setDetailOldSnapshot(
      snapshots.find((item) => item.id === event.old_snapshot_id) || null
    )
    setDetailNewSnapshot(
      snapshots.find((item) => item.id === event.new_snapshot_id) || null
    )
    setDetailLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (sources.length === 0) return

    const sourceById = new Map(sources.map((source) => [source.id, source]))
    const latestBySource = new Map<string, ChangeEvent>()

    for (const event of recentEvents) {
      if (!event.source_id || latestBySource.has(event.source_id)) continue
      latestBySource.set(event.source_id, event)
    }

    const items = Array.from(latestBySource.values())
      .map((event) => {
        const source = sourceById.get(event.source_id || '')
        if (!source) return null
        const parsedSummary = parseChangeSummaryForNotification(
          event.diff_summary
        )
        return {
          eventId: event.id,
          sourceId: source.id,
          name: source.name || source.domain || source.url,
          url: source.url,
          itemUrl: parsedSummary.itemUrl || source.url,
          domain: source.domain,
          title: parsedSummary.title,
          published: parsedSummary.published,
          summary:
            parsedSummary.title || event.diff_summary || t("Dəyişiklik tapılıb."),
          changedAt: event.created_at,
        }
      })
      .filter(Boolean)
      .slice(0, 25)

    window.postMessage(
      {
        type: 'visual-monitor-extension-change-events',
        payload: {
          updatedAt: new Date().toISOString(),
          items,
        },
      },
      '*'
    )
  }, [sources, recentEvents])
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Picker messages must come from the sandboxed preview frame; extension
      // messages are posted by the content script into this same window.
      const fromFrame =
        !!iframeRef.current && event.source === iframeRef.current.contentWindow
      const fromSelf =
        event.source === window && event.origin === window.location.origin

      if (event.data?.type === 'visual-monitor-navigate') {
        if (!fromFrame) return
        const nextUrl = event.data.url || ''
        if (nextUrl) void loadVisualPage(nextUrl)
        return
      }

      const isPicked = event.data?.type === 'visual-monitor-selector-picked'
      const isSuggested =
        event.data?.type === 'visual-monitor-selector-suggested'
      const isExtension =
        event.data?.type === 'visual-monitor-extension-selector'
      if (!isPicked && !isSuggested && !isExtension) return
      if (isExtension ? !fromSelf : !fromFrame) return

      const payload = isExtension ? event.data.payload || {} : event.data

      if (isExtension) {
        void saveExtensionSelection(payload)
        return
      }

      const picked: PickedElement = {
        selector: payload.selector || 'body',
        text: payload.text || '',
        html: payload.html || '',
        href: payload.href || null,
        tag: payload.tag || '',
        matchCount: Number(payload.matchCount || 0),
      }

      setPickedElement(picked)
      setSelectorTestResult(null)
      updateForm('selector', picked.selector)
      if (payload.pageUrl && !form.url.trim())
        updateForm('url', payload.pageUrl)
      if (payload.pageTitle && !form.name.trim())
        updateForm('name', payload.pageTitle)
      if (isPicked) setSelectorMode(false)
      setVisualMessage(
        isPicked
          ? t("Selector seçildi və formaya yazıldı. Düzgündürsə, izləməni yadda saxla.")
          : t("Sistem izlənəcək hissə üçün avtomatik selector təklif etdi. İstəsən əl ilə başqa hissə seçə bilərsən.")
      )
      if (isPicked) toast.success(t("Selector formaya yazıldı."))
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [form])

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'visual-monitor-selector-mode', enabled: selectorMode },
      '*'
    )
  }, [selectorMode, visualHtml])

  const stats = useMemo(() => {
    const changedSourceIds = new Set(
      events24h.map((event) => event.source_id).filter(Boolean)
    )

    return {
      total: sources.length,
      active: sources.filter((source) => source.status === 'active').length,
      inactive: sources.filter((source) => source.status !== 'active').length,
      error: sources.filter(hasError).length,
      changes24h: changedSourceIds.size,
    }
  }, [sources, events24h])

  const latestAlert = alerts[0]
  const latestEventBySourceId = useMemo(() => {
    const map = new Map<string, ChangeEvent>()
    for (const event of recentEvents) {
      if (event.source_id && !map.has(event.source_id))
        map.set(event.source_id, event)
    }
    return map
  }, [recentEvents])
  const notificationItems = useMemo<ChangeNotificationItem[]>(() => {
    const sourceMap = new Map(
      sources.map((source) => [source.id, source] as const)
    )
    const eventMap = new Map(
      recentEvents.map((event) => [event.id, event] as const)
    )
    const latestEventBySource = new Map<string, ChangeEvent>()

    for (const event of recentEvents) {
      if (event.source_id && !latestEventBySource.has(event.source_id)) {
        latestEventBySource.set(event.source_id, event)
      }
    }

    return alerts.slice(0, 30).map((alert) => {
      const source = alert.source_id
        ? sourceMap.get(alert.source_id) || null
        : null
      const event =
        (alert.event_id ? eventMap.get(alert.event_id) : null) ||
        (alert.source_id
          ? latestEventBySource.get(alert.source_id) || null
          : null)
      const target = parseNotificationTarget(event?.diff_summary, source?.url)
      const title =
        target.kind === 'generic'
          ? source?.name || source?.domain || target.title
          : target.title

      return {
        alert,
        source,
        event,
        isRead: readAlertIds.includes(alert.id),
        title,
        summary:
          target.summary ||
          alert.error ||
          source?.last_error ||
          t("Yeni dəyişiklik bildirişi var."),
        time: alert.sent_at || alert.created_at || event?.created_at || null,
        url: target.url,
        kind: target.kind,
      }
    })
  }, [alerts, recentEvents, sources, readAlertIds])
  const unreadNotificationCount = notificationItems.filter(
    (item) => !item.isRead
  ).length

  useEffect(() => {
    const previous = previousUnreadCountRef.current
    previousUnreadCountRef.current = unreadNotificationCount

    if (previous !== null && unreadNotificationCount > previous) {
      playNotificationSound()
    }
  }, [unreadNotificationCount])
  const unreadNotificationSourceIds = useMemo(() => {
    return new Set(
      notificationItems
        .filter((item) => !item.isRead && item.source?.id)
        .map((item) => item.source?.id as string)
    )
  }, [notificationItems])
  const recentChangeCountBySourceId = useMemo(() => {
    const map = new Map<string, number>()
    for (const event of recentEvents) {
      if (!event.source_id) continue
      map.set(event.source_id, (map.get(event.source_id) || 0) + 1)
    }
    return map
  }, [recentEvents])
  const filteredSources = useMemo(() => {
    const changedSourceIds = new Set(
      events24h.map((event) => event.source_id).filter(Boolean)
    )

    if (activeFilter === 'active')
      return sources.filter((source) => source.status === 'active')
    if (activeFilter === 'inactive')
      return sources.filter((source) => source.status !== 'active')
    if (activeFilter === 'error') return sources.filter(hasError)
    if (activeFilter === 'changed24h')
      return sources.filter((source) => changedSourceIds.has(source.id))

    return sources
  }, [activeFilter, events24h, sources])
  const activeFilterLabel =
    activeFilter === 'active'
      ? t("aktiv izləmələr")
      : activeFilter === 'inactive'
        ? t("passiv izləmələr")
        : activeFilter === 'error'
          ? t("xətalı izləmələr")
          : activeFilter === 'changed24h'
            ? t("son 24 saatda dəyişən izləmələr")
            : t("bütün izləmələr")
  const diffResult = useMemo(
    () =>
      buildDiffRows(
        detailOldSnapshot?.content_text,
        detailNewSnapshot?.content_text
      ),
    [detailOldSnapshot, detailNewSnapshot]
  )
  const addedLinkItems = useMemo(
    () =>
      extractLinksFromLines(
        diffResult.rows
          .filter(
            (row) => row.rightTone === 'added' || row.rightTone === 'modified'
          )
          .map((row) => row.right)
      ),
    [diffResult]
  )
  const removedLinkItems = useMemo(
    () =>
      extractLinksFromLines(
        diffResult.rows
          .filter(
            (row) => row.leftTone === 'removed' || row.leftTone === 'modified'
          )
          .map((row) => row.left)
      ),
    [diffResult]
  )
  const allSourcesSelected =
    filteredSources.length > 0 &&
    filteredSources.every((source) => selectedSourceIds.includes(source.id))

  void getStatusVariant
  void openEventDetails
  void openSourceDetails

  return (
    <div className='max-w-full min-w-0 space-y-4 p-4 md:p-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t("Veb izləmə")}</h1>
          <p className='text-muted-foreground'>{t("URL və CSS selector ilə izlənən vacib sayt hissələri.")}</p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Dialog open={notificationOpen} onOpenChange={setNotificationOpen}>
            <DialogTrigger asChild>
              <Button
                type='button'
                variant='outline'
                className='relative size-11 shrink-0 rounded-lg p-0'
                aria-label={t("Dəyişiklik bildirişləri")}
              >
                <span aria-hidden='true'>🔔</span>
                {unreadNotificationCount > 0 ? (
                  <span className='absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white'>
                    {unreadNotificationCount > 99
                      ? '99+'
                      : unreadNotificationCount}
                  </span>
                ) : null}
              </Button>
            </DialogTrigger>

            <DialogContent className='gap-0 overflow-hidden p-0 sm:max-w-md sm:p-0'>
              <div className='flex flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-4 py-3 pr-14'>
                <div>
                  <DialogTitle>{t("Dəyişiklik bildirişləri")}</DialogTitle>
                  <DialogDescription>{t("Son bildirişlər və yeni dəyişikliklər")}</DialogDescription>
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={markAllNotificationsRead}
                  disabled={notificationItems.length === 0}
                >{t("Hamısı oxundu")}</Button>
              </div>

              {notificationItems.length === 0 ? (
                <div className='px-4 py-8 text-center text-sm text-muted-foreground'>{t("Hələ bildiriş yoxdur.")}</div>
              ) : (
                <div className='max-h-[min(420px,65dvh)] overflow-auto'>
                  {notificationItems.map((item) => (
                    <button
                      key={item.alert.id}
                      type='button'
                      onClick={() => void openNotification(item)}
                      className={`block w-full border-b px-4 py-3 text-left transition hover:bg-muted/50 ${
                        item.isRead
                          ? 'bg-background'
                          : 'border-l-4 border-l-slate-950 bg-muted/50'
                      }`}
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='truncate text-sm font-semibold'>
                            {item.title}
                          </div>
                          <div className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
                            {item.summary}
                          </div>
                          {item.url ? (
                            <div
                              className='mt-1 truncate text-[11px] text-primary underline'
                              title={item.url}
                            >
                              {getSourceDisplayName(item.source)}
                            </div>
                          ) : null}
                        </div>
                        <span
                          className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            item.kind === 'new'
                              ? 'bg-emerald-100 text-emerald-700'
                              : item.kind === 'removed'
                                ? 'bg-red-100 text-red-700'
                                : item.kind === 'changed'
                                  ? 'bg-blue-100 text-primary'
                                  : item.isRead
                                    ? 'bg-muted text-muted-foreground'
                                    : 'bg-slate-950 text-white'
                          }`}
                        >
                          {item.kind === 'new'
                            ? t("Yeni")
                            : item.kind === 'removed'
                              ? 'Silinib'
                              : item.kind === 'changed'
                                ? t("Dəyişib")
                                : item.isRead
                                  ? 'Oxunub'
                                  : t("Yeni")}
                        </span>
                      </div>
                      <div className='mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground'>
                        <span>{formatDate(item.time)}</span>
                        <span>{getAlertStatusLabel(item.alert.status)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Button onClick={openCreateDialog}>{t("Yeni veb izləmə")}</Button>
        </div>
      </div>

      {error ? (
        <div className='rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>
          {error}
        </div>
      ) : null}

      <div className='grid grid-cols-2 gap-3 xl:grid-cols-5'>
        <KpiCard
          title={t("Ümumi")}
          value={stats.total}
          description={t("Bütün izləmələr")}
          compact
          active={activeFilter === 'all'}
          onClick={() => setActiveFilter('all')}
        />
        <KpiCard
          title={t("Aktiv")}
          value={stats.active}
          description={t("İşlək izləmələr")}
          tone='success'
          compact
          active={activeFilter === 'active'}
          onClick={() =>
            setActiveFilter(activeFilter === 'active' ? 'all' : 'active')
          }
        />
        <KpiCard
          title={t("Passiv")}
          value={stats.inactive}
          description={t("Aktiv olmayanlar")}
          tone='muted'
          compact
          active={activeFilter === 'inactive'}
          onClick={() =>
            setActiveFilter(activeFilter === 'inactive' ? 'all' : 'inactive')
          }
        />
        <KpiCard
          title={t("Xətalı")}
          value={stats.error}
          description={t("Xəta və ya fail")}
          tone='danger'
          compact
          active={activeFilter === 'error'}
          onClick={() =>
            setActiveFilter(activeFilter === 'error' ? 'all' : 'error')
          }
        />
        <KpiCard
          title={t("24 saat")}
          value={stats.changes24h}
          description={t("Dəyişən izləmələr")}
          tone='info'
          compact
          active={activeFilter === 'changed24h'}
          onClick={() =>
            setActiveFilter(
              activeFilter === 'changed24h' ? 'all' : 'changed24h'
            )
          }
        />
      </div>

      <Card className='max-w-full overflow-hidden'>
        <CardHeader className='pb-3'>
          <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
            <div>
              <CardTitle>{t("İzləmələr")}</CardTitle>
              <CardDescription>
                {loading
                  ? t("Məlumatlar yüklənir...")
                  : `${t('{0} / {1} izləmə göstərilir', [filteredSources.length, sources.length])} · ${activeFilterLabel}${
                      latestAlert
                        ? t(" · son bildiriş: {0} ({1})", [getStatusLabel(latestAlert.status), formatDate(latestAlert.sent_at || latestAlert.created_at)])
                        : ''
                    }`}
              </CardDescription>
            </div>
            {selectedSourceIds.length > 0 ? (
              <Button
                variant='destructive'
                size='sm'
                onClick={() => deleteSources(selectedSourceIds)}
                disabled={deleting}
              >
                {deleting
                  ? 'Silinir...'
                  : t("Seçilənləri sil ({0})", [selectedSourceIds.length])}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className='min-w-0 overflow-hidden'>
          {loading ? (
            <div className='rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground'>{t("İzləmələr yüklənir...")}</div>
          ) : sources.length === 0 ? (
            <div className='rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground'>{t("Hələ Veb izləmə üçün izləmə əlavə edilməyib.")}</div>
          ) : filteredSources.length === 0 ? (
            <div className='rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground'>{t("Bu filtrə uyğun izləmə yoxdur.")}</div>
          ) : (
            <ResponsiveTable label={t("Veb izləmələr")} mobileLayout='cards'>
              <label className='flex min-h-11 items-center gap-3 border-b px-3 py-2 md:hidden'>
                <Checkbox
                  checked={allSourcesSelected}
                  onCheckedChange={(checked) =>
                    toggleAllSources(Boolean(checked), filteredSources)
                  }
                  aria-label={t("Görünən izləmələrin hamısını seç")}
                />{t("Bütün izləmələri seç")}</label>
              <Table className='w-full table-fixed text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[13%]'>
                      {!isMobile && (
                        <Checkbox
                          checked={allSourcesSelected}
                          onCheckedChange={(checked) =>
                            toggleAllSources(Boolean(checked), filteredSources)
                          }
                          aria-label={t("Bütün izləmələri seç")}
                        />
                      )}
                      <span className='ml-2'>{t("Status")}</span>
                    </TableHead>
                    <TableHead className='w-[18%]'>{t("İzləmə")}</TableHead>
                    <TableHead className='w-[18%]'>{t("URL / domain")}</TableHead>
                    <TableHead className='w-[18%]'>Selector</TableHead>
                    <TableHead className='hidden w-[11%] xl:table-cell'>{t("Son yoxlama")}</TableHead>
                    <TableHead className='hidden w-[11%] xl:table-cell'>{t("Son dəyişiklik")}</TableHead>
                    <TableHead className='w-[8%]'>{t("Dəyişiklik")}</TableHead>
                    <TableHead className='w-[10%]'>{t("İş")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSources.map((source) => {
                    const latestEvent =
                      latestEventBySourceId.get(source.id) || null
                    const isExpanded = expandedSourceId === source.id
                    const details = expandedDetails[source.id]
                    const latestInlineEvent = details?.events?.[0] || null
                    const inlineOldSnapshot = latestInlineEvent?.old_snapshot_id
                      ? details?.snapshots[latestInlineEvent.old_snapshot_id]
                      : null
                    const inlineNewSnapshot = latestInlineEvent?.new_snapshot_id
                      ? details?.snapshots[latestInlineEvent.new_snapshot_id]
                      : null
                    const displayOldSnapshot =
                      inlineOldSnapshot || details?.latestSnapshots?.[1] || null
                    const displayNewSnapshot =
                      inlineNewSnapshot || details?.latestSnapshots?.[0] || null
                    const inlineDiff =
                      displayOldSnapshot && displayNewSnapshot
                        ? buildDiffRows(
                            displayOldSnapshot.content_text,
                            displayNewSnapshot.content_text
                          )
                        : null
                    const inlineAddedLinks = inlineDiff
                      ? extractLinksFromLines(
                          inlineDiff.rows
                            .filter(
                              (row) =>
                                row.rightTone === 'added' ||
                                row.rightTone === 'modified'
                            )
                            .map((row) => row.right)
                        )
                      : []
                    const inlineRemovedLinks = inlineDiff
                      ? extractLinksFromLines(
                          inlineDiff.rows
                            .filter(
                              (row) =>
                                row.leftTone === 'removed' ||
                                row.leftTone === 'modified'
                            )
                            .map((row) => row.left)
                        )
                      : []
                    void inlineRemovedLinks
                    const currentSnapshotItems = parseSnapshotItems(
                      displayNewSnapshot?.content_text
                    )
                    const previousSnapshotItems = parseSnapshotItems(
                      displayOldSnapshot?.content_text
                    )
                    const previousSnapshotUrls = new Set(
                      previousSnapshotItems
                        .map((item) => normalizeSnapshotItemUrl(item.url))
                        .filter(Boolean)
                    )
                    const highlightedSnapshotUrls = new Set(
                      [
                        ...inlineAddedLinks.map((item) =>
                          normalizeSnapshotItemUrl(item.url)
                        ),
                        ...currentSnapshotItems
                          .filter((item) => {
                            const normalizedUrl = normalizeSnapshotItemUrl(
                              item.url
                            )
                            return (
                              normalizedUrl &&
                              !previousSnapshotUrls.has(normalizedUrl)
                            )
                          })
                          .map((item) => normalizeSnapshotItemUrl(item.url)),
                      ].filter(Boolean)
                    )
                    const expandedViewMode =
                      expandedViewModes[source.id] || 'visual'
                    const diagnostic = getWatchDiagnostic(
                      source,
                      latestEvent,
                      Boolean(source.content_hash || source.last_changed_at)
                    )
                    const statusBadge = getWatchStatusBadge(
                      source,
                      latestEvent,
                      Boolean(source.content_hash || source.last_changed_at)
                    )
                    const recentChangeCount =
                      recentChangeCountBySourceId.get(source.id) || 0
                    const eventTimeline = (details?.events || []).map(
                      (event) => {
                        const itemCompare = getEventItemCompare(
                          event,
                          details?.snapshots || {}
                        )
                        const comparisonRows = buildSnapshotComparisonRows(
                          event,
                          details?.snapshots || {}
                        )
                        const highlightedCount = comparisonRows.filter(
                          (row) => row.status !== 'normal'
                        ).length
                        return {
                          event,
                          itemCompare,
                          comparisonRows,
                          addedCount: itemCompare.added.length,
                          removedCount: itemCompare.removed.length,
                          changedCount: itemCompare.changed.length,
                          highlightedCount,
                        }
                      }
                    )
                    const latestVisibleEvent =
                      eventTimeline.find(
                        ({ highlightedCount }) => highlightedCount > 0
                      ) || null
                    const hasUnreadNotification =
                      unreadNotificationSourceIds.has(source.id)
                    const rowClass =
                      source.status !== 'active'
                        ? 'bg-muted/30 text-muted-foreground hover:bg-muted/40'
                        : source.last_error
                          ? 'bg-red-50/70 hover:bg-red-50'
                          : hasUnreadNotification
                            ? 'border-l-4 border-l-slate-950 bg-muted/50 hover:bg-muted/80'
                            : 'hover:bg-muted/40'

                    return (
                      <Fragment key={source.id}>
                        <TableRow
                          id={`change-watch-${source.id}`}
                          className={`cursor-pointer ${rowClass}`}
                          onClick={() => toggleInlineDetails(source)}
                        >
                          <TableCell
                            role='cell'
                            data-label={t("Vəziyyət")}
                            className='px-2 py-2 align-top'
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className='flex min-w-0 items-start gap-2'>
                              <Checkbox
                                checked={selectedSourceIds.includes(source.id)}
                                onCheckedChange={(checked) =>
                                  toggleSourceSelection(
                                    source.id,
                                    Boolean(checked)
                                  )
                                }
                                aria-label={t("İzləməni seç")}
                              />
                              <div className='min-w-0 space-y-1'>
                                <span
                                  className={`inline-flex max-w-full truncate rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${statusBadge.className}`}
                                  title={statusBadge.label}
                                >
                                  {statusBadge.label}
                                </span>
                                <button
                                  type='button'
                                  onClick={() => toggleSourceStatus(source)}
                                  className={`block rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                                    source.status === 'active'
                                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                      : 'bg-red-100 text-red-700 hover:bg-red-200'
                                  }`}
                                  title={t("Aktiv/passiv et")}
                                >
                                  {source.status === 'active' ? 'ON' : 'OFF'}
                                </button>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell
                            role='cell'
                            data-label={t("İzləmə")}
                            className='min-w-0 px-2 py-2 align-top'
                          >
                            <div
                              className='truncate font-semibold'
                              title={source.name || getDomain(source)}
                            >
                              {source.name || getDomain(source)}
                            </div>
                            <div className='mt-1 flex min-w-0 flex-wrap gap-1'>
                              <span
                                className={`inline-flex max-w-full truncate rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${getDiagnosticBadgeClass(diagnostic.tone)}`}
                                title={diagnostic.reason}
                              >
                                {diagnostic.label}
                              </span>
                              {hasUnreadNotification ? (
                                <Badge
                                  className='h-5 px-1.5 text-[11px]'
                                  variant='default'
                                >{t("Yeni")}</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell
                            role='cell'
                            data-label='URL / domen'
                            className='min-w-0 px-2 py-2 align-top'
                          >
                            <div
                              className='truncate font-medium'
                              title={getDomain(source)}
                            >
                              {getDomain(source)}
                            </div>
                            <div
                              className='truncate text-xs text-muted-foreground'
                              title={source.url || '-'}
                            >
                              {source.url || '-'}
                            </div>
                          </TableCell>
                          <TableCell
                            role='cell'
                            data-label='Selector'
                            className='min-w-0 px-2 py-2 align-top'
                          >
                            <div
                              className='truncate font-mono text-xs text-muted-foreground'
                              title={source.selector || t("Selector seçilməyib")}
                            >
                              {source.selector || t("Selector seçilməyib")}
                            </div>
                          </TableCell>
                          <TableCell
                            role='cell'
                            data-label='Son yoxlama'
                            className='hidden px-2 py-2 align-top whitespace-nowrap xl:table-cell'
                          >
                            {formatDate(source.last_checked_at)}
                          </TableCell>
                          <TableCell
                            role='cell'
                            data-label={t("Son dəyişiklik")}
                            className='hidden px-2 py-2 align-top whitespace-nowrap xl:table-cell'
                          >
                            {formatDate(source.last_changed_at)}
                          </TableCell>
                          <TableCell
                            role='cell'
                            data-label={t("Dəyişiklik")}
                            className='px-2 py-2 align-top'
                          >
                            <span
                              className='rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                              title={t("Son dəyişiklik hadisələrinin sayı")}
                            >
                              {recentChangeCount}
                            </span>
                          </TableCell>
                          <TableCell
                            role='cell'
                            data-label={t("Əməliyyatlar")}
                            className='px-2 py-2 align-top'
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className='flex min-w-0 items-center gap-1.5'>
                              {source.url ? (
                                <a
                                  href={source.url}
                                  target='_blank'
                                  rel='noreferrer'
                                  className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm hover:bg-muted'
                                  aria-label={t("İzləməni yeni tabda aç")}
                                >
                                  ↗
                                </a>
                              ) : null}
                              <Button
                                variant='outline'
                                size='sm'
                                className='h-8 w-8 shrink-0 px-0'
                                onClick={() => openEditDialog(source)}
                                title={t("Redaktə et")}
                                aria-label={t("Redaktə et")}
                              >
                                ✎
                              </Button>
                              <Button
                                variant='outline'
                                size='sm'
                                className='h-8 shrink-0 px-2 text-red-600 hover:text-red-700'
                                onClick={() => deleteSources([source.id])}
                                disabled={deleting}
                                title={t("Sil")}
                              >{t("Sil")}</Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded ? (
                          <TableRow>
                            <TableCell
                              colSpan={8}
                              className='max-w-0 bg-background p-0'
                            >
                              <div className='min-w-0 overflow-hidden border-b bg-muted/20 p-3'>
                                {expandedLoading[source.id] ? (
                                  <div className='rounded-lg border bg-background px-4 py-4 text-center text-sm text-muted-foreground'>{t("İzləmə nəticəsi yüklənir...")}</div>
                                ) : expandedErrors[source.id] ? (
                                  <div className='rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'>
                                    {expandedErrors[source.id]}
                                  </div>
                                ) : !details?.events?.length &&
                                  !details?.latestSnapshots?.length &&
                                  !source.content_hash ? (
                                  <div className='rounded-lg border bg-background p-3'>
                                    <div className='flex flex-wrap items-center gap-2'>
                                      <div className='text-sm font-semibold'>{t("Dəyişiklik yoxdur")}</div>
                                      <span
                                        className={`rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${getDiagnosticBadgeClass(diagnostic.tone)}`}
                                      >
                                        {diagnostic.label}
                                      </span>
                                    </div>
                                    <div className='mt-1 text-sm text-muted-foreground'>{t("Dəyişiklik yoxdur. İlk dəyişiklik olduqda burada görünəcək.")}</div>
                                    <div
                                      className='mt-2 truncate text-xs text-muted-foreground'
                                      title={diagnostic.reason}
                                    >
                                      {diagnostic.reason}
                                    </div>
                                  </div>
                                ) : (
                                  <div className='min-w-0 space-y-3'>
                                    {latestVisibleEvent ? (
                                      <div className='min-w-0 rounded-lg border bg-background p-2'>
                                        <div className='flex flex-wrap items-center justify-between gap-2'>
                                          <div>
                                            <div className='text-sm font-semibold'>{t("Son yoxlamanın nəticəsi")}</div>
                                            <div className='text-xs text-muted-foreground'>{t("Əvvəlki və indiki siyahı eyni sayda göstərilir. Yalnız yeni xəbər və real başlıq dəyişikliyi rənglə işarələnir.")}</div>
                                          </div>
                                          <div className='text-xs text-muted-foreground'>
                                            {formatDate(
                                              latestVisibleEvent.event
                                                .created_at
                                            )}
                                          </div>
                                        </div>

                                        <div className='mt-2 grid gap-2 md:grid-cols-2'>
                                          <div className='rounded-md border bg-muted/50 p-2'>
                                            <div className='mb-1 text-xs font-semibold text-muted-foreground'>{t("Əvvəl")}</div>
                                            <div className='space-y-1.5'>
                                              {latestVisibleEvent.comparisonRows.map(
                                                (row, index) => (
                                                  <div
                                                    key={`${row.before?.url || row.before?.title || index}-before`}
                                                    className='rounded border border-border bg-card px-2 py-1 text-xs'
                                                  >
                                                    {row.before ? (
                                                      <>
                                                        <div
                                                          className='truncate font-medium text-foreground'
                                                          title={
                                                            row.before.title ||
                                                            row.before.url
                                                          }
                                                        >
                                                          {row.before.title ||
                                                            row.before.url ||
                                                            t("Başlıq yoxdur")}
                                                        </div>
                                                      </>
                                                    ) : (
                                                      <div className='text-muted-foreground'>{t("Bu məlumat əvvəl yox idi.")}</div>
                                                    )}
                                                  </div>
                                                )
                                              )}
                                            </div>
                                          </div>

                                          <div className='rounded-md border bg-background p-2'>
                                            <div className='mb-1 text-xs font-semibold text-muted-foreground'>{t("İndi")}</div>
                                            <div className='space-y-1.5'>
                                              {latestVisibleEvent.comparisonRows.map(
                                                (row, index) => {
                                                  const toneClass =
                                                    row.status === 'new'
                                                      ? 'border-emerald-200 bg-emerald-50'
                                                      : row.status === 'changed'
                                                        ? 'border-amber-200 bg-amber-50'
                                                        : row.status ===
                                                            'removed'
                                                          ? 'border-red-200 bg-red-50'
                                                          : 'border-border bg-card'
                                                  return (
                                                    <div
                                                      key={`${row.after?.url || row.after?.title || row.before?.url || row.before?.title || index}-after`}
                                                      className={`rounded border px-2 py-1 text-xs ${toneClass}`}
                                                    >
                                                      {row.status === 'new' ? (
                                                        <div className='mb-0.5 text-[11px] font-semibold text-emerald-700'>{t("Yeni məlumat")}</div>
                                                      ) : null}
                                                      {row.status ===
                                                      'changed' ? (
                                                        <div className='mb-0.5 text-[11px] font-semibold text-amber-700'>{t("Başlıq dəyişib")}</div>
                                                      ) : null}
                                                      {row.status ===
                                                      'removed' ? (
                                                        <div className='mb-0.5 text-[11px] font-semibold text-red-700'>
                                                          Silinib
                                                        </div>
                                                      ) : null}
                                                      {row.after ? (
                                                        <>
                                                          <a
                                                            href={
                                                              row.after.url ||
                                                              source.url ||
                                                              '#'
                                                            }
                                                            target='_blank'
                                                            rel='noreferrer'
                                                            className={`block truncate font-medium ${row.status === 'new' ? 'text-primary underline' : 'text-foreground'}`}
                                                            title={
                                                              row.after.title ||
                                                              row.after.url
                                                            }
                                                          >
                                                            {row.after.title ||
                                                              row.after.url ||
                                                              t("Başlıq yoxdur")}
                                                          </a>
                                                        </>
                                                      ) : (
                                                        <div
                                                          className='truncate font-medium text-red-900'
                                                          title={
                                                            row.before?.title ||
                                                            row.before?.url
                                                          }
                                                        >
                                                          {row.before?.title ||
                                                            row.before?.url ||
                                                            t("Silinən məlumat")}
                                                        </div>
                                                      )}
                                                    </div>
                                                  )
                                                }
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className='rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground'>{t("Son yoxlamada göstəriləcək yeni, silinən və ya dəyişən element yoxdur.")}</div>
                                    )}
                                    {displayNewSnapshot &&
                                    LEGACY_SNAPSHOT_VIEW_ENABLED ? (
                                      <div
                                        className={`min-w-0 rounded-lg border p-3 ${latestInlineEvent ? 'border-emerald-200 bg-emerald-50/50' : 'bg-background'}`}
                                      >
                                        <div className='flex flex-wrap items-center justify-between gap-2'>
                                          <div>
                                            <div className='text-sm font-semibold'>{t("İzləmə nəticəsi")}</div>
                                            <div className='text-xs text-muted-foreground'>{t("Seçilmiş hissəyə vizual və mətn rejimində bax.")}</div>
                                          </div>
                                          <div className='flex flex-wrap items-center gap-2'>
                                            {(
                                              [
                                                'visual',
                                                'text',
                                              ] as SnapshotViewMode[]
                                            ).map((mode) => (
                                              <button
                                                key={mode}
                                                type='button'
                                                onClick={() =>
                                                  setExpandedViewModes(
                                                    (current) => ({
                                                      ...current,
                                                      [source.id]: mode,
                                                    })
                                                  )
                                                }
                                                className={`rounded-md border px-3 py-1 text-xs font-semibold transition ${
                                                  expandedViewMode === mode
                                                    ? 'border-slate-950 bg-slate-950 text-white'
                                                    : 'bg-background text-muted-foreground hover:bg-muted'
                                                }`}
                                              >
                                                {mode === 'visual'
                                                  ? 'Vizual'
                                                  : t("Mətn")}
                                              </button>
                                            ))}
                                            <span
                                              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${latestInlineEvent ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`}
                                            >
                                              {latestInlineEvent
                                                ? t("Dəyişiklik tapılıb")
                                                : t("Snapshot var")}
                                            </span>
                                          </div>
                                        </div>

                                        {expandedViewMode === 'visual' ? (
                                          <div className='mt-3 min-w-0 rounded-lg border bg-card p-4'>
                                            <div className='mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-2'>
                                              <div>
                                                <div className='text-sm font-semibold'>{t("Vizual görünüş")}</div>
                                                <div className='text-xs text-muted-foreground'>{t("Seçilmiş hissənin oxunaqlı görünüşü. Yeni/dəyişənlər yaşıl göstərilir.")}</div>
                                              </div>
                                              <div className='flex items-center gap-2'>
                                                {source.url ? (
                                                  <a
                                                    href={
                                                      source.url || undefined
                                                    }
                                                    target='_blank'
                                                    rel='noreferrer'
                                                    className='text-xs text-sky-700 underline'
                                                  >{t("Saytı ayrıca aç")}</a>
                                                ) : null}
                                                <span className='rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700'>
                                                  {currentSnapshotItems.length ||
                                                    splitSnapshotLines(
                                                      displayNewSnapshot.content_text
                                                    ).length}{' '}
                                                  element
                                                </span>
                                              </div>
                                            </div>

                                            {currentSnapshotItems.length > 0 ? (
                                              <div className='max-h-[420px] min-w-0 overflow-auto pr-2'>
                                                <div className='min-w-0 space-y-3 bg-card text-sm leading-relaxed'>
                                                  {currentSnapshotItems
                                                    .slice(0, 80)
                                                    .map((item, index) => {
                                                      const normalizedUrl =
                                                        normalizeSnapshotItemUrl(
                                                          item.url
                                                        )
                                                      const isHighlighted =
                                                        latestInlineEvent &&
                                                        normalizedUrl &&
                                                        highlightedSnapshotUrls.has(
                                                          normalizedUrl
                                                        )

                                                      return (
                                                        <div
                                                          key={
                                                            normalizedUrl ||
                                                            `${item.title}-visual-${index}`
                                                          }
                                                          className={`min-w-0 rounded-sm px-2 py-1 ${isHighlighted ? 'bg-emerald-100 ring-1 ring-emerald-300' : ''}`}
                                                        >
                                                          <a
                                                            href={
                                                              item.url ||
                                                              source.url ||
                                                              '#'
                                                            }
                                                            target='_blank'
                                                            rel='noreferrer'
                                                            className='text-base font-semibold break-words text-primary underline'
                                                          >
                                                            {item.title}
                                                          </a>
                                                          {item.published ? (
                                                            <div
                                                              className={`mt-2 inline-block text-sm ${isHighlighted ? 'bg-emerald-200 text-emerald-950' : 'text-muted-foreground'}`}
                                                            >
                                                              {item.published}
                                                            </div>
                                                          ) : null}
                                                          {item.url ? (
                                                            <div className='mt-1 text-xs break-all text-primary underline'>
                                                              {item.url}
                                                            </div>
                                                          ) : null}
                                                        </div>
                                                      )
                                                    })}
                                                </div>
                                              </div>
                                            ) : (
                                              <pre className='max-h-[min(420px,65dvh)] overflow-auto rounded-md bg-card p-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground'>
                                                {splitSnapshotLines(
                                                  displayNewSnapshot.content_text
                                                ).join('\n\n') ||
                                                  t("Məlumat yoxdur.")}
                                              </pre>
                                            )}
                                          </div>
                                        ) : expandedViewMode === 'text' ? (
                                          <div className='mt-3 rounded-lg border bg-card p-4'>
                                            <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                                              <div className='text-sm font-semibold'>{t("Mətn görünüşü")}</div>
                                              <span className='rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700'>
                                                {currentSnapshotItems.length ||
                                                  splitSnapshotLines(
                                                    displayNewSnapshot.content_text
                                                  ).length}{' '}{t("sətir")}</span>
                                            </div>
                                            {currentSnapshotItems.length > 0 ? (
                                              <div className='max-h-[380px] min-w-0 space-y-3 overflow-auto pr-2 text-sm'>
                                                {currentSnapshotItems
                                                  .slice(0, 60)
                                                  .map((item, index) => {
                                                    const normalizedUrl =
                                                      normalizeSnapshotItemUrl(
                                                        item.url
                                                      )
                                                    const isHighlighted =
                                                      latestInlineEvent &&
                                                      normalizedUrl &&
                                                      highlightedSnapshotUrls.has(
                                                        normalizedUrl
                                                      )

                                                    return (
                                                      <div
                                                        key={
                                                          normalizedUrl ||
                                                          `${item.title}-text-${index}`
                                                        }
                                                        className={
                                                          isHighlighted
                                                            ? 'rounded-md bg-emerald-100 p-2 text-emerald-950'
                                                            : ''
                                                        }
                                                      >
                                                        <a
                                                          href={
                                                            item.url ||
                                                            source.url ||
                                                            '#'
                                                          }
                                                          target='_blank'
                                                          rel='noreferrer'
                                                          className='font-semibold text-primary underline'
                                                        >
                                                          {item.title}
                                                        </a>
                                                        {item.published ? (
                                                          <div className='mt-1 text-sm text-muted-foreground'>
                                                            {item.published}
                                                          </div>
                                                        ) : null}
                                                        {item.url ? (
                                                          <div className='mt-1 text-xs break-all text-primary underline'>
                                                            {item.url}
                                                          </div>
                                                        ) : null}
                                                      </div>
                                                    )
                                                  })}
                                              </div>
                                            ) : (
                                              <pre className='max-h-[380px] overflow-auto rounded-md bg-muted/30 p-3 text-sm break-words whitespace-pre-wrap text-foreground'>
                                                {splitSnapshotLines(
                                                  displayNewSnapshot.content_text
                                                ).join('\n\n') ||
                                                  t("Mətn yoxdur.")}
                                              </pre>
                                            )}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </ResponsiveTable>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className='max-h-[94vh] w-[96vw] max-w-[96vw] overflow-y-auto sm:max-w-[96vw]'>
          <DialogHeader>
            <DialogTitle>
              {detailSource?.name ||
                (detailSource ? getDomain(detailSource) : t("İzləmə detalları"))}
            </DialogTitle>
            <DialogDescription>{t("Son dəyişiklik üzrə əvvəlki və cari snapshot müqayisəsi.")}</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className='rounded-lg border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground'>{t("Müqayisə məlumatları yüklənir...")}</div>
          ) : detailError ? (
            <div className='rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'>
              {detailError}
            </div>
          ) : !detailOldSnapshot || !detailNewSnapshot ? (
            <div className='rounded-lg border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground'>{t("Müqayisə üçün əvvəlki və cari snapshot tapılmadı.")}</div>
          ) : (
            <div className='space-y-4'>
              <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-5'>
                <KpiCard
                  title={t("Əvvəlki snapshot")}
                  value={(detailOldSnapshot.content_text || '').length}
                  description='simvol'
                  tone='muted'
                />
                <KpiCard
                  title='Cari snapshot'
                  value={(detailNewSnapshot.content_text || '').length}
                  description='simvol'
                  tone='info'
                />
                <KpiCard
                  title={t("Əlavə olunan")}
                  value={diffResult.added}
                  description={t("sətir")}
                  tone='success'
                />
                <KpiCard
                  title={t("Silinən")}
                  value={diffResult.removed}
                  description={t("sətir")}
                  tone='danger'
                />
                <KpiCard
                  title={t("Dəyişən")}
                  value={diffResult.modified}
                  description={t("sətir")}
                />
              </div>

              <div className='grid gap-3 text-sm lg:grid-cols-2'>
                <div className='rounded-lg border bg-background p-3'>
                  <div className='font-semibold'>{t("İzləmə")}</div>
                  <div className='mt-1 break-all text-muted-foreground'>
                    {detailSource?.url || '-'}
                  </div>
                  <div className='mt-2 text-xs text-muted-foreground'>
                    Event: {formatDate(detailEvent?.created_at)}
                  </div>
                </div>
                <div className='rounded-lg border bg-background p-3'>
                  <div className='font-semibold'>{t("Snapshot vaxtları")}</div>
                  <div className='mt-1 text-muted-foreground'>{t("Əvvəlki:")}{' '}{formatDate(detailOldSnapshot.captured_at)}
                  </div>
                  <div className='text-muted-foreground'>
                    Cari: {formatDate(detailNewSnapshot.captured_at)}
                  </div>
                </div>
              </div>

              {addedLinkItems.length > 0 || removedLinkItems.length > 0 ? (
                <div className='grid gap-3 lg:grid-cols-2'>
                  {addedLinkItems.length > 0 ? (
                    <div className='rounded-lg border border-emerald-200 bg-emerald-50 p-3'>
                      <div className='font-semibold text-emerald-900'>{t("Yeni linklər")}</div>
                      <div className='mt-2 max-h-48 space-y-2 overflow-auto text-sm'>
                        {addedLinkItems.map((item) => (
                          <div key={item.url} className='break-words'>
                            <div className='font-medium text-emerald-950'>
                              {item.title}
                            </div>
                            <a
                              href={item.url}
                              target='_blank'
                              rel='noreferrer'
                              className='text-xs break-all text-emerald-700 underline'
                            >
                              {item.url}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {removedLinkItems.length > 0 ? (
                    <div className='rounded-lg border border-red-200 bg-red-50 p-3'>
                      <div className='font-semibold text-red-900'>{t("Silinən linklər")}</div>
                      <div className='mt-2 max-h-48 space-y-2 overflow-auto text-sm'>
                        {removedLinkItems.map((item) => (
                          <div key={item.url} className='break-words'>
                            <div className='font-medium text-red-950'>
                              {item.title}
                            </div>
                            <a
                              href={item.url}
                              target='_blank'
                              rel='noreferrer'
                              className='text-xs break-all text-red-700 underline'
                            >
                              {item.url}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className='rounded-xl border bg-background'>
                <div className='grid border-b bg-muted/50 text-sm font-semibold md:grid-cols-2'>
                  <div className='border-b p-3 md:border-r md:border-b-0'>{t("Əvvəlki snapshot")}</div>
                  <div className='p-3'>Cari snapshot</div>
                </div>

                <div className='max-h-[62vh] overflow-auto'>
                  {diffResult.rows.length === 0 ? (
                    <div className='p-6 text-center text-sm text-muted-foreground'>{t("Snapshot mətnləri boşdur.")}</div>
                  ) : (
                    <div className='min-w-0'>
                      {diffResult.rows.map((row, index) => (
                        <div
                          key={`${index}-${row.left}-${row.right}`}
                          className='grid border-b last:border-b-0 md:grid-cols-2'
                        >
                          <div
                            className={`border-r p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap ${getDiffToneClass(row.leftTone)}`}
                          >
                            <span className='mr-2 text-muted-foreground select-none'>
                              {index + 1}
                            </span>
                            <span className='mb-1 block font-sans font-semibold md:hidden'>{t("Əvvəlki snapshot")}</span>
                            {row.left || ' '}
                          </div>
                          <div
                            className={`p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap ${getDiffToneClass(row.rightTone)}`}
                          >
                            <span className='mr-2 text-muted-foreground select-none'>
                              {index + 1}
                            </span>
                            <span className='mb-1 block font-sans font-semibold md:hidden'>
                              Cari snapshot
                            </span>
                            {row.right || ' '}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-h-[calc(100dvh-2rem)] w-[96vw] max-w-[96vw] overflow-y-auto sm:max-w-[96vw]'>
          <DialogHeader>
            <DialogTitle>
              {editingSource ? t("İzləməni redaktə et") : t("Yeni veb izləmə")}
            </DialogTitle>
            <DialogDescription>{t("URL yaz, saytı vizual aç, izlənəcək hissəni seç və selector avtomatik formaya düşsün.")}</DialogDescription>
          </DialogHeader>

          <form className='space-y-4' onSubmit={handleSave}>
            {formError ? (
              <div className='rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'>
                {formError}
              </div>
            ) : null}

            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='change-source-name'>{t("İzləmə adı")}</Label>
                <Input
                  id='change-source-name'
                  value={form.name}
                  onChange={(event) => updateForm('name', event.target.value)}
                  placeholder={t("Məsələn: Hacker News")}
                  disabled={saving}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='change-source-status'>{t("Status")}</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) =>
                    updateForm('status', value as ChangeSourceStatus)
                  }
                  disabled={saving}
                >
                  <SelectTrigger id='change-source-status' className='w-full'>
                    <SelectValue placeholder={t("Status seç")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='active'>{t("Aktiv")}</SelectItem>
                    <SelectItem value='inactive'>{t("Passiv")}</SelectItem>
                    <SelectItem value='paused'>{t("Dayandırılıb")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='change-source-url'>{t("URL")}</Label>
              <div className='flex flex-col gap-2 sm:flex-row'>
                <Input
                  id='change-source-url'
                  value={form.url}
                  onChange={(event) => updateForm('url', event.target.value)}
                  placeholder={t("apa.az və ya https://example.az/page")}
                  disabled={saving}
                />
                <Button
                  type='button'
                  variant='outline'
                  onClick={openInBrowserForExtension}
                  disabled={saving}
                >{t("Brauzerdə aç")}</Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => loadVisualPage()}
                  disabled={saving || visualLoading}
                >
                  {visualLoading ? t("Açılır...") : t("Selector pəncərəsində aç")}
                </Button>
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='change-source-selector'>CSS selector</Label>
              <Textarea
                id='change-source-selector'
                value={form.selector}
                onChange={(event) => updateForm('selector', event.target.value)}
                placeholder='.content .news-title'
                disabled={saving}
                rows={3}
              />
            </div>

            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='change-source-interval'>{t("Interval, dəqiqə")}</Label>
                <Input
                  id='change-source-interval'
                  type='number'
                  min={5}
                  value={form.interval_minutes}
                  onChange={(event) =>
                    updateForm('interval_minutes', event.target.value)
                  }
                  disabled={saving}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='change-source-chat'>{t("Telegram chat ID")}</Label>
                <Input
                  id='change-source-chat'
                  value={form.telegram_chat_id}
                  onChange={(event) =>
                    updateForm('telegram_chat_id', event.target.value)
                  }
                  placeholder={t("Boş qala bilər")}
                  disabled={saving}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >{t("Bağla")}</Button>
              <Button type='submit' disabled={saving}>
                {saving ? t("Saxlanılır...") : t("Yadda saxla")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={visualOpen}
        onOpenChange={(open) => {
          if (!open) {
            setVisualOpen(false)
            setSelectorMode(false)
          }
        }}
      >
        <DialogContent className='h-[96dvh] w-[98vw] max-w-[98vw] overflow-y-auto p-0 sm:max-w-[98vw]'>
          <div className='flex min-h-full flex-col'>
            <DialogHeader className='border-b px-5 py-4'>
              <DialogTitle>{t("Selector seç")}</DialogTitle>
              <DialogDescription>{t("Saytda gəz, lazım olan bölməyə daxil ol, sonra selector rejimini aktiv edib izlənəcək hissəni seç.")}{currentVisualUrl ? (
                  <span className='mt-1 block text-xs break-all'>{t("Açılan URL:")}{' '}{currentVisualUrl}
                  </span>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            <div className='grid gap-3 border-b bg-background p-3 xl:grid-cols-[1fr_420px]'>
              <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-950 px-3 py-2 text-sm text-white'>
                <span>
                  {selectorMode
                    ? t("Selector rejimi aktivdir. İzlənəcək blokun üzərinə kliklə.")
                    : t("Gəzinti rejimindəsən. Saytın bölmələrinə daxil ola bilərsən.")}
                </span>
                <Button
                  type='button'
                  size='sm'
                  onClick={() => setSelectorMode((value) => !value)}
                  className={
                    selectorMode
                      ? 'bg-amber-200 text-amber-950 hover:bg-amber-300'
                      : 'bg-emerald-300 text-emerald-950 hover:bg-emerald-400'
                  }
                >
                  {selectorMode ? t("Gəzintiyə qayıt") : 'Selectoru aktiv et'}
                </Button>
              </div>

              <div className='rounded-lg border bg-background p-3 text-sm shadow-sm'>
                {pickedElement ? (
                  <div className='space-y-2'>
                    <div className='font-semibold'>{t("Seçilən hissə")}</div>
                    <div className='max-h-24 overflow-auto rounded-md bg-muted p-2 text-xs text-muted-foreground'>
                      {pickedElement.text ||
                        pickedElement.href ||
                        t("Mətn tapılmadı")}
                    </div>
                    <div className='text-xs break-all'>
                      <b>Selector:</b> {pickedElement.selector}
                    </div>
                    <div className='grid grid-cols-2 gap-2 text-xs text-muted-foreground'>
                      <span>Tag</span>
                      <span className='text-right font-medium text-foreground'>
                        {pickedElement.tag || '-'}
                      </span>
                      <span>{t("Uyğun element sayı")}</span>
                      <span className='text-right font-medium text-foreground'>
                        {pickedElement.matchCount || '-'}
                      </span>
                    </div>
                    {pickedElement.html ? (
                      <details className='rounded-md border bg-muted/30 p-2 text-xs'>
                        <summary className='cursor-pointer font-medium'>
                          HTML preview
                        </summary>
                        <pre className='mt-2 max-h-28 overflow-auto break-all whitespace-pre-wrap text-muted-foreground'>
                          {pickedElement.html}
                        </pre>
                      </details>
                    ) : null}
                    {selectorTestResult ? (
                      <div
                        className={
                          selectorTestResult.ok
                            ? 'rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800'
                            : 'rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700'
                        }
                      >
                        {selectorTestResult.ok
                          ? t("{0} uyğun element tapıldı.", [selectorTestResult.matchedCount])
                          : selectorTestResult.error ||
                            t("Selector boş nəticə verdi.")}
                        {selectorTestResult.previewText ? (
                          <div className='mt-1 line-clamp-2'>
                            {selectorTestResult.previewText}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className='grid grid-cols-2 gap-2'>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => adjustVisualSelection('child')}
                      >{t("Daha kiçik")}</Button>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => adjustVisualSelection('parent')}
                      >{t("Üst element")}</Button>
                    </div>
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      className='w-full'
                      onClick={() => void testPickedSelector()}
                      disabled={selectorTesting}
                    >
                      {selectorTesting ? 'Test edilir...' : 'Test et'}
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      className='w-full'
                      onClick={handleConfirmSelector}
                      disabled={selectorTesting || saving}
                    >{t("Seçimi təsdiqlə")}</Button>
                  </div>
                ) : (
                  <div className='text-muted-foreground'>{t("Seçilən hissənin preview-i burada görünəcək.")}</div>
                )}
              </div>
            </div>

            {visualMessage ? (
              <div className='border-b bg-background px-4 py-2 text-sm text-muted-foreground'>
                {visualMessage}
              </div>
            ) : null}

            <div className='min-h-80 flex-1 bg-card'>
              {visualLoading ? (
                <div className='p-6 text-sm text-muted-foreground'>{t("Sayt açılır...")}</div>
              ) : visualHtml ? (
                <iframe
                  ref={iframeRef}
                  title='Change selector picker'
                  srcDoc={visualHtml}
                  sandbox='allow-scripts allow-popups'
                  className='h-[60dvh] min-h-80 w-full bg-card'
                />
              ) : (
                <div className='p-6 text-sm text-muted-foreground'>{t("Sayt pəncərədə göstərilə bilmədi.")}</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function KpiCard({
  title,
  value,
  description,
  tone = 'default',
  compact = false,
  active = false,
  onClick,
}: {
  title: string
  value: number
  description: string
  tone?: 'default' | 'success' | 'danger' | 'info' | 'muted'
  compact?: boolean
  active?: boolean
  onClick?: () => void
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'danger'
        ? 'text-red-700 dark:text-red-400'
        : tone === 'info'
          ? 'text-sky-700 dark:text-sky-400'
          : tone === 'muted'
            ? 'text-foreground'
            : 'text-primary'

  return (
    <Card
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={`bg-card ${toneClass} ${compact ? 'min-h-0 gap-0 py-2' : ''} ${active ? 'ring-2 ring-primary' : ''} ${onClick ? 'cursor-pointer transition hover:bg-accent' : ''}`}
      aria-pressed={onClick ? active : undefined}
    >
      <CardHeader
        className={
          compact
            ? 'flex h-full flex-row items-center justify-between gap-2 space-y-0 px-3 py-1.5'
            : 'pb-2'
        }
      >
        <CardDescription
          className={
            compact
              ? 'min-w-0 truncate text-sm text-current/75'
              : 'text-current/75'
          }
        >
          {title}
        </CardDescription>
        <CardTitle
          className={compact ? 'shrink-0 text-xl leading-none' : 'text-3xl'}
        >
          {value}
        </CardTitle>
      </CardHeader>
      {compact ? null : (
        <CardContent className='text-sm text-current/75'>
          {description}
        </CardContent>
      )}
    </Card>
  )
}

export const Route = createFileRoute('/(auth)/monitor/watch-monitor')({
  component: AdminChangeMonitorPage,
})

// Web page-change watch is an admin tool; customers are sent to their panel.
function AdminChangeMonitorPage() {
  return (
    <ProtectedRoute
      allowedRoles={['admin', 'superadmin']}
      unauthorizedRedirect='/monitor'
    >
      <ChangeMonitorPage />
    </ProtectedRoute>
  )
}
