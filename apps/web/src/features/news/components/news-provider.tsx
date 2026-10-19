import React, { useState } from 'react'
import useDialogState from '@/hooks/use-dialog-state'
import { type NewsItem } from './news-mutate-drawer'

type NewsDialogType = 'create' | 'update' | 'delete'

type NewsContextType = {
  open: NewsDialogType | null
  setOpen: (str: NewsDialogType | null) => void
  currentRow: NewsItem | null
  setCurrentRow: React.Dispatch<React.SetStateAction<NewsItem | null>>
  reload: () => void
}

const NewsContext = React.createContext<NewsContextType | null>(null)

export function NewsProvider({
  children,
  reload,
}: {
  children: React.ReactNode
  reload: () => void
}) {
  const [open, setOpen] = useDialogState<NewsDialogType>(null)
  const [currentRow, setCurrentRow] = useState<NewsItem | null>(null)

  return (
    <NewsContext
      value={{
        open,
        setOpen,
        currentRow,
        setCurrentRow,
        reload,
      }}
    >
      {children}
    </NewsContext>
  )
}

export const useNews = () => {
  const newsContext = React.useContext(NewsContext)

  if (!newsContext) {
    throw new Error('useNews has to be used within <NewsProvider>')
  }

  return newsContext
}
