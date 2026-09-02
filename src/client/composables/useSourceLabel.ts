import type { MaybeRefOrGetter } from 'vue';

import type { SourceDefinition } from '@vtt/shared';

import { computed, toValue } from 'vue';

import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
import { fallbackSourceDefinition } from '@vtt/shared/system/dnd.js';

/**
 * Определение источника для записи.
 *
 * Сначала берётся то, что запись везёт с собой (`source`): у авторской книги
 * расшифровки нет больше нигде. Если своего определения нет — ищем ключ в
 * словаре системы (встроенные книги плюс приехавшие с паками компендиума).
 * Ключ, которого не знает никто, подписывается им самим: книга подкласса в
 * словарь пака не попадает, а без подписи два одноимённых подкласса разных
 * выпусков неразличимы.
 *
 * @param store - хранилище справочных данных системы
 * @param sourceKey - ключ источника записи
 * @param source - определение, вписанное вместе с записью
 */
function resolveSource(
  store: ReturnType<typeof useSystemDataStore>,
  sourceKey: string | undefined,
  source: SourceDefinition | undefined,
): SourceDefinition | undefined {
  if (!sourceKey) {
    return source;
  }

  const known = store.sources.find((item) => item.key === sourceKey);

  // Словарь приоритетнее вписанного вручную: у книги из пака название выверено,
  // а на записи могло остаться сокращение, набранное автором на бегу.
  return known ?? source ?? fallbackSourceDefinition(sourceKey);
}

/**
 * Возвращает определение источника записи и его аббревиатуру для подписи.
 * Используется в детальных модалках (Weapon, Tool, Equipment).
 *
 * @param sourceKey — реактивный ключ источника
 * @param source — реактивное определение, вписанное вместе с записью
 */
export function useSourceLabel(
  sourceKey: MaybeRefOrGetter<string | undefined>,
  source?: MaybeRefOrGetter<SourceDefinition | undefined>,
) {
  const systemDataStore = useSystemDataStore();

  const sourceDefinition = computed(() =>
    resolveSource(systemDataStore, toValue(sourceKey), toValue(source)),
  );

  const sourceLabel = computed(() => sourceDefinition.value?.abbreviation);

  return { sourceLabel, sourceDefinition };
}

/**
 * Возвращает резолверы источника по ключу. Удобно для списков (подклассы,
 * карточки), где ключ известен только в шаблоне на каждый элемент.
 */
export function useSourceLabels(): {
  getSourceLabel: (
    sourceKey: string | undefined,
    source?: SourceDefinition,
  ) => string | undefined;
  getSourceDefinition: (
    sourceKey: string | undefined,
    source?: SourceDefinition,
  ) => SourceDefinition | undefined;
} {
  const systemDataStore = useSystemDataStore();

  function getSourceDefinition(
    sourceKey: string | undefined,
    source?: SourceDefinition,
  ): SourceDefinition | undefined {
    return resolveSource(systemDataStore, sourceKey, source);
  }

  function getSourceLabel(
    sourceKey: string | undefined,
    source?: SourceDefinition,
  ): string | undefined {
    return getSourceDefinition(sourceKey, source)?.abbreviation;
  }

  return { getSourceLabel, getSourceDefinition };
}
