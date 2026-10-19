alter table public.user_monitors
add column if not exists telegram_chat_id text;

comment on column public.user_monitors.telegram_chat_id
is 'Telegram chat/channel id used by the bot for monitor notifications.';
