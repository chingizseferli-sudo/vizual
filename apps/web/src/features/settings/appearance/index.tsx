import { ContentSection } from '../components/content-section'
import { AppearanceForm } from './appearance-form'

export function SettingsAppearance() {
  return (
    <ContentSection
      title='Görünüş'
      desc='Admin panel üçün şrift və tema seçimini idarə edin.'
    >
      <AppearanceForm />
    </ContentSection>
  )
}
