# Visual Monitor Selector Extension

Bu Chrome extension Change Monitor üçün real brauzer tabında CSS selector seçməyə imkan verir.

## Quraşdırma

1. Chrome-da `chrome://extensions` aç.
2. `Developer mode` aktiv et.
3. `Load unpacked` kliklə.
4. Bu qovluğu seç:
   `chrome-extension/visual-monitor-selector`
5. Əgər extension artıq yüklənibsə, `Reload` düyməsini bas.

## İstifadə

Extension iki Change Monitor səhifəsi ilə işləyir:

- Admin panel: `/admin/change-monitor`
- İstifadəçi workspace-i: `/monitor/watch-monitor`

1. Admin və ya istifadəçi panelində uyğun Change Monitor səhifəsi açıq olsun.
2. Yeni izləmə formunda URL yaz.
3. `Brauzerdə aç` düyməsi ilə saytı aç.
4. Açılan saytda sağ altda `Visual Monitor` paneli görünməlidir.
5. Panel görünmürsə, Chrome toolbar-da Visual Monitor extension iconuna kliklə.
6. `Selector seç` kliklə.
7. İzlənəcək hissəyə kliklə.
8. Lazımdırsa `Daha kiçik` və ya `Üst element` düymələri ilə seçimi dəqiqləşdir.
9. Sağ altdakı paneldə `Təsdiqlə` kliklə.
10. Change Monitor səhifəsi açıqdırsa, seçim mövcud sessiya ilə avtomatik izləmələr siyahısına əlavə ediləcək.

## Qeyd

Bu extension discovery etmir və özü bazaya yazmır. Seçilən selectoru Chrome storage üzərindən açıq Change Monitor səhifəsinə ötürür; bazaya yazma əməliyyatı həmin səhifədəki mövcud Supabase sessiyası ilə icra olunur.

Selector pəncərəsində açılmayan Cloudflare, JS-rendered, iframe/CSP və ya Edge proxy-ni bloklayan saytlar üçün real brauzer tabında bu extension-dan istifadə etmək lazımdır.
