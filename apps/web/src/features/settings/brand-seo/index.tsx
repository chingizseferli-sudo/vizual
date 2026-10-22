import { useEffect, useState } from 'react'
import { Globe2, Image, Loader2, SearchCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  applyPublicSiteMetadata,
  defaultPublicSiteSettings,
  loadPublicSiteSettings,
  savePublicSiteSettings,
  type PublicSiteSettings,
} from '@/lib/public-site-settings'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ContentSection } from '../components/content-section'
import { friendlyError } from '@/lib/friendly-error'

const text = {
  title: 'Brend v\u0259 SEO',
  desc: 'Logo, ikon v\u0259 Google n\u0259tic\u0259sind\u0259 g\u00f6r\u00fcn\u0259c\u0259k public sayt m\u0259lumatlar\u0131n\u0131 idar\u0259 edin.',
  logoTitle: 'Logo v\u0259 ikon',
  logoDesc:
    'Public sayt, brauzer tab\u0131 v\u0259 payla\u015f\u0131m preview-l\u0259ri \u00fc\u00e7\u00fcn \u0259sas brend fayllar\u0131.',
  logoFile: 'Logo fayl\u0131',
  iconFile: 'Icon / favicon fayl\u0131',
  logoUpload: 'Logo y\u00fckl\u0259',
  iconUpload: 'Icon y\u00fckl\u0259',
  uploadHint: 'PNG, JPG v\u0259 ya WebP fayl\u0131 se\u00e7in.',
  uploadSuccess:
    'Fayl y\u00fckl\u0259ndi. Yadda saxlama\u011f\u0131 unutmay\u0131n.',
  uploadError:
    'Fayl\u0131 y\u00fckl\u0259m\u0259k m\u00fcmk\u00fcn olmad\u0131.',
  invalidFile:
    'Yaln\u0131z \u015f\u0259kil fayl\u0131 y\u00fckl\u0259m\u0259k olar.',
  googleTitle: 'Google g\u00f6r\u00fcn\u00fc\u015f\u00fc',
  googleDesc:
    'Google v\u0259 payla\u015f\u0131m platformalar\u0131nda g\u00f6r\u00fcn\u0259c\u0259k ba\u015fl\u0131q v\u0259 t\u0259svir.',
  siteName: 'Sayt ad\u0131',
  searchTitle: 'Axtar\u0131\u015f ba\u015fl\u0131\u011f\u0131',
  searchDescription: 'Axtar\u0131\u015f t\u0259sviri',
  shareTitle: 'Payla\u015f\u0131m ba\u015fl\u0131\u011f\u0131',
  shareDescription: 'Payla\u015f\u0131m t\u0259sviri',
  googlePreview: 'Google n\u0259tic\u0259si preview',
  save: 'Yadda saxla',
  loading: 'M\u0259lumatlar y\u00fckl\u0259nir...',
  saved: 'Brend v\u0259 SEO m\u0259lumatlar\u0131 yadda saxlan\u0131ld\u0131.',
  saveError:
    'M\u0259lumatlar\u0131 yadda saxlamaq m\u00fcmk\u00fcn olmad\u0131.',
  applied:
    'D\u0259yi\u015fiklikl\u0259r public sayt metadatas\u0131na t\u0259tbiq olunur.',
}

const ASSET_BUCKET = 'public-site-assets'
const MAX_FILE_SIZE = 2 * 1024 * 1024

export function SettingsBrandSeo() {
  const [settings, setSettings] = useState<PublicSiteSettings>(
    defaultPublicSiteSettings
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingField, setUploadingField] = useState<
    'logo_url' | 'icon_url' | null
  >(null)

  useEffect(() => {
    let isMounted = true

    loadPublicSiteSettings()
      .then((data) => {
        if (isMounted) setSettings(data)
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const updateField = (field: keyof PublicSiteSettings, value: string) => {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleSave = async () => {
    setIsSaving(true)

    try {
      await savePublicSiteSettings(settings)
      applyPublicSiteMetadata(settings)
      toast.success(text.saved)
    } catch (error) {
      const message = friendlyError(error, text.saveError)
      toast.error(message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleAssetUpload = async (
    file: File | undefined,
    field: 'logo_url' | 'icon_url'
  ) => {
    if (!file) return

    // No SVG: it can carry script and is served from the public storage origin.
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error(text.invalidFile)
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error('Fayl 2 MB-dan b\u00f6y\u00fck olmamal\u0131d\u0131r.')
      return
    }

    setUploadingField(field)

    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
      const filename = `${field.replace('_url', '')}-${Date.now()}.${extension}`
      const path = `brand/${filename}`
      const { error } = await supabase.storage
        .from(ASSET_BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: true,
        })

      if (error) throw error

      const { data } = supabase.storage.from(ASSET_BUCKET).getPublicUrl(path)
      updateField(field, data.publicUrl)
      toast.success(text.uploadSuccess)
    } catch (error) {
      const message = friendlyError(error, text.uploadError)
      toast.error(message)
    } finally {
      setUploadingField(null)
    }
  }

  return (
    <ContentSection title={text.title} desc={text.desc}>
      <div className='space-y-6'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Image className='size-4' />
              {text.logoTitle}
            </CardTitle>
            <CardDescription>{text.logoDesc}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='rounded-lg border bg-muted/20 p-4'>
              <img
                src={settings.logo_url || defaultPublicSiteSettings.logo_url}
                alt='Vizual.Az logo'
                className='h-16 max-w-full object-contain object-left'
              />
            </div>
            <div className='grid gap-4 sm:grid-cols-[88px_1fr]'>
              <div className='flex size-20 items-center justify-center rounded-2xl border bg-muted/20'>
                <img
                  src={settings.icon_url || defaultPublicSiteSettings.icon_url}
                  alt='Vizual.Az ikon'
                  className='size-12'
                />
              </div>
              <div className='space-y-3'>
                <div className='space-y-1.5'>
                  <Label htmlFor='brand-logo'>{text.logoFile}</Label>
                  <Input
                    id='brand-logo'
                    value={settings.logo_url}
                    onChange={(event) =>
                      updateField('logo_url', event.target.value)
                    }
                  />
                  <div className='flex flex-wrap items-center gap-2'>
                    <Input
                      id='brand-logo-upload'
                      type='file'
                      accept='image/png,image/jpeg,image/webp'
                      className='max-w-xs'
                      onChange={(event) =>
                        handleAssetUpload(event.target.files?.[0], 'logo_url')
                      }
                    />
                    <span className='text-xs text-muted-foreground'>
                      {uploadingField === 'logo_url'
                        ? text.loading
                        : text.uploadHint}
                    </span>
                  </div>
                </div>
                <div className='space-y-1.5'>
                  <Label htmlFor='brand-icon'>{text.iconFile}</Label>
                  <Input
                    id='brand-icon'
                    value={settings.icon_url}
                    onChange={(event) =>
                      updateField('icon_url', event.target.value)
                    }
                  />
                  <div className='flex flex-wrap items-center gap-2'>
                    <Input
                      id='brand-icon-upload'
                      type='file'
                      accept='image/png,image/jpeg,image/webp'
                      className='max-w-xs'
                      onChange={(event) =>
                        handleAssetUpload(event.target.files?.[0], 'icon_url')
                      }
                    />
                    <span className='text-xs text-muted-foreground'>
                      {uploadingField === 'icon_url'
                        ? text.loading
                        : text.uploadHint}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <SearchCheck className='size-4' />
              {text.googleTitle}
            </CardTitle>
            <CardDescription>{text.googleDesc}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='site-name'>{text.siteName}</Label>
                <Input
                  id='site-name'
                  value={settings.site_name}
                  onChange={(event) =>
                    updateField('site_name', event.target.value)
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='site-url'>Sayt URL</Label>
                <Input
                  id='site-url'
                  value={settings.site_url}
                  onChange={(event) =>
                    updateField('site_url', event.target.value)
                  }
                />
              </div>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='seo-title'>{text.searchTitle}</Label>
              <Input
                id='seo-title'
                value={settings.seo_title}
                onChange={(event) =>
                  updateField('seo_title', event.target.value)
                }
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='seo-description'>{text.searchDescription}</Label>
              <Textarea
                id='seo-description'
                className='min-h-24'
                value={settings.seo_description}
                onChange={(event) =>
                  updateField('seo_description', event.target.value)
                }
              />
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='og-title'>{text.shareTitle}</Label>
                <Input
                  id='og-title'
                  value={settings.og_title}
                  onChange={(event) =>
                    updateField('og_title', event.target.value)
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='og-description'>{text.shareDescription}</Label>
                <Input
                  id='og-description'
                  value={settings.og_description}
                  onChange={(event) =>
                    updateField('og_description', event.target.value)
                  }
                />
              </div>
            </div>

            <div className='rounded-lg border bg-background p-4'>
              <div className='mb-3 flex items-center gap-2 text-sm text-muted-foreground'>
                <Globe2 className='size-4' />
                {text.googlePreview}
              </div>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>
                  {settings.site_url}
                </p>
                <p className='text-lg leading-snug font-medium text-foreground'>
                  {settings.seo_title}
                </p>
                <p className='text-sm leading-6 text-muted-foreground'>
                  {settings.seo_description}
                </p>
              </div>
            </div>

            <div className='flex flex-wrap items-center gap-3'>
              <Button type='button' onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className='animate-spin' /> : null}
                {text.save}
              </Button>
              <p className='text-xs text-muted-foreground'>
                {isLoading ? text.loading : text.applied}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </ContentSection>
  )
}
