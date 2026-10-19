# Visual Monitor Admin və Customer Portal

## Vizual frontend workspace

This independent repository and GitHub origin are `chingizseferli-sudo/vizual-frontend`. Recorded main deployment metadata and public portal headers establish Vercel hosting; complete provider settings/future triggering still require verification. It owns the public site, customer/admin portals, Supabase Edge Functions/shared migrations and customer analytics. The sibling `vizual-bg-worker` is Python page-change monitoring, not the missing RSS/Node analytics worker.

Read AGENTS.md and docs/TESTING.md before edits. Use Node 22 and pinned Corepack pnpm; run typecheck, lint, format:check, test, test:analytics:db, test:readiness:catalog and build. Local naming does not change auth storage keys, URLs, remotes or deployment settings. Preserve uncommitted M2/M3 work and obtain separate approval for external renames or deployments.

Bu layihə Vizual.Az media monitorinq platformasının public saytı, admin paneli və müştəri kabinetidir. Frontend Supabase Auth/Database ilə işləyir və iki əsas məhsulu idarə edir:

- **Keyword Monitor** — media mənbələrindəki xəbərləri müştərinin açar sözləri ilə uyğunlaşdırır;
- **Change Monitor** — istifadəçinin veb səhifədə seçdiyi sahəni izləyir, dəyişiklik tapdıqda nəticə və bildiriş yaradır.

## Əsas imkanlar

- Public ana səhifə, həllər, qiymətlər, demo, bloq, haqqımızda və əlaqə səhifələri;
- Supabase əsaslı qeydiyyat, giriş, OTP və şifrə bərpası;
- Müştəri monitorları, açar sözlər, nəticələr, xəbərdarlıqlar, profil və Telegram bildirişləri;
- Admin dashboard, istifadəçi idarəetməsi, xəbər redaktəsi, mənbələr, monitorlar, loglar və problem diaqnostikası;
- Public saytın məzmun, brand və SEO parametrlərinin admin paneldən idarəsi;
- Supabase Edge Functions ilə selector proxy/test, mənbə təmiri və admin əməliyyatları;
- `chrome-extension/visual-monitor-selector/` daxilində səhifə elementi seçmək üçün Chrome extension;
- `supabase/migrations/` daxilində auth, RLS, planlar, monitorlar, məlumat saxlanması və public sayt sxemi.

## Giriş nöqtələri

- Public sayt: `/`
- Admin panel: `/admin`
- Müştəri kabineti: `/monitor`
- Müştəri girişi: `/sign-in`
- Admin girişi: `/admin/sign-in`
- Health səhifəsi: `/health`

Qeyd: `/health` yalnız frontend route-un render olunmasını və `Visual Monitor OK` mətnini yoxlayır; Supabase və digər backend servislərinin vəziyyətini yoxlamır.

## Texnologiyalar

- React 19 və TypeScript
- Vite və Tailwind CSS
- TanStack Router, Query və Table
- Supabase Auth, Database, Storage və Edge Functions
- shadcn/ui və Radix komponentləri
- Vitest Browser Mode və Playwright Chromium

## Lokal quraşdırma

Node.js 22 LTS (minimum 20.19) və pnpm 10 istifadə edin:

```bash
corepack prepare pnpm@10.13.1 --activate
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm run dev
```

Frontend-in istifadə etdiyi public dəyişənlər:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_TELEGRAM_BOT_USERNAME=
```

`.env.example` tətbiqin istifadə etdiyi dəyişənləri göstərir. Lokal `.env*` fayllarını və heç bir secret/service-role açarını Git-ə əlavə etməyin. Tətbiq başlanarkən public env dəyişənləri yoxlanılır və natamam konfiqurasiya üçün aydın xəta ekranı göstərilir.

## Faydalı komandalar

```bash
pnpm run dev          # development server
pnpm run typecheck    # TypeScript yoxlaması
pnpm run lint         # ESLint
pnpm run test         # Chromium browser testləri
pnpm run build        # production build
pnpm run preview      # build preview
pnpm run format:check # Prettier yoxlaması
pnpm run check        # typecheck + lint + test + build
```

İlk browser testindən əvvəl Chromium lazım ola bilər:

```bash
pnpm exec playwright install chromium
```

## Deploy

```bash
pnpm run build
```

Çıxış `dist/` qovluğuna yazılır. Əsas repo sübutu olan `vercel.json` Vite build-i və `dist/` çıxışını açıq təyin edir; `netlify.toml` eyni build üçün işlək fallback saxlayır. Hər iki fayl SPA route-larını `index.html`-a yönləndirir. Supabase migrations və Edge Functions frontend deploy-dan ayrıca tətbiq edilməlidir.

## Sağlamlıq statusu — 27 iyul 2026

**Status: frontend keyfiyyət qapıları üzrə healthy-dir.**

- `pnpm run typecheck`: keçdi.
- `pnpm run build`: keçdi; 500 kB-dan böyük chunk yoxdur.
- `pnpm run lint`: keçdi — 0 error, mərhələli query refactor-u üçün saxlanılan 18 warning var.
- `pnpm run format:check`: keçdi.
- `pnpm run test`: keçdi — 15 test faylı, 105/105 test.
- `pnpm audit --prod`: məlum zəiflik tapılmadı.

İlkin 696.6 kB entry chunk framework, TanStack, Supabase, editor və UI vendor chunk-larına bölünüb; tətbiq entry-si 126.3 kB-dir. Public content/settings sorğuları təkrar request-ləri azaltmaq üçün cache olunur.

Bu yoxlamalar real Supabase layihəsinə qarşı inteqrasiya testi deyil. RLS migration-ları, Edge Functions və auth/monitor axını ayrıca test Supabase stack-də smoke/integration testdən keçirilməlidir. Cari audit və növbəti addımlar [texniki audit sənədində](docs/technical-audit.md) saxlanılır.

AUtomation command.
