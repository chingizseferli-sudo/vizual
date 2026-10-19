// Separate handwritten synthetic long-content probes, not heldout sentiment data.
const entity = { name: 'Bakı Dövlət Universiteti', aliases: [] }
const complaints = [
  'Bakı Dövlət Universiteti dərs cədvəlini son anda dəyişir və bundan narazıyam. Hər həftə iş saatımı yenidən planlaşdırmaq mənim üçün çətindir. Öz dərslərimlə bağlı şəxsi təcrübəmi yazıram; digər tələbələrin hamısının eyni fikirdə olduğunu söyləmirəm. Cədvəl əvvəlcədən paylaşılsa, dərsə gəlişimi və kitabxanada çalışma vaxtımı daha rahat təşkil edə bilərəm.',
  'Bakı Dövlət Universiteti dərs cədvəlində uzun boşluqlar saxlayır, bu qaydadan şikayət edirəm. Səhər dərsimlə axşam dərsim arasında şəhərdən evə qayıtmaq çətindir. Bu mətn yalnız mənim yaşadığım cədvəl çətinliyini təsvir edir. Başqa müəlliflərin təcrübəsi yoxlanılmayıb və ümumi tələbə mövqeyi barədə statistik məlumatım yoxdur.',
  'Bakı Dövlət Universiteti dərs cədvəlini aydın paylaşmır, bunun yaratdığı gecikmədən narazıyam. Dərs otağını və saatını vaxtında dəqiqləşdirmək üçün bir neçə dəfə soruşmalı oldum. Bu, öz gördüyüm proses barədə şəxsi rəydir. Universitetin digər proqramlarının vəziyyətini bilmirəm və həmin proqramlar haqqında əlavə nəticə çıxarmıram.',
]
const incidents = [
  'Bakı Dövlət Universiteti tədris binasında yanğın baş verdiyini açıqlayıb. Hadisənin vaxtı rəsmi məlumatda göstərilir və yanğının səbəbi araşdırılır. Dərslərin bir hissəsi müvəqqəti başqa korpusa keçirilib. Bu xəbər hadisə barədə verilmiş məlumatları xülasə edir; tələbələrin universitet haqqında mövqeyini ölçmür və müəllifin narazılığını ifadə etmir.',
  'Bakı Dövlət Universiteti korpusunda su borusunun zədələndiyi və təmir başladığı barədə xəbər yayıb. Təmirin tamamlanacağı vaxt hələ dəqiqləşdirilməyib. Binanın həmin hissəsinə giriş müvəqqəti məhdudlaşdırılıb. Mətn tədbirlərin ardıcıllığını bildirir; xidmətin keyfiyyəti haqqında şəxsi qiymətləndirmə və ictimai rəy sorğusunun nəticəsi verilmir.',
  'Bakı Dövlət Universiteti kampusunda yol qəzasının baş verdiyi barədə polis məlumatı yayılıb. Xəbərdə hadisənin yeri, tarixi və araşdırmanın davam etdiyi bildirilir. Hadisəyə səbəb olan amillər barədə yekun nəticə açıqlanmayıb. Bu mətn insident haqqında məlumatdır; təşkilata yönəlmiş müəllif şikayəti və ya tələbələrin ümumi sentimenti deyil.',
]
function originals(texts, id, expected, titleOnly = false) {
  return texts.map((text, index) => ({
    id: `${id}-${index}`,
    title: titleOnly ? text : `Sintetik material ${index + 1}`,
    url: `https://safety-${index}.example.invalid/${id}`,
    source_id: `synthetic-source-${index}`,
    publisher: `Sintetik mənbə ${index + 1}`,
    published_at: '2026-10-13T09:00:00Z',
    detected_at: '2026-10-13T10:00:00Z',
    expected,
    metadata: titleOnly
      ? {}
      : {
          excerpt: text,
          // The Tester authored this synthetic text; simulate owned-source
          // permission for the positive eligible-content probe, not real rights.
          permission_verified: true,
          retrieved_at: '2026-10-13T11:00:00Z',
          content_quality: {
            label: 'substantial_excerpt',
            main_content_detected: true,
            extracted_chars: Array.from(text).length,
            retained_chars: Array.from(text).length,
          },
        },
  }))
}
export const safetyProbes = [
  {
    id: 'unverified-substantive-complaints',
    entity,
    expectedMayRecommend: false,
    items: originals(complaints, 'unverified', {
      sentiment: 'negative',
      stance: 'opinion',
    }).map((item) => ({
      ...item,
      metadata: { ...item.metadata, permission_verified: false },
    })),
  },
  {
    id: 'substantive-complaints',
    entity,
    expectedMayRecommend: true,
    items: originals(complaints, 'complaints', {
      sentiment: 'negative',
      stance: 'opinion',
    }),
  },
  {
    id: 'adverse-incidents',
    entity,
    expectedMayRecommend: false,
    items: originals(incidents, 'incidents', {
      sentiment: 'neutral',
      stance: 'fact_report',
    }),
  },
  {
    id: 'syndicated-copy',
    entity,
    expectedMayRecommend: false,
    items: originals(
      [complaints[0], complaints[0], complaints[0]],
      'syndicated',
      { sentiment: 'negative', stance: 'opinion' }
    ),
  },
  {
    id: 'title-only',
    entity,
    expectedMayRecommend: false,
    items: originals(
      [
        'Bakı Dövlət Universiteti tələbələrinin cədvəldən şikayəti',
        'Bakı Dövlət Universiteti cədvəl narazılığı',
        'Bakı Dövlət Universiteti dərs saatları problemi',
      ],
      'title',
      { sentiment: 'uncertain', stance: 'uncertain' },
      true
    ),
  },
]
