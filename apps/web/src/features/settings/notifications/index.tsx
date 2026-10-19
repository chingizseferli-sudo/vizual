import { ContentSection } from '../components/content-section'
import { SettingsInfoPanel } from '../components/settings-info-panel'

export function SettingsNotifications() {
  return (
    <ContentSection
      title='Bildirişlər'
      desc='Admin bildirişləri və sistem xəbərdarlıqları haqqında məlumat.'
    >
      <SettingsInfoPanel
        items={[
          {
            title: 'Admin bildirişləri',
            description:
              'Admin paneldə mənbə, bot və sistem vəziyyəti üzrə bildiriş məntiqi ayrıca əməliyyat səhifələrində göstərilir.',
          },
          {
            title: 'Telegram bildirişləri',
            description:
              'Telegram bildirişləri monitorinq nəticələrinə bağlıdır. Bu bölmə Telegram çatdırılma qaydalarını dəyişmir.',
          },
          {
            title: 'Email bildirişləri',
            description:
              'Email bildirişləri Release 1-də aktiv deyil və ayrıca mərhələdə planlaşdırılacaq.',
          },
        ]}
      />
    </ContentSection>
  )
}
