-- user_profiles.telegram_chat_id is the only source of truth for where a
-- customer's alerts go. Unlinking on the website cleared the profile but left
-- the old chat id on every monitor, so alerts kept arriving while the account
-- (and the bot's /status) said Telegram was not connected.

-- One-time sync: monitors keep a chat id only when it is the owner's current one.
update public.user_monitors monitor
set telegram_chat_id = null
from public.user_profiles profile
where profile.user_id = monitor.user_id
  and monitor.telegram_chat_id is not null
  and monitor.telegram_chat_id is distinct from profile.telegram_chat_id;

create or replace function public.sync_monitor_telegram_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_monitors
  set telegram_chat_id = new.telegram_chat_id
  where user_id = new.user_id
    and telegram_chat_id is distinct from new.telegram_chat_id;
  return new;
end;
$$;

revoke execute on function public.sync_monitor_telegram_chat() from public, anon, authenticated;

drop trigger if exists sync_monitor_telegram_chat_trigger on public.user_profiles;
create trigger sync_monitor_telegram_chat_trigger
after update of telegram_chat_id on public.user_profiles
for each row
when (old.telegram_chat_id is distinct from new.telegram_chat_id)
execute function public.sync_monitor_telegram_chat();
