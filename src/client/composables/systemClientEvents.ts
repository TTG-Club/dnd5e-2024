import type { SystemClientEvent } from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';

/** Канал ядра для событий правил от клиента */
const SYSTEM_CLIENT_EVENT_CHANNEL = 'system:client-event';

/**
 * Шлёт серверу событие правил. Сервер проверит отправителя и само событие и
 * выполнит его в системе — клиенту чужие сущности не менять.
 *
 * @param event - событие, собранное построителем движка
 */
export function emitSystemClientEvent(event: SystemClientEvent): void {
  useChatStore().getSocket()?.emit(SYSTEM_CLIENT_EVENT_CHANNEL, event);
}
