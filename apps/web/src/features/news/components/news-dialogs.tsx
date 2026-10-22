import { supabase } from '@/lib/supabase'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { NewsMutateDrawer } from './news-mutate-drawer'
import { useNews } from './news-provider'
import { friendlyError } from '@/lib/friendly-error'

export function NewsDialogs() {
  const { open, setOpen, currentRow, setCurrentRow, reload } = useNews()

  async function deleteNews() {
    if (!currentRow) return

    const { error } = await supabase
      .from('news')
      .delete()
      .eq('id', currentRow.id)

    if (error) {
      alert('Xəta: ' + friendlyError(error))
      return
    }

    setOpen(null)
    setCurrentRow(null)
    reload()
  }

  return (
    <>
      <NewsMutateDrawer
        key='news-create'
        open={open === 'create'}
        onOpenChange={() => setOpen(open === 'create' ? null : 'create')}
        onSuccess={reload}
      />

      {currentRow && (
        <>
          <NewsMutateDrawer
            key={`news-update-${currentRow.id}`}
            open={open === 'update'}
            onOpenChange={() => {
              setOpen(open === 'update' ? null : 'update')

              setTimeout(() => {
                if (open === 'update') {
                  setCurrentRow(null)
                }
              }, 500)
            }}
            currentRow={currentRow}
            onSuccess={reload}
          />

          <ConfirmDialog
            key='news-delete'
            destructive
            open={open === 'delete'}
            onOpenChange={() => {
              setOpen(open === 'delete' ? null : 'delete')

              setTimeout(() => {
                if (open === 'delete') {
                  setCurrentRow(null)
                }
              }, 500)
            }}
            handleConfirm={deleteNews}
            className='max-w-md'
            title={`Bu xəbəri silmək istəyirsiniz? #${currentRow.id}`}
            desc={
              <>
                <strong>{currentRow.title}</strong> başlıqlı xəbər silinəcək.
                <br />
                Bu əməliyyat geri qaytarılmır.
              </>
            }
            confirmText='Sil'
          />
        </>
      )}
    </>
  )
}
