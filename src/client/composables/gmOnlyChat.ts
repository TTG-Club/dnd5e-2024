/**
 * Сообщения чата «только для мастера» (`ChatSendOptions.gmOnly`): их видят
 * мастера и сам автор, остальным игрокам сервер их не присылает, а кнопки
 * под дополнениями видит только мастер.
 *
 * Опция появилась в контракте хоста 1.2.0 (VTTG 0.9.726). Старее она молча не
 * действует — сообщение увидели бы все, поэтому система шлёт скрытое, только
 * когда хост его умеет, а иначе молчит.
 */

import { compareVersions } from '@vtt/shared';

/** Версия контракта хоста, с которой сообщение «только для мастера» скрыто */
const GM_ONLY_CHAT_CONTRACT_VERSION = '1.2.0';

/**
 * Скроет ли хост от игроков сообщение с `gmOnly`. Версию контракта ставит
 * приложение до загрузки системы (`globalThis.__VTTHostContract`); нет её —
 * приложение старое и опции не знает.
 *
 * @returns `true`, если сообщение «только для мастера» игроки не увидят
 */
export function canSendGmOnlyChat(): boolean {
  const version = globalThis.__VTTHostContract?.contractVersion;

  return (
    version !== undefined
    && compareVersions(version, GM_ONLY_CHAT_CONTRACT_VERSION) >= 0
  );
}
