alter table public.public_site_settings
  alter column seo_title set default U&'Vizual.Az - Kommunikasiya v\0259 Media Monitorinq Platformas\0131',
  alter column seo_description set default U&'Media m\0259nb\0259l\0259rind\0259 yay\0131mlanan materiallar\0131, vebsayt d\0259yi\015fiklikl\0259rini v\0259 t\0259\015fkilat\0131n\0131z haqq\0131nda vacib m\0259lumatlar\0131 bir platformadan izl\0259yin.',
  alter column og_description set default U&'Media monitorinqi, vebsayt d\0259yi\015fiklikl\0259ri v\0259 vacib bildiri\015fl\0259r bir platformada.';

update public.public_site_settings
set
  site_name = 'Vizual.Az',
  site_url = 'https://vizual.az',
  logo_url = '/images/vizual-logo.svg',
  icon_url = '/images/vizual-icon.svg',
  seo_title = U&'Vizual.Az - Kommunikasiya v\0259 Media Monitorinq Platformas\0131',
  seo_description = U&'Media m\0259nb\0259l\0259rind\0259 yay\0131mlanan materiallar\0131, vebsayt d\0259yi\015fiklikl\0259rini v\0259 t\0259\015fkilat\0131n\0131z haqq\0131nda vacib m\0259lumatlar\0131 bir platformadan izl\0259yin.',
  og_title = 'Vizual.Az',
  og_description = U&'Media monitorinqi, vebsayt d\0259yi\015fiklikl\0259ri v\0259 vacib bildiri\015fl\0259r bir platformada.',
  updated_at = now()
where id = 'main';
