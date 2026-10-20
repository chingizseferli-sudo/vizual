-- Remember the chat a profile was unlinked from, so that exact chat can relink
-- with a plain /start. Telegram vouches for the chat id of an incoming message,
-- and this chat was linked to the account before through a one-time token.
-- Only this trigger writes the column; customers cannot point it at another chat.

alter table public.user_profiles add column if not exists last_telegram_chat_id text;

create index if not exists user_profiles_last_telegram_chat_id_idx
  on public.user_profiles (last_telegram_chat_id) where last_telegram_chat_id is not null;

create or replace function public.remember_last_telegram_chat()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.telegram_chat_id is not null and new.telegram_chat_id is null then
    new.last_telegram_chat_id := old.telegram_chat_id;
  elsif current_user in ('anon', 'authenticated') then
    new.last_telegram_chat_id := case when tg_op = 'UPDATE' then old.last_telegram_chat_id end;
  end if;
  return new;
end;
$$;

drop trigger if exists remember_last_telegram_chat_trigger on public.user_profiles;
create trigger remember_last_telegram_chat_trigger
before insert or update on public.user_profiles
for each row
execute function public.remember_last_telegram_chat();
