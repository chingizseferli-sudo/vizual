-- Site copy: the worker now watches 700+ news sites, not 280+.
-- Only rows still holding the old built-in text are changed, so admin edits stay.

update public.public_site_sections
set content = jsonb_set(content, '{description}', to_jsonb(replace(content ->> 'description', '280-dən çox', '700-dən çox'))),
    updated_at = now()
where content ->> 'description' like '%280-dən çox%';

update public.public_site_sections s
set content = jsonb_set(s.content, '{items}', (
      select jsonb_agg(
        case when item ->> 'description' like '%280-dən çox%'
          then jsonb_set(item, '{description}', to_jsonb(replace(item ->> 'description', '280-dən çox', '700-dən çox')))
          else item end
        order by ord)
      from jsonb_array_elements(s.content -> 'items') with ordinality as e(item, ord)
    )),
    updated_at = now()
where jsonb_typeof(s.content -> 'items') = 'array'
  and s.content -> 'items' @? '$[*] ? (@.description like_regex "280-dən çox")';
