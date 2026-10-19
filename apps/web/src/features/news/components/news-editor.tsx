import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Button } from '@/components/ui/button'

type NewsEditorProps = {
  value: string
  onChange: (value: string) => void
}

export function NewsEditor({ value, onChange }: NewsEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || '',
    editorProps: {
      attributes: {
        class:
          'min-h-[260px] rounded-md border bg-background px-4 py-3 text-sm outline-none',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
  })

  useEffect(() => {
    if (!editor) return

    if (value !== editor.getHTML()) {
      editor.commands.setContent(value || '')
    }
  }, [value, editor])

  if (!editor) return null

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap gap-2 rounded-md border bg-muted/50 p-2'>
        <Button
          type='button'
          variant={editor.isActive('bold') ? 'default' : 'outline'}
          size='sm'
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </Button>

        <Button
          type='button'
          variant={editor.isActive('italic') ? 'default' : 'outline'}
          size='sm'
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </Button>

        <Button
          type='button'
          variant={
            editor.isActive('heading', { level: 2 }) ? 'default' : 'outline'
          }
          size='sm'
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H2
        </Button>

        <Button
          type='button'
          variant={editor.isActive('bulletList') ? 'default' : 'outline'}
          size='sm'
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          List
        </Button>

        <Button
          type='button'
          variant={editor.isActive('blockquote') ? 'default' : 'outline'}
          size='sm'
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </Button>
      </div>

      <EditorContent editor={editor} />
    </div>
  )
}
