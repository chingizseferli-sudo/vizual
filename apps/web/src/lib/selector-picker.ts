export type PixelPickedElement = {
  selector: string
  text: string
  html: string
  href: string | null
  tag: string
  matchCount: number
}

type PixelPickerOptions = {
  baseUrl?: string
  autoSuggest?: boolean
}

function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildPixelPickerHtml(
  html: string,
  options: PixelPickerOptions = {}
) {
  const baseTag = options.baseUrl
    ? `<base href="${escapeHtmlAttr(options.baseUrl)}">`
    : ''
  const pickerStyle = `
    <style id="visual-monitor-picker-style">
      html, body { min-height: 100% !important; overflow: auto !important; }
      body { pointer-events: auto !important; }
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
  const autoSuggest = options.autoSuggest !== false

  const pickerScript = `
    <script>
      (() => {
        let selectorMode = false;
        let hoveredElement = null;
        let selectedElement = null;

        const overlay = document.createElement("div");
        overlay.setAttribute("data-vm-picker-overlay", "true");
        overlay.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #2563eb;background:rgba(37,99,235,.10);box-shadow:0 0 0 99999px rgba(15,23,42,.035);display:none";
        document.body.appendChild(overlay);

        const label = document.createElement("div");
        label.setAttribute("data-vm-picker-overlay", "true");
        label.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;display:none;max-width:420px;border-radius:8px;background:#020617;color:#fff;padding:6px 8px;font:12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 30px rgba(15,23,42,.20)";
        document.body.appendChild(label);

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
          window.dispatchEvent(new Event("scroll"));
          window.dispatchEvent(new Event("resize"));
        };

        const safeCss = (value) => {
          if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
          return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
        };

        const isStableToken = (value) => {
          const token = String(value || "");
          if (!token || token.length > 64) return false;
          if (/^[a-f0-9]{6,}$/i.test(token)) return false;
          if (/\\d{5,}/.test(token)) return false;
          if (/css-|chakra-|mantine-|sc-|jss|emotion|__[a-z0-9_-]+/i.test(token)) return false;
          return true;
        };

        const uniqueSelector = (selector) => {
          try {
            return document.querySelectorAll(selector).length === 1;
          } catch {
            return false;
          }
        };

        const stableAttributeSelector = (element) => {
          const attrs = ["data-testid", "data-test", "data-id", "data-key", "data-source", "aria-label", "title", "role"];
          for (const attr of attrs) {
            const value = element.getAttribute(attr);
            if (!isStableToken(value)) continue;
            const selector = element.tagName.toLowerCase() + "[" + attr + "='" + safeCss(value) + "']";
            if (uniqueSelector(selector)) return selector;
          }
          return "";
        };

        const cssPath = (element) => {
          if (!element || element.nodeType !== 1) return "";
          if (element === document.documentElement) return "html";
          if (element === document.body) return "body";

          if (element.id && isStableToken(element.id)) {
            const selector = "#" + safeCss(element.id);
            if (uniqueSelector(selector)) return selector;
          }

          const attrSelector = stableAttributeSelector(element);
          if (attrSelector) return attrSelector;

          const parts = [];
          let current = element;
          while (current && current.nodeType === 1 && current !== document.body) {
            let part = current.tagName.toLowerCase();
            const classes = Array.from(current.classList || [])
              .filter((item) => isStableToken(item))
              .slice(0, 2);

            if (classes.length) {
              part += "." + classes.map((item) => safeCss(item)).join(".");
            } else if (current.parentElement) {
              const same = Array.from(current.parentElement.children).filter((item) => item.tagName === current.tagName);
              if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(current) + 1) + ")";
            }

            parts.unshift(part);
            const selector = parts.join(" > ");
            if (uniqueSelector(selector)) return selector;
            current = current.parentElement;
            if (parts.length >= 7) break;
          }

          return parts.join(" > ") || "body";
        };

        const getDeepElement = (event) => {
          const previous = overlay.style.display;
          const previousLabel = label.style.display;
          overlay.style.display = "none";
          label.style.display = "none";
          const element = document.elementFromPoint(event.clientX, event.clientY) || event.target;
          overlay.style.display = previous;
          label.style.display = previousLabel;
          if (!element || element.nodeType !== 1 || element.closest("[data-vm-picker-overlay='true']")) return null;
          return element;
        };

        const elementPayload = (element) => {
          const selector = cssPath(element) || "body";
          let matchCount = 0;
          try {
            matchCount = document.querySelectorAll(selector).length;
          } catch {
            matchCount = 0;
          }
          const selectedLink = element.closest("a[href]");
          return {
            type: "visual-monitor-selector-picked",
            selector,
            text: (element.innerText || element.textContent || "").trim().slice(0, 500),
            html: (element.outerHTML || "").trim().slice(0, 900),
            href: selectedLink ? selectedLink.href : null,
            tag: element.tagName.toLowerCase(),
            matchCount,
          };
        };

        const showOverlay = (element) => {
          if (!selectorMode || !element) {
            overlay.style.display = "none";
            label.style.display = "none";
            return;
          }
          const rect = element.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          hoveredElement = element;
          const selector = cssPath(element) || element.tagName.toLowerCase();
          overlay.style.display = "block";
          overlay.style.left = rect.left + "px";
          overlay.style.top = rect.top + "px";
          overlay.style.width = Math.max(1, rect.width) + "px";
          overlay.style.height = Math.max(1, rect.height) + "px";
          label.style.display = "block";
          label.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 430)) + "px";
          label.style.top = Math.max(8, rect.top - 34) + "px";
          label.textContent = element.tagName.toLowerCase() + " · " + selector.slice(0, 120);
        };

        const postSelection = (element) => {
          selectedElement = element;
          window.parent.postMessage(elementPayload(element), "*");
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

        const handleMove = (event) => {
          if (!selectorMode) return;
          const element = getDeepElement(event);
          if (element) showOverlay(element);
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
              window.parent.postMessage({ type: "visual-monitor-navigate", url: link.href }, "*");
            }
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          const target = getDeepElement(event) || hoveredElement || event.target;
          if (target) postSelection(target);
        };

        const adjustSelection = (direction) => {
          if (!selectedElement) selectedElement = hoveredElement;
          if (!selectedElement) return;
          let next = selectedElement;
          if (direction === "parent" && selectedElement.parentElement && selectedElement.parentElement !== document.body) {
            next = selectedElement.parentElement;
          }
          if (direction === "child") {
            const child = Array.from(selectedElement.children || []).find((node) => {
              const text = (node.innerText || node.textContent || "").trim();
              return text || node.matches("a[href], img, svg, path, span, strong, em, time, button");
            });
            if (child) next = child;
          }
          selectedElement = next;
          showOverlay(next);
          postSelection(next);
        };

        if (${autoSuggest ? 'true' : 'false'}) {
          window.setTimeout(() => {
            const target = document.querySelector("article, main h1, h1, main, [class*='news' i], [class*='post' i]") || document.body;
            window.parent.postMessage({ ...elementPayload(target), type: "visual-monitor-selector-suggested" }, "*");
          }, 900);
        }

        wakeLazyContent();
        setTimeout(wakeLazyContent, 250);
        setTimeout(wakeLazyContent, 1000);
        setTimeout(wakeLazyContent, 2000);

        window.addEventListener("message", (event) => {
          if (event.data?.type === "visual-monitor-selector-mode") {
            selectorMode = Boolean(event.data.enabled);
            if (!selectorMode) {
              overlay.style.display = "none";
              label.style.display = "none";
            }
          }
          if (event.data?.type === "visual-monitor-selector-adjust") {
            adjustSelection(event.data.direction);
          }
        });

        document.addEventListener("mousemove", handleMove, true);
        document.addEventListener("click", handleClick, true);
      })();
    </script>
  `

  if (/<\/body>/i.test(normalizedHtml)) {
    return normalizedHtml.replace(/<\/body>/i, `${pickerScript}</body>`)
  }

  return `${normalizedHtml}${pickerScript}`
}
