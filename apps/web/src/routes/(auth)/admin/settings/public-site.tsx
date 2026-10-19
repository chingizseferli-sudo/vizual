import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  defaultPublicSiteContent,
  invalidatePublicSiteContentCache,
  publicSiteSectionKeys,
  type PublicAudience,
  type PublicDemoItem,
  type PublicPlan,
  type PublicService,
  type PublicSiteContent,
  type PublicSiteSectionKey,
} from '@/lib/public-site-content'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type SectionRow = {
  section_key: string
  content: unknown
}

function splitLines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinLines(value: string[]) {
  return value.join('\n')
}

function mergeContent(rows: SectionRow[] | null): PublicSiteContent {
  if (!rows) return defaultPublicSiteContent

  return rows.reduce<PublicSiteContent>((content, row) => {
    const key = row.section_key as PublicSiteSectionKey

    if (
      !publicSiteSectionKeys.includes(key) ||
      !row.content ||
      typeof row.content !== 'object'
    ) {
      return content
    }

    return {
      ...content,
      [key]: {
        ...content[key],
        ...(row.content as Record<string, unknown>),
      },
    }
  }, defaultPublicSiteContent)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='grid gap-2'>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='rounded-lg border bg-card p-4'>
      <h3 className='text-base font-semibold'>{title}</h3>
      <div className='mt-4 grid gap-4'>{children}</div>
    </section>
  )
}

function PublicSiteSettingsPage() {
  const [content, setContent] = useState<PublicSiteContent>(
    defaultPublicSiteContent
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true

    async function loadContent() {
      setLoading(true)

      const { data, error } = await supabase
        .from('public_site_sections')
        .select('section_key, content')
        .in('section_key', [...publicSiteSectionKeys])

      if (!active) return

      if (error) {
        toast.error('Sayt məzmunu yüklənmədi. Default məzmun göstərilir.')
        setContent(defaultPublicSiteContent)
      } else {
        setContent(mergeContent(data as SectionRow[]))
      }

      setLoading(false)
    }

    loadContent()

    return () => {
      active = false
    }
  }, [])

  function updateSection<K extends PublicSiteSectionKey>(
    key: K,
    patch: Partial<PublicSiteContent[K]>
  ) {
    setContent((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch,
      },
    }))
  }

  function updateService(index: number, patch: Partial<PublicService>) {
    setContent((current) => ({
      ...current,
      services: {
        ...current.services,
        items: current.services.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item
        ),
      },
    }))
  }

  function updateAudience(index: number, patch: Partial<PublicAudience>) {
    setContent((current) => ({
      ...current,
      audiences: {
        ...current.audiences,
        items: current.audiences.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item
        ),
      },
    }))
  }

  function updatePrinciple(index: number, patch: Partial<PublicAudience>) {
    setContent((current) => ({
      ...current,
      about: {
        ...current.about,
        principles: current.about.principles.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item
        ),
      },
    }))
  }

  function updatePlan(index: number, patch: Partial<PublicPlan>) {
    setContent((current) => ({
      ...current,
      pricing: {
        ...current.pricing,
        plans: current.pricing.plans.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item
        ),
      },
    }))
  }

  function updateDemoItem(index: number, patch: Partial<PublicDemoItem>) {
    setContent((current) => ({
      ...current,
      demo: {
        ...current.demo,
        items: current.demo.items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item
        ),
      },
    }))
  }

  async function saveContent() {
    setSaving(true)

    const { data: userData } = await supabase.auth.getUser()
    const updatedBy = userData.user?.id ?? null
    const now = new Date().toISOString()

    const rows = publicSiteSectionKeys.map((key) => ({
      section_key: key,
      content: content[key],
      status: 'published',
      updated_by: updatedBy,
      updated_at: now,
    }))

    const { error } = await supabase
      .from('public_site_sections')
      .upsert(rows, { onConflict: 'section_key' })

    setSaving(false)

    if (error) {
      toast.error(`Məzmun yadda saxlanmadı: ${error.message}`)
      return
    }

    invalidatePublicSiteContentCache()
    toast.success('Public sayt məzmunu yeniləndi.')
  }

  return (
    <div className='w-full space-y-4 overflow-y-auto pr-2'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-xl font-bold tracking-tight'>Sayt məzmunu</h2>
          <p className='text-sm text-muted-foreground'>
            Ana səhifə və public bölmələrdə görünən mətnləri buradan idarə edin.
          </p>
        </div>
        <Button onClick={saveContent} disabled={loading || saving}>
          {saving ? 'Yadda saxlanır...' : 'Dəyişiklikləri yayımla'}
        </Button>
      </div>

      <Tabs defaultValue='hero' className='w-full'>
        <TabsList className='flex h-auto w-full flex-wrap justify-start'>
          <TabsTrigger value='hero'>Baş səhifə</TabsTrigger>
          <TabsTrigger value='services'>Xidmətlər</TabsTrigger>
          <TabsTrigger value='audiences'>Auditoriya</TabsTrigger>
          <TabsTrigger value='demo'>Demo</TabsTrigger>
          <TabsTrigger value='pricing'>Qiymətlər</TabsTrigger>
          <TabsTrigger value='content'>Blog / Kampaniya</TabsTrigger>
          <TabsTrigger value='about'>Haqqımızda</TabsTrigger>
          <TabsTrigger value='contact'>Əlaqə</TabsTrigger>
        </TabsList>

        <TabsContent value='hero'>
          <Card title='Baş səhifə hero bölməsi'>
            <Field label='Yuxarı etiket'>
              <Input
                value={content.hero.badge}
                onChange={(event) =>
                  updateSection('hero', { badge: event.target.value })
                }
              />
            </Field>
            <Field label='Brend'>
              <Input
                value={content.hero.brand}
                onChange={(event) =>
                  updateSection('hero', { brand: event.target.value })
                }
              />
            </Field>
            <Field label='Slogan'>
              <Input
                value={content.hero.tagline}
                onChange={(event) =>
                  updateSection('hero', { tagline: event.target.value })
                }
              />
            </Field>
            <Field label='Təsvir'>
              <Textarea
                value={content.hero.description}
                onChange={(event) =>
                  updateSection('hero', { description: event.target.value })
                }
                rows={4}
              />
            </Field>
            <div className='grid gap-4 md:grid-cols-2'>
              <Field label='Əsas düymə'>
                <Input
                  value={content.hero.primaryCta}
                  onChange={(event) =>
                    updateSection('hero', { primaryCta: event.target.value })
                  }
                />
              </Field>
              <Field label='İkinci düymə'>
                <Input
                  value={content.hero.secondaryCta}
                  onChange={(event) =>
                    updateSection('hero', { secondaryCta: event.target.value })
                  }
                />
              </Field>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value='services'>
          <Card title='Xidmətlər'>
            <Field label='Yuxarı etiket'>
              <Input
                value={content.services.eyebrow}
                onChange={(event) =>
                  updateSection('services', { eyebrow: event.target.value })
                }
              />
            </Field>
            <Field label='Başlıq'>
              <Input
                value={content.services.title}
                onChange={(event) =>
                  updateSection('services', { title: event.target.value })
                }
              />
            </Field>
            <Field label='Təsvir'>
              <Textarea
                value={content.services.description}
                onChange={(event) =>
                  updateSection('services', { description: event.target.value })
                }
                rows={3}
              />
            </Field>
            <div className='grid gap-3'>
              {content.services.items.map((service, index) => (
                <div
                  key={`service-${index}`}
                  className='grid gap-3 rounded-lg border p-3'
                >
                  <div className='grid gap-3 md:grid-cols-[1fr_140px_140px]'>
                    <Field label='Xidmət adı'>
                      <Input
                        value={service.title}
                        onChange={(event) =>
                          updateService(index, { title: event.target.value })
                        }
                      />
                    </Field>
                    <Field label='Status'>
                      <Input
                        value={service.status}
                        onChange={(event) =>
                          updateService(index, { status: event.target.value })
                        }
                      />
                    </Field>
                    <Field label='İkon'>
                      <Input
                        value={service.icon}
                        onChange={(event) =>
                          updateService(index, {
                            icon: event.target.value as PublicService['icon'],
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field label='Təsvir'>
                    <Textarea
                      value={service.description}
                      onChange={(event) =>
                        updateService(index, {
                          description: event.target.value,
                        })
                      }
                      rows={3}
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value='audiences'>
          <Card title='Kimlər üçündür?'>
            <Field label='Yuxarı etiket'>
              <Input
                value={content.audiences.eyebrow}
                onChange={(event) =>
                  updateSection('audiences', { eyebrow: event.target.value })
                }
              />
            </Field>
            <Field label='Başlıq'>
              <Input
                value={content.audiences.title}
                onChange={(event) =>
                  updateSection('audiences', { title: event.target.value })
                }
              />
            </Field>
            <div className='grid gap-3'>
              {content.audiences.items.map((audience, index) => (
                <div
                  key={`audience-${index}`}
                  className='grid gap-3 rounded-lg border p-3'
                >
                  <Field label='Auditoriya adı'>
                    <Input
                      value={audience.title}
                      onChange={(event) =>
                        updateAudience(index, { title: event.target.value })
                      }
                    />
                  </Field>
                  <Field label='Təsvir'>
                    <Textarea
                      value={audience.description}
                      onChange={(event) =>
                        updateAudience(index, {
                          description: event.target.value,
                        })
                      }
                      rows={3}
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value='demo'>
          <Card title='Demo'>
            <Field label='Yuxarı etiket'>
              <Input
                value={content.demo.eyebrow}
                onChange={(event) =>
                  updateSection('demo', { eyebrow: event.target.value })
                }
              />
            </Field>
            <Field label='Başlıq'>
              <Input
                value={content.demo.title}
                onChange={(event) =>
                  updateSection('demo', { title: event.target.value })
                }
              />
            </Field>
            <Field label='Təsvir'>
              <Textarea
                value={content.demo.description}
                onChange={(event) =>
                  updateSection('demo', { description: event.target.value })
                }
                rows={3}
              />
            </Field>
            <div className='grid gap-4 md:grid-cols-2'>
              <Field label='Əsas düymə'>
                <Input
                  value={content.demo.primaryCta}
                  onChange={(event) =>
                    updateSection('demo', { primaryCta: event.target.value })
                  }
                />
              </Field>
              <Field label='İkinci düymə'>
                <Input
                  value={content.demo.secondaryCta}
                  onChange={(event) =>
                    updateSection('demo', { secondaryCta: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className='grid gap-4 md:grid-cols-2'>
              <Field label='Demo kart başlığı'>
                <Input
                  value={content.demo.placeholderTitle}
                  onChange={(event) =>
                    updateSection('demo', {
                      placeholderTitle: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label='Demo kart təsviri'>
                <Textarea
                  value={content.demo.placeholderDescription}
                  onChange={(event) =>
                    updateSection('demo', {
                      placeholderDescription: event.target.value,
                    })
                  }
                  rows={3}
                />
              </Field>
            </div>
            <div className='grid gap-3'>
              {content.demo.items.map((item, index) => (
                <div
                  key={`demo-item-${index}`}
                  className='grid gap-3 rounded-lg border p-3'
                >
                  <Field label='Demo nəticə başlığı'>
                    <Input
                      value={item.title}
                      onChange={(event) =>
                        updateDemoItem(index, { title: event.target.value })
                      }
                    />
                  </Field>
                  <div className='grid gap-3 md:grid-cols-3'>
                    <Field label='Mənbə'>
                      <Input
                        value={item.source}
                        onChange={(event) =>
                          updateDemoItem(index, { source: event.target.value })
                        }
                      />
                    </Field>
                    <Field label='Açar söz'>
                      <Input
                        value={item.keyword}
                        onChange={(event) =>
                          updateDemoItem(index, { keyword: event.target.value })
                        }
                      />
                    </Field>
                    <Field label='Saat'>
                      <Input
                        value={item.time}
                        onChange={(event) =>
                          updateDemoItem(index, { time: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value='pricing'>
          <Card title='Qiymətlər'>
            <Field label='Yuxarı etiket'>
              <Input
                value={content.pricing.eyebrow}
                onChange={(event) =>
                  updateSection('pricing', { eyebrow: event.target.value })
                }
              />
            </Field>
            <Field label='Başlıq'>
              <Input
                value={content.pricing.title}
                onChange={(event) =>
                  updateSection('pricing', { title: event.target.value })
                }
              />
            </Field>
            <Field label='Təsvir'>
              <Textarea
                value={content.pricing.description}
                onChange={(event) =>
                  updateSection('pricing', { description: event.target.value })
                }
                rows={3}
              />
            </Field>
            <div className='grid gap-3'>
              {content.pricing.plans.map((plan, index) => (
                <div
                  key={`plan-${index}`}
                  className='grid gap-3 rounded-lg border p-3'
                >
                  <div className='grid gap-3 md:grid-cols-[1fr_160px]'>
                    <Field label='Plan adı'>
                      <Input
                        value={plan.name}
                        onChange={(event) =>
                          updatePlan(index, { name: event.target.value })
                        }
                      />
                    </Field>
                    <Field label='Qiymət'>
                      <Input
                        value={plan.price}
                        onChange={(event) =>
                          updatePlan(index, { price: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <Field label='Təsvir'>
                    <Textarea
                      value={plan.description}
                      onChange={(event) =>
                        updatePlan(index, { description: event.target.value })
                      }
                      rows={3}
                    />
                  </Field>
                  <Field label='Xüsusiyyətlər'>
                    <Textarea
                      value={joinLines(plan.features)}
                      onChange={(event) =>
                        updatePlan(index, {
                          features: splitLines(event.target.value),
                        })
                      }
                      rows={5}
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value='content'>
          <div className='grid gap-4'>
            <Card title='Kampaniyalar'>
              <Field label='Yuxarı etiket'>
                <Input
                  value={content.campaigns.eyebrow}
                  onChange={(event) =>
                    updateSection('campaigns', { eyebrow: event.target.value })
                  }
                />
              </Field>
              <Field label='Başlıq'>
                <Input
                  value={content.campaigns.title}
                  onChange={(event) =>
                    updateSection('campaigns', { title: event.target.value })
                  }
                />
              </Field>
              <Field label='Təsvir'>
                <Textarea
                  value={content.campaigns.description}
                  onChange={(event) =>
                    updateSection('campaigns', {
                      description: event.target.value,
                    })
                  }
                  rows={3}
                />
              </Field>
            </Card>
            <Card title='Blog'>
              <Field label='Yuxarı etiket'>
                <Input
                  value={content.blog.eyebrow}
                  onChange={(event) =>
                    updateSection('blog', { eyebrow: event.target.value })
                  }
                />
              </Field>
              <Field label='Başlıq'>
                <Input
                  value={content.blog.title}
                  onChange={(event) =>
                    updateSection('blog', { title: event.target.value })
                  }
                />
              </Field>
              <Field label='Təsvir'>
                <Textarea
                  value={content.blog.description}
                  onChange={(event) =>
                    updateSection('blog', { description: event.target.value })
                  }
                  rows={3}
                />
              </Field>
              <Field label='Mövzular'>
                <Textarea
                  value={joinLines(content.blog.items)}
                  onChange={(event) =>
                    updateSection('blog', {
                      items: splitLines(event.target.value),
                    })
                  }
                  rows={6}
                />
              </Field>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value='about'>
          <Card title='Haqqımızda'>
            <Field label='Yuxarı etiket'>
              <Input
                value={content.about.eyebrow}
                onChange={(event) =>
                  updateSection('about', { eyebrow: event.target.value })
                }
              />
            </Field>
            <Field label='Başlıq'>
              <Input
                value={content.about.title}
                onChange={(event) =>
                  updateSection('about', { title: event.target.value })
                }
              />
            </Field>
            <Field label='Təsvir'>
              <Textarea
                value={content.about.description}
                onChange={(event) =>
                  updateSection('about', { description: event.target.value })
                }
                rows={5}
              />
            </Field>
            <div className='grid gap-3'>
              {content.about.principles.map((item, index) => (
                <div
                  key={`principle-${index}`}
                  className='grid gap-3 rounded-lg border p-3'
                >
                  <Field label='Prinsip başlığı'>
                    <Input
                      value={item.title}
                      onChange={(event) =>
                        updatePrinciple(index, { title: event.target.value })
                      }
                    />
                  </Field>
                  <Field label='Təsvir'>
                    <Textarea
                      value={item.description}
                      onChange={(event) =>
                        updatePrinciple(index, {
                          description: event.target.value,
                        })
                      }
                      rows={3}
                    />
                  </Field>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value='contact'>
          <Card title='Əlaqə'>
            <Field label='Yuxarı etiket'>
              <Input
                value={content.contact.eyebrow}
                onChange={(event) =>
                  updateSection('contact', { eyebrow: event.target.value })
                }
              />
            </Field>
            <Field label='Başlıq'>
              <Input
                value={content.contact.title}
                onChange={(event) =>
                  updateSection('contact', { title: event.target.value })
                }
              />
            </Field>
            <Field label='Təsvir'>
              <Textarea
                value={content.contact.description}
                onChange={(event) =>
                  updateSection('contact', { description: event.target.value })
                }
                rows={4}
              />
            </Field>
            <Field label='Kart başlığı'>
              <Input
                value={content.contact.cardTitle}
                onChange={(event) =>
                  updateSection('contact', { cardTitle: event.target.value })
                }
              />
            </Field>
            <Field label='Kart təsviri'>
              <Textarea
                value={content.contact.cardDescription}
                onChange={(event) =>
                  updateSection('contact', {
                    cardDescription: event.target.value,
                  })
                }
                rows={3}
              />
            </Field>
            <Field label='Email'>
              <Input
                value={content.contact.email}
                onChange={(event) =>
                  updateSection('contact', { email: event.target.value })
                }
              />
            </Field>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/settings/public-site')({
  component: PublicSiteSettingsPage,
})
