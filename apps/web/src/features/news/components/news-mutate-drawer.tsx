import { useRef } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { clientEnv } from '@/config/env'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { SelectDropdown } from '@/components/select-dropdown'
import { NewsEditor } from './news-editor'
import { friendlyError } from '@/lib/friendly-error'

export type NewsItem = {
  id: number
  title: string
  slug: string | null
  summary: string | null
  content: string | null
  image_url: string | null
  source: string | null
  category: string | null
  status: string | null
  scheduled_at: string | null
}

type NewsMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: NewsItem | null
  onSuccess?: () => void
}

const formSchema = z.object({
  title: z.string().min(1, 'Başlıq məcburidir.'),
  slug: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  image_url: z.string().optional(),
  source: z.string().optional(),
  category: z.string().min(1, 'Kateqoriya seçilməlidir.'),
  status: z.string().min(1, 'Status seçilməlidir.'),
  scheduled_at: z.string().optional(),
})

type NewsForm = z.infer<typeof formSchema>

export function NewsMutateDrawer({
  open,
  onOpenChange,
  currentRow,
  onSuccess,
}: NewsMutateDrawerProps) {
  const returnFocus = useRef<HTMLElement | null>(null)
  const isUpdate = !!currentRow

  const form = useForm<NewsForm>({
    resolver: zodResolver(formSchema),

    values: {
      title: currentRow?.title || '',
      slug: currentRow?.slug || '',
      summary: currentRow?.summary || '',
      content: currentRow?.content || '',
      image_url: currentRow?.image_url || '',
      source: currentRow?.source || '',
      category: currentRow?.category || 'Ümumi',
      status: currentRow?.status || 'draft',
      scheduled_at: currentRow?.scheduled_at
        ? currentRow.scheduled_at.slice(0, 16)
        : '',
    },
  })

  async function onSubmit(data: NewsForm) {
    const generatedSlug =
      data.slug || data.title.toLowerCase().trim().split(' ').join('-')

    if (isUpdate) {
      const { error } = await supabase
        .from('news')
        .update({
          title: data.title,

          slug: generatedSlug,

          summary: data.summary || null,

          content: data.content || null,

          image_url: data.image_url || null,

          source: data.source || null,

          category: data.category,

          status: data.status,

          scheduled_at: data.scheduled_at || null,

          published_at:
            data.status === 'published' ? new Date().toISOString() : null,
        })
        .eq('id', currentRow.id)

      if (error) {
        alert('Xəta: ' + friendlyError(error))
        return
      }
    } else {
      const { error } = await supabase.from('news').insert({
        title: data.title,

        slug: generatedSlug,

        summary: data.summary || null,

        content: data.content || null,

        image_url: data.image_url || null,

        source: data.source || null,

        category: data.category,

        status: data.status,

        scheduled_at: data.scheduled_at || null,

        published_at:
          data.status === 'published' ? new Date().toISOString() : null,
      })

      if (error) {
        alert('Xəta: ' + friendlyError(error))
        return
      }
    }

    onOpenChange(false)
    onSuccess?.()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className='flex w-[calc(100%-1rem)] min-w-0 flex-col sm:max-w-xl'
        onOpenAutoFocus={() => {
          returnFocus.current = document.activeElement as HTMLElement | null
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault()
            returnFocus.current.focus()
          }
        }}
      >
        <SheetHeader className='pr-14 text-start'>
          <SheetTitle>
            {isUpdate ? 'Xəbəri redaktə et' : 'Yeni xəbər əlavə et'}
          </SheetTitle>

          <SheetDescription>
            Xəbərin başlıq, mətn, şəkil, kateqoriya və status məlumatlarını
            idarə et.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            id='news-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto px-4'
          >
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Başlıq</FormLabel>

                  <FormControl>
                    <Input {...field} placeholder='Xəbər başlığı' />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='slug'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>

                  <FormControl>
                    <Input {...field} placeholder='mekteblerde-yeni-layihe' />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='summary'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Qısa məzmun</FormLabel>

                  <FormControl>
                    <textarea
                      aria-label='Qısa anons'
                      {...field}
                      rows={3}
                      placeholder='Qısa anons'
                      className='w-full rounded-md border bg-background px-3 py-2 text-sm'
                    />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tam xəbər mətni</FormLabel>

                  <FormControl>
                    <NewsEditor
                      value={field.value || ''}
                      onChange={field.onChange}
                    />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='image_url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Şəkil</FormLabel>

                  <FormControl>
                    <div className='space-y-4'>
                      <Input
                        type='file'
                        accept='image/*'
                        onChange={async (e) => {
                          const file = e.target.files?.[0]

                          if (!file) return

                          const fileName = `${Date.now()}-${file.name}`

                          const { error } = await supabase.storage
                            .from('news-images')
                            .upload(fileName, file)

                          if (error) {
                            alert(friendlyError(error))
                            return
                          }

                          const imageUrl = `${clientEnv.supabaseUrl}/storage/v1/object/public/news-images/${fileName}`

                          field.onChange(imageUrl)
                        }}
                      />

                      {field.value && (
                        <img
                          src={field.value}
                          alt=''
                          className='h-48 w-full rounded-lg object-cover'
                        />
                      )}
                    </div>
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='source'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mənbə linki</FormLabel>

                  <FormControl>
                    <Input {...field} placeholder='https://...' />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='category'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Kateqoriya</FormLabel>

                  <SelectDropdown
                    defaultValue={field.value}
                    onValueChange={field.onChange}
                    placeholder='Kateqoriya seç'
                    items={[
                      {
                        label: 'Təhsil',
                        value: 'Təhsil',
                      },
                      {
                        label: 'Elm',
                        value: 'Elm',
                      },
                      {
                        label: 'Texnologiya',
                        value: 'Texnologiya',
                      },
                      {
                        label: 'Dünya',
                        value: 'Dünya',
                      },
                      {
                        label: 'Ümumi',
                        value: 'Ümumi',
                      },
                    ]}
                  />

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='status'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>

                  <SelectDropdown
                    defaultValue={field.value}
                    onValueChange={field.onChange}
                    placeholder='Status seç'
                    items={[
                      {
                        label: 'Qaralama',
                        value: 'draft',
                      },
                      {
                        label: 'Təsdiq gözləyir',
                        value: 'pending',
                      },
                      {
                        label: 'Planlaşdırılıb',
                        value: 'scheduled',
                      },
                      {
                        label: 'Yayımlanıb',
                        value: 'published',
                      },
                    ]}
                  />

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='scheduled_at'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Planlaşdırılan vaxt</FormLabel>

                  <FormControl>
                    <Input {...field} type='datetime-local' />
                  </FormControl>

                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <SheetFooter className='gap-2'>
          <SheetClose asChild>
            <Button variant='outline'>Bağla</Button>
          </SheetClose>

          <Button form='news-form' type='submit'>
            Yadda saxla
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
