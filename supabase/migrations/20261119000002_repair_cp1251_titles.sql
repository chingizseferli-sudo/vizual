-- Russian titles that were stored as UTF-8 read through Windows-1251
-- ("РќР° РІРµСЂС€РёРЅРµ" instead of "На вершине"). The worker now decodes such
-- pages correctly; this turns the titles already saved back into text.
-- A title is changed only when its Windows-1251 bytes are valid UTF-8, which
-- ordinary Russian or Azerbaijani text never is.

create or replace function pg_temp.repair_cp1251_title(p_title text)
returns text
language plpgsql
as $$
declare
  parts text[];
  raw bytea := ''::bytea;
  i integer;
begin
  -- Windows-1251 has no character for byte 0x98 (second byte of "И"), so the
  -- worker saved U+FFFD in its place.
  parts := string_to_array(p_title, chr(65533));
  for i in 1 .. coalesce(array_length(parts, 1), 0) loop
    if i > 1 then
      raw := raw || '\x98'::bytea;
    end if;
    raw := raw || convert_to(parts[i], 'WIN1251');
  end loop;
  return convert_from(raw, 'UTF8');
exception when others then
  return p_title;
end;
$$;

update public.monitored_items
set title = pg_temp.repair_cp1251_title(title)
where title ~ '[А-Я][ЂЃ‚ѓ†‡€‰Љ‹ЊЌЋЏђ•™љ›њќћџЎўЈ¤Ґ¦§Ё©Є¬®Ї°±Ііґµ¶ёєјЅѕї�].*[А-Я][ЂЃ‚ѓ†‡€‰Љ‹ЊЌЋЏђ•™љ›њќћџЎўЈ¤Ґ¦§Ё©Є¬®Ї°±Ііґµ¶ёєјЅѕї�]'
  and pg_temp.repair_cp1251_title(title) <> title;

update public.sent_news
set title = pg_temp.repair_cp1251_title(title)
where title ~ '[А-Я][ЂЃ‚ѓ†‡€‰Љ‹ЊЌЋЏђ•™љ›њќћџЎўЈ¤Ґ¦§Ё©Є¬®Ї°±Ііґµ¶ёєјЅѕї�].*[А-Я][ЂЃ‚ѓ†‡€‰Љ‹ЊЌЋЏђ•™љ›њќћџЎўЈ¤Ґ¦§Ё©Є¬®Ї°±Ііґµ¶ёєјЅѕї�]'
  and pg_temp.repair_cp1251_title(title) <> title;
