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

import type { CatalogPack } from './useCompendiumCatalog';

import { computed, ref, watch } from 'vue';

import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';

import { extractSpellEntries } from './spellCompendium';
import { flattenPreferringBy } from './useCompendiumCatalog';

/**
 * Загружает заклинания компендиума, если они нужны выборам черты.
 *
 * Каталог держится по пакам, а наружу отдаётся без повторов: одно и то же
 * заклинание лежит и в DEV-, и в ПРОД-компендиуме, и в пул для записи из ПРОД
 * должна попасть её же копия, а не первая попавшаяся.
 *
 * @param socket - WebSocket-клиент; без него каталог остаётся пустым
 * @param choices - выборы, которые предстоит сделать
 * @param preferredPackId - пак записи, которая спрашивает; пусто — порядок паков хоста
 * @returns `spells` — заклинания каталога (пустой список, пока не загружены)
 */
export function useFeatChoiceSpells(
  socket: Ref<TypedWebSocketClient | null | undefined>,
  choices: Ref<ReadonlyArray<FeatChoice>>,
  preferredPackId?: Ref<string | undefined>,
) {
  /** Заклинания компендиума по пакам — как приехали */
  const spellPacks = ref<CatalogPack<Spell>[]>([]);

  const spells = computed<Spell[]>(() =>
    flattenPreferringBy(
      spellPacks.value,
      preferredPackId?.value,
      (spell) => spell.id,
    ),
  );

  const isNeeded = computed(() =>
    choices.value.some(
      (choice) => choice.type === 'spell' || choice.type === 'cantrip',
    ),
  );

  watch(
    [isNeeded, socket],
    async ([needed, socketClient]) => {
      if (!needed || !socketClient || spellPacks.value.length > 0) {
        return;
      }

      const packs = await loadCompendiumKindByPack(socketClient, 'spell');

      spellPacks.value = packs.map((pack) => ({
        packId: pack.packId,
        packName: pack.packName,
        entries: extractSpellEntries(pack.entries),
      }));
    },
    { immediate: true },
  );

  return { spells };
}
