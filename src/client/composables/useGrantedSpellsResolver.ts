/**
 * Composable загрузки и сопоставления granted-заклинаний.
 *
 * Умения (классов, видов, черт) могут предоставлять заклинания автоматически
 * через поле `grantedSpells` со списком ID заклинаний компендиума.
 * Composable лениво загружает заклинания компендиума с сервера (агрегировано по
 * всем пакам: бандл + скачиваемые + модули) и сопоставляет ID с полными данными
 * заклинаний для отображения в мастерах и записи в лист персонажа.
 */

import type { Ref } from 'vue';

import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  ClassSpellListRequest,
  ClassSpellPack,
  GrantedSpellSource,
  ResolvedGrantedSpell,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { computed, ref, watch } from 'vue';

import { useItemsStore } from '@/stores/itemsStore';
import {
  expandClassSpellRequests,
  WORLD_PACK_ID,
} from '@vtt/shared/system/dnd.js';

import {
  extractWorldSpells,
  findSpellInPacks,
  loadSpellPacks,
} from './spellCompendium';

/**
 * Composable сопоставления granted-заклинаний с данными компендиума.
 *
 * Загрузка данных запускается лениво — только когда появляется хотя бы
 * одна связь «заклинание → умение» и доступен сокет.
 *
 * @param socket - WebSocket-клиент для запроса данных компендиума
 * @param grantedSpellSources - связи «ID заклинания → умение-источник»
 * @param classSpellRequests - запросы «выдать весь список класса»; они не называют
 *   заклинаний поимённо, и записи для них подбираются уже по загруженному каталогу
 * @returns `resolvedGrantedSpells` — заклинания с умениями-источниками
 */
export function useGrantedSpellsResolver(
  socket: Ref<TypedWebSocketClient | null>,
  grantedSpellSources: Ref<GrantedSpellSource[]>,
  classSpellRequests?: Ref<ClassSpellListRequest[]>,
) {
  /** Загруженные заклинания компендиума по пакам */
  const compendiumPacks = ref<ClassSpellPack[]>([]);

  /** Загруженные заклинания компендиума одним списком */
  const compendiumSpells = ref<Spell[]>([]);

  /** Был ли уже отправлен запрос данных (защита от повторных запросов) */
  const hasRequestedData = ref(false);

  /**
   * Загружает заклинания компендиума с сервера (агрегировано по всем пакам).
   *
   * @param socketClient - активный WebSocket-клиент
   */
  async function loadCompendiumSpells(
    socketClient: TypedWebSocketClient,
  ): Promise<void> {
    hasRequestedData.value = true;

    const { packs } = await loadSpellPacks(socketClient);

    // Заклинания, созданные в самом мире, ищутся наравне с компендиумными:
    // черта может выдавать своё заклинание, заведённое в панели «Предметы».
    // Своим паком — чтобы выдача, сужённая до конкретного компендиума, их не
    // подхватила
    compendiumPacks.value = [
      ...packs.map((pack) => ({ packId: pack.packId, spells: pack.spells })),
      {
        packId: WORLD_PACK_ID,
        spells: extractWorldSpells(useItemsStore().itemsByType('spell')),
      },
    ];

    compendiumSpells.value = compendiumPacks.value.flatMap(
      (pack) => pack.spells,
    );
  }

  watch(
    [grantedSpellSources, classSpellRequests ?? ref([]), socket],
    ([sources, requests, socketClient]) => {
      if (
        (sources.length === 0 && requests.length === 0)
        || !socketClient
        || hasRequestedData.value
      ) {
        return;
      }

      void loadCompendiumSpells(socketClient);
    },
    { immediate: true },
  );

  /** Granted-заклинания, сопоставленные с данными компендиума */
  const resolvedGrantedSpells = computed((): ResolvedGrantedSpell[] => {
    const requests = classSpellRequests?.value ?? [];

    if (
      (grantedSpellSources.value.length === 0 && requests.length === 0)
      || compendiumSpells.value.length === 0
    ) {
      return [];
    }

    const resolved: ResolvedGrantedSpell[] = [];

    // Список класса разворачивается здесь, а не у источника запроса: заклинаний он
    // не называет, и подобрать их можно только по загруженному каталогу
    for (const source of [
      ...grantedSpellSources.value,
      ...expandClassSpellRequests(requests, compendiumPacks.value),
    ]) {
      // Сперва пак источника, потом любой: одно и то же заклинание лежит в
      // нескольких компендиумах, и выданное записью из ПРОД должно быть её копией
      const spell = findSpellInPacks(
        compendiumPacks.value,
        source.spellId,
        source.packId,
      );

      if (spell) {
        resolved.push({
          spell,
          featureName: source.featureName,
          alwaysPrepared: source.alwaysPrepared,
          castingAbility: source.castingAbility,
        });
      }
    }

    return resolved;
  });

  return {
    resolvedGrantedSpells,
  };
}
