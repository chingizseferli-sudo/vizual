import { useState } from 'react'
import { Loader2, Plus, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n'
import {
  type CustomerKeyword,
  MAX_KEYWORD_ALIASES,
  normalizeAliases,
} from './data'

// Other spellings of one keyword (English, Russian, short form). Mounted per
// keyword (key), so the list starts from its saved variants.
export function KeywordAliasesDialog({
  keyword,
  saving,
  onOpenChange,
  onSave,
}: {
  keyword: CustomerKeyword | null
  saving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (aliases: string[]) => void
}) {
  const [aliases, setAliases] = useState<string[]>(keyword?.aliases || [])
  const [draft, setDraft] = useState('')
  const name = keyword?.keyword || ''
  const full = aliases.length >= MAX_KEYWORD_ALIASES
  const chosen = new Set(aliases.map((item) => item.toLocaleLowerCase('az-AZ')))
  const suggestions = (keyword?.aliasSuggestions || []).filter(
    (item) => !chosen.has(item.toLocaleLowerCase('az-AZ'))
  )

  function add(value: string) {
    const next = normalizeAliases(name, [...aliases, value])
    setAliases(next.slice(0, MAX_KEYWORD_ALIASES))
  }

  function addDraft() {
    if (!draft.trim() || full) return
    add(draft)
    setDraft('')
  }

  return (
    <Dialog open={!!keyword} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t("Variantlar: {0}", [name])}</DialogTitle>
          <DialogDescription>{t("Xəbər bu yazılışlardan birini çəkəndə də \"{0}\" kimi tapılır. İngiliscə, rusca adı və ya qısaltmanı əlavə edin. Limitə daxil deyil.", [name])}</DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          {aliases.length ? (
            <ul className='flex flex-wrap gap-2'>
              {aliases.map((alias) => (
                <li
                  key={alias}
                  className='inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-sm'
                >
                  {alias}
                  <button
                    type='button'
                    aria-label={t("Sil: {0}", [alias])}
                    onClick={() => setAliases(aliases.filter((item) => item !== alias))}
                    className='rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                  >
                    <X className='h-3.5 w-3.5' />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-sm text-muted-foreground'>{t("Hələ variant yoxdur.")}</p>
          )}

          <div className='flex gap-2'>
            <Input
              aria-label={t("Yeni variant")}
              value={draft}
              maxLength={100}
              disabled={full}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addDraft()
                }
              }}
              placeholder={full ? t("Ən çox {0} variant", [MAX_KEYWORD_ALIASES]) : t("Məsələn: Azerbaijan Airlines")}
            />
            <Button type='button' variant='outline' onClick={addDraft} disabled={full || !draft.trim()}>
              <Plus />
              {t("Əlavə et")}
            </Button>
          </div>

          {keyword?.aliasSuggestions === null ? (
            <p className='text-xs text-muted-foreground'>{t("Təkliflər hazırlanır, bir neçə dəqiqəyə görünəcək.")}</p>
          ) : suggestions.length ? (
            <div className='grid gap-2'>
              <span className='inline-flex items-center gap-1.5 text-sm font-medium'>
                <Sparkles className='h-4 w-4 text-primary' />
                {t("Təkliflər")}
              </span>
              <div className='flex flex-wrap gap-2'>
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type='button'
                    disabled={full}
                    onClick={() => add(suggestion)}
                    className='inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-sm text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    <Plus className='h-3.5 w-3.5' />
                    {suggestion}
                  </button>
                ))}
              </div>
              <p className='text-xs text-muted-foreground'>{t("Təkliflər avtomatik hazırlanır; yalnız düzgün olanları əlavə edin.")}</p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            {t("Ləğv et")}
          </Button>
          <Button
            type='button'
            disabled={saving}
            onClick={() => onSave(normalizeAliases(name, draft.trim() && !full ? [...aliases, draft] : aliases))}
          >
            {saving ? <Loader2 className='animate-spin' /> : null}
            {t("Saxla")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
