import { ContentSection } from '../components/content-section'
import { SettingsInfoPanel } from '../components/settings-info-panel'

export function SettingsAccount() {
  return (
    <ContentSection
      title='Hesab'
      desc='Admin hesabı və giriş təhlükəsizliyi haqqında əsas məlumatlar.'
    >
      <SettingsInfoPanel
        items={[
          {
            title: 'Giriş məlumatları',
            description:
              'Admin girişi Supabase Auth və rol əsaslı yoxlama ilə qorunur. Şifrə və sessiya əməliyyatları auth sistemi üzərindən idarə olunur.',
          },
          {
            title: 'Rol və icazələr',
            description:
              'Admin və superadmin icazələri user_profiles rol məlumatına əsasən tətbiq edilir. Bu səhifə rol dəyişdirmir.',
          },
          {
            title: 'Dil və regional ayarlar',
            description:
              'Platformanın görünən dili Azərbaycan dilidir. Əlavə dil seçimi ayrıca məhsul mərhələsində aktivləşdiriləcək.',
          },
          {
            title: 'Hesab təhlükəsizliyi',
            description:
              'Admin hesabları üçün giriş, çıxış və qorunan səhifələr mövcud auth qaydaları ilə işləyir.',
          },
        ]}
      />
    </ContentSection>
  )
}
