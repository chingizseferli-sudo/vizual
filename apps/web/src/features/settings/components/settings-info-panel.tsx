import { Card, CardContent } from '@/components/ui/card'

type SettingsInfoPanelProps = {
  items: Array<{
    title: string
    description: string
  }>
}

export function SettingsInfoPanel({ items }: SettingsInfoPanelProps) {
  return (
    <div className='grid gap-3 md:grid-cols-2'>
      {items.map((item) => (
        <Card key={item.title} className='shadow-none'>
          <CardContent className='space-y-2 p-4'>
            <h3 className='font-medium'>{item.title}</h3>
            <p className='text-sm text-muted-foreground'>{item.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
