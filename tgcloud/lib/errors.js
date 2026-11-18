// Maps low-level failures to short messages a user can understand.

export function friendlyError(error) {
  const raw = String(error?.message ?? error ?? '');

  if (/401|403|unauthorized|invalid.*key|api key/i.test(raw)) {
    return '🔑 AI-сервис не принял ключ доступа. Проверь `AI_API_KEY` в `tgcloud/lib/config.js`.';
  }
  if (/429|too many|rate limit|quota/i.test(raw)) {
    return '⏳ Слишком много запросов к AI-сервису. Подожди немного и попробуй снова.';
  }
  if (/timeout|timed out|network|fetch failed|ECONN|ENOTFOUND/i.test(raw)) {
    return '🌐 Не удалось связаться с AI-сервисом. Попробуй ещё раз через минуту.';
  }
  if (/stream|empty body/i.test(raw)) {
    return '📡 AI-сервис прервал ответ. Попробуй повторить запрос.';
  }

  const safe = raw.replace(/`/g, 'ˋ').slice(0, 240);
  return `😔 Не получилось получить ответ.\n\n\`${safe || 'unknown error'}\``;
}
