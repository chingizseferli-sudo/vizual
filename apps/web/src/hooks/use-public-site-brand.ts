import { useEffect, useState } from 'react'
import {
  defaultPublicSiteSettings,
  loadPublicSiteSettings,
  type PublicSiteSettings,
} from '@/lib/public-site-settings'

export function usePublicSiteBrand() {
  const [settings, setSettings] = useState<PublicSiteSettings>(
    defaultPublicSiteSettings
  )

  useEffect(() => {
    let isMounted = true

    loadPublicSiteSettings().then((data) => {
      if (isMounted) setSettings(data)
    })

    return () => {
      isMounted = false
    }
  }, [])

  return {
    settings,
    siteName: settings.site_name || defaultPublicSiteSettings.site_name,
    logoUrl: settings.logo_url || defaultPublicSiteSettings.logo_url,
    iconUrl: settings.icon_url || defaultPublicSiteSettings.icon_url,
  }
}
