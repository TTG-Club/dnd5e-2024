/**
 * Заблаговременная загрузка записей компендиума.
 *
 * Окно выбора ждёт записи с сервера, а тот в первый раз читает с диска тысячи
 * файлов паков. Вкладка листа знает, какие записи понадобятся её кнопке
 * «Добавить», и просит их, едва открылась: пока игрок смотрит на вкладку,
 * данные успевают приехать, и окно открывается уже с ними. Хост держит
 * ответы в памяти и склеивает одинаковые запросы, так что повторная просьба
 * ничего не стоит.
 *
 * @module systems/dnd5e/composables/useCompendiumWarmup
 */

import type { TypedWebSocketClient } from '@vtt/shared';

import { onMounted } from 'vue';

import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';

/**
 * Просит записи компендиума, как только компонент показан. Ответа не ждёт:
 * его заберёт из кеша хоста само окно выбора.
 *
 * @param getSocket - сокет мира; без него загружать не из чего
 * @param kinds - типы записей, которые понадобятся
 * @param isEnabled - нужна ли загрузка вообще (у листа без кнопки — нет)
 */
export function useCompendiumWarmup(
  getSocket: () => TypedWebSocketClient | null,
  kinds: readonly string[],
  isEnabled: () => boolean = () => true,
): void {
  onMounted(() => {
    const socket = getSocket();

    if (!socket || !isEnabled()) {
      return;
    }

    for (const kind of kinds) {
      void loadCompendiumKindByPack(socket, kind);
    }
  });
}
