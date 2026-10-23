import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { type CustomerKeyword, parseExcludeWords } from './data'

// "Yalnız Azərbaycan" and exclude words for one keyword's social results.
// Mounted per keyword (key), so the form starts from its saved values.
export function KeywordFiltersDialog({
  keyword,
  saving,
  onOpenChange,
  onSave,
}: {
  keyword: CustomerKeyword | null
  saving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (azOnly: boolean, excludeWords: string[]) => void
}) {
  const [azOnly, setAzOnly] = useState(keyword?.azOnly ?? true)
  const [exclude, setExclude] = useState(
    (keyword?.excludeWords || []).join(', ')
  )

  return (
    <Dialog open={!!keyword} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t("Sosial filtr: {0}", [keyword?.keyword || ''])}
          </DialogTitle>
          <DialogDescription>{t("Sosial şəbəkə nəticələrinə aiddir. Xəbər saytları süzülmür.")}</DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          <div className='flex items-start justify-between gap-3 rounded-lg border p-3'>
            <div>
              <div className='text-sm font-medium'>{t("Yalnız Azərbaycan")}</div>
              <p className='text-xs text-muted-foreground'>{t("Azərbaycan dilində olan və ya Azərbaycandan bəhs edən paylaşımlar göstərilir. Məsələn, \"mygov\" üçün Hindistan postları gəlməz.")}</p>
            </div>
            <button
              type='button'
              role='switch'
              aria-checked={azOnly}
              aria-label={t("Yalnız Azərbaycan")}
              onClick={() => setAzOnly(!azOnly)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
                azOnly ? 'bg-primary' : 'bg-muted-foreground/40'
              )}
            >
              <span
                className={cn(
                  'inline-block h-5 w-5 rounded-full bg-background shadow transition',
                  azOnly ? 'translate-x-5' : 'translate-x-0.5'
                )}
              />
            </button>
          </div>

          <label className='grid gap-1.5'>
            <span className='text-sm font-medium'>{t("İstisna sözlər")}</span>
            <Textarea
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              placeholder={t("Vergüllə yazın: India, Modi")}
              className='min-h-16 resize-y'
            />
            <span className='text-xs text-muted-foreground'>{t("Bu sözlərdən biri olan paylaşım göstərilmir. Ən çox 20 söz.")}</span>
          </label>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t("Ləğv et")}
          </Button>
          <Button
            type='button'
            disabled={saving}
            onClick={() => onSave(azOnly, parseExcludeWords(exclude))}
          >
            {saving ? <Loader2 className='animate-spin' /> : null}
            {t("Saxla")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
