import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type NewsItem } from './news-mutate-drawer'
import { useNews } from './news-provider'

type NewsRowActionsProps = {
  news: NewsItem
}

export function NewsRowActions({ news }: NewsRowActionsProps) {
  const { setOpen, setCurrentRow } = useNews()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          className='flex h-8 w-8 p-0 data-[state=open]:bg-muted'
        >
          <DotsHorizontalIcon className='h-4 w-4' />
          <span className='sr-only'>Menyu aç</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align='end' className='w-44'>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(news)
            setOpen('update')
          }}
        >
          Redaktə et
          <DropdownMenuShortcut>
            <Pencil size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>

        {news.slug && (
          <DropdownMenuItem
            onClick={() => {
              window.open(`/news/${news.slug}`, '_blank')
            }}
          >
            Saytda bax
            <DropdownMenuShortcut>
              <ExternalLink size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}

        {news.source && (
          <DropdownMenuItem
            onClick={() => {
              window.open(news.source || '', '_blank')
            }}
          >
            Mənbəyə bax
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(news)
            setOpen('delete')
          }}
          className='text-destructive'
        >
          Sil
          <DropdownMenuShortcut>
            <Trash2 size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
