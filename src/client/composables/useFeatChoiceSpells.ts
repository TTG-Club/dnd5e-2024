/**
 * Каталог заклинаний для выбора при взятии черты.
 *
 * Выбор заклинания («Посвящённый в магию» — два заговора из списка класса) отличается от
 * остальных выборов черты тем, что его пул не описан справочником листа: заклинания живут
 * в компендиуме и грузятся с сервера. Загрузка вынесена сюда, чтобы окно выбора и проверка
 * «все ли ответы даны» смотрели на ОДИН каталог — иначе список вариантов и условие
 * готовности разошлись бы, и кнопка «Применить» осталась бы недоступной при заполненном
 * списке.
 *
 * Каталог грузится лениво: только когда среди выборов есть заклинание или заговор, и
 * только один раз.
 */

import type { Ref } from 'vue';

import type { TypedWebSocketClient } from '@vtt/shared';
import type { FeatChoice, Spell } from '@vtt/shared/system/dnd.js';

import { computed, ref, watch } from 'vue';

import { loadCompendiumKind } from '@/core/compendiumDataClient';

import { extractSpellEntries } from './spellCompendium';

/**
 * Загружает заклинания компендиума, если они нужны выборам черты.
 *
 * @param socket - WebSocket-клиент; без него каталог остаётся пустым
 * @param choices - выборы, которые предстоит сделать
 * @returns `spells` — заклинания каталога (пустой список, пока не загружены)
 */
export function useFeatChoiceSpells(
  socket: Ref<TypedWebSocketClient | null | undefined>,
  choices: Ref<ReadonlyArray<FeatChoice>>,
) {
  const spells = ref<Spell[]>([]);

  const isNeeded = computed(() =>
    choices.value.some(
      (choice) => choice.type === 'spell' || choice.type === 'cantrip',
    ),
  );

  watch(
    [isNeeded, socket],
    async ([needed, socketClient]) => {
      if (!needed || !socketClient || spells.value.length > 0) {
        return;
      }

      const entries = await loadCompendiumKind(socketClient, 'spell');

      spells.value = extractSpellEntries(entries);
    },
    { immediate: true },
  );

  return { spells };
}
