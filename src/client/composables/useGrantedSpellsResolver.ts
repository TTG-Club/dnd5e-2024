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
  GrantedSpellPack,
  GrantedSpellResolution,
  GrantedSpellSource,
  ResolvedGrantedSpell,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { computed, ref, watch } from 'vue';

import {
  expandClassSpellRequests,
  resolveGrantedSpellSourcesInPacks,
} from '@vtt/shared/system/dnd.js';

import { loadGrantedSpellPacks } from './grantedSpellPacks';
import { finalizeGrantedSpells } from './usePackChoicePrompt';

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
  const compendiumPacks = ref<GrantedSpellPack[]>([]);

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

    compendiumPacks.value = await loadGrantedSpellPacks(socketClient);

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

  /**
   * Выдаваемые заклинания, разобранные правилом «свой пак → единственный
   * другой → выбор игрока → нет»: свой пак — пак источника (`source.packId`).
   */
  const grantedSpellResolution = computed((): GrantedSpellResolution => {
    const requests = classSpellRequests?.value ?? [];

    if (
      (grantedSpellSources.value.length === 0 && requests.length === 0)
      || compendiumSpells.value.length === 0
    ) {
      return { resolved: [], ambiguous: [], missing: [] };
    }

    // Список класса разворачивается здесь, а не у источника запроса: заклинаний он
    // не называет, и подобрать их можно только по загруженному каталогу
    return resolveGrantedSpellSourcesInPacks(compendiumPacks.value, [
      ...grantedSpellSources.value,
      ...expandClassSpellRequests(requests, compendiumPacks.value),
    ]);
  });

  /**
   * Нашедшиеся однозначно — их мастер показывает до применения. Заклинания,
   * лежащие в нескольких компендиумах, добавятся после выбора игрока.
   */
  const resolvedGrantedSpells = computed(
    (): ResolvedGrantedSpell[] => grantedSpellResolution.value.resolved,
  );

  /**
   * Всё, что ляжет на лист: спрашивает игрока о заклинаниях из нескольких
   * компендиумов и предупреждает о ненайденных. Зовётся при применении.
   *
   * @param actorId - персонаж, которому выдаются заклинания
   */
  function finalizeForActor(actorId: string): Promise<ResolvedGrantedSpell[]> {
    return finalizeGrantedSpells(actorId, grantedSpellResolution.value);
  }

  /** Каталог заклинаний уже загружен: пустой результат — это правда, а не ожидание */
  const isLoaded = computed(() => compendiumSpells.value.length > 0);

  return {
    resolvedGrantedSpells,
    finalizeForActor,
    isLoaded,
  };
}
