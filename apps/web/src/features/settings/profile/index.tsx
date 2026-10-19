import { ContentSection } from '../components/content-section'
import { SettingsInfoPanel } from '../components/settings-info-panel'

export function SettingsProfile() {
  return (
    <ContentSection
      title='Profil'
      desc='Admin profilinin platformada necə istifadə edildiyi.'
    >
      <SettingsInfoPanel
        items={[
          {
            title: 'Admin profili',
            description:
              'Admin profil məlumatları giriş sessiyası və user_profiles cədvəlindəki rol/status məlumatları ilə müəyyən olunur.',
          },
          {
            title: 'Public saytla əlaqə',
            description:
              'Public saytda görünən mətnlər və bölmələr ayrıca “Sayt məzmunu” bölməsindən idarə edilir.',
          },
          {
            title: 'Şəxsi demo sahələri silindi',
            description:
              'Template-dən qalan bio, sosial link və istifadəçi adı formaları admin paneldən çıxarıldı.',
          },
        ]}
      />
    </ContentSection>
  )
}
