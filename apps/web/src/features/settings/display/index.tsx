import { ContentSection } from '../components/content-section'
import { SettingsInfoPanel } from '../components/settings-info-panel'

export function SettingsDisplay() {
  return (
    <ContentSection
      title='Ekran'
      desc='Admin panel görünüşü və menyu davranışı haqqında məlumat.'
    >
      <SettingsInfoPanel
        items={[
          {
            title: 'Menyu sabitliyi',
            description:
              'Admin menyusu məhsul modullarına uyğun qurulub. Demo menyu elementləri aktiv interfeysdən çıxarılıb.',
          },
          {
            title: 'Responsiv görünüş',
            description:
              'Panel masaüstü və kiçik ekranlarda istifadə üçün mövcud layout qaydaları ilə işləyir.',
          },
        ]}
      />
    </ContentSection>
  )
}
