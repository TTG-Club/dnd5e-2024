<script setup lang="ts">
  /**
   * Окно выбора записи компендиума — для полей, где запись задаётся ССЫЛКОЙ:
   * требования черты (нужна черта, класс, вид, предыстория), выдаваемые
   * заклинания и основной вид у происхождения.
   *
   * Слева перечислены компендиумы (паки сервера плюс записи, созданные в самом
   * мире) — их бывает много, и надо понимать, откуда берётся запись; справа —
   * записи выбранного компендиума с поиском.
   *
   * От окна выдачи вида на листе (`CompendiumPickerModal`) отличается тем, что
   * не знает про актёра: оно ничего не применяет и ничего не снимает, а только
   * возвращает выбранные ссылки. Поэтому и типов записей ему всё равно сколько —
   * тип приходит пропом.
   */

  import type { PackKindEntries } from '@/core/compendiumDataClient';
  import type { CompendiumEntry, TypedWebSocketClient } from '@vtt/shared';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useItemsStore } from '@/stores/itemsStore';
  import { compendiumEntryKey, isRecord } from '@vtt/shared';

  import { useSourceLabels } from '../../composables/useSourceLabel';
  import {
    COMPENDIUM_LABELS,
    COMPENDIUM_PACK_BUTTON_CLASS,
    COMPENDIUM_PACK_BUTTON_IDLE_CLASS,
    COMPENDIUM_PACK_BUTTON_SELECTED_CLASS,
    COMPENDIUM_PICKER_LABELS,
    MODAL_BUTTON_LABELS,
    REF_PICKER_LABELS,
  } from './constants';
  import PickerListRow from './PickerListRow.vue';

  /** Выбранная ссылка: чем запись адресуется и откуда она взята. */
  export interface PickedCompendiumRef {
    /** Ключ записи: `id` у черт и заклинаний, `key` у классов/видов/предысторий */
    url: string;
    name: string;
    packId: string;
    packName: string;
  }

  /** Чем запись адресуется и как называется — то, что окно берёт из записи. */
  export interface PickerEntryFields {
    /** Ключ записи: он уходит в `url` выбранной ссылки */
    key: string;
    name: string;
    nameEn: string;
  }

  /** Запись компендиума, годная в ссылку: у неё есть ключ и название. */
  interface PickerEntry extends PickerEntryFields {
    packId: string;
    packName: string;
    /** Ключ источника — пометкой справа в строке списка */
    sourceKey: string;
    /** Значение фильтра записи (напр. категория черты); пусто — не задано */
    filterValue: string;
  }

  /** Псевдо-пак «все компендиумы» — выбран по умолчанию */
  const ALL_PACKS_ID = '__all__';
  /** Псевдо-пак записей, созданных в самом мире (панель «Предметы») */
  const WORLD_PACK_ID = '__world__';

  /**
   * Поля записи по умолчанию: ключ считает общий `compendiumEntryKey`, название
   * берётся у самой записи. Без ключа или названия запись в ссылку не годится —
   * по ним требование и сверяется.
   *
   * @param entry - запись компендиума
   * @returns поля записи либо `null`, если в ссылку она не годится
   */
  function defaultEntryFields(
    entry: CompendiumEntry,
  ): PickerEntryFields | null {
    const key = compendiumEntryKey(entry);

    if (!key || !isRecord(entry) || typeof entry.name !== 'string') {
      return null;
    }

    return {
      key,
      name: entry.name,
      nameEn: typeof entry.nameEn === 'string' ? entry.nameEn : '',
    };
  }

  const props = withDefaults(
    defineProps<{
      /** Открыто ли окно */
      open: boolean;
      /** WebSocket-клиент: загрузка записей компендиума по пакам */
      socket: TypedWebSocketClient | null;
      /**
       * Тип записей компендиума (`feat`, `class`, `species`, `background`,
       * `spell`). Списком — когда записи одного смысла разложены по разным
       * разделам: предметы снаряжения лежат сразу в трёх (`equipment`,
       * `weapon`, `tool`), а выбирать их надо одним списком.
       */
      kind: string | readonly string[];
      /** Заголовок окна — что именно выбирают */
      title: string;
      /** Z-index (управляется вызывающим для bring-to-front) */
      zIndex?: number;
      /**
       * Множественный выбор. Выключенный — новая отметка вытесняет прежнюю: в
       * поле-ссылку вроде основного вида влезает ровно одна запись, и молча
       * отбрасывать лишние отметки хуже, чем не давать их поставить.
       */
      multiple?: boolean;
      /**
       * Своя подготовка записи: чем она адресуется и как называется. `null`
       * убирает запись из списка. Нужна там, где общий ключ записи не годится
       * (у вида мира ключ вида лежит в `speciesData`, а `id` предмета в ссылку
       * не подходит) или где подходят не все записи типа.
       */
      resolveEntry?: (entry: CompendiumEntry) => PickerEntryFields | null;
      /**
       * По какому полю записи фильтровать список — напр. категория черты
       * («Боевой стиль»). Не задана — панели фильтра нет.
       *
       * Набор значений окно собирает из того, что реально приехало в паках, а
       * не из зашитого справочника: категории задаёт сайт, и свой список здесь
       * разошёлся бы с ним у первой же новой категории.
       */
      filterValue?: (entry: CompendiumEntry) => string | undefined;
      /** Подпись фильтра — что именно выбирают в панели */
      filterLabel?: string;
      /**
       * Порядок значений фильтра. Пусто — по алфавиту; кругам заклинаний он не
       * годится: «Заговор» уехал бы в конец, за девятый круг.
       */
      filterOrder?: string[];
    }>(),
    {
      zIndex: undefined,
      multiple: true,
      resolveEntry: undefined,
      filterValue: undefined,
      filterLabel: '',
      filterOrder: () => [],
    },
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Отмеченные записи подтверждены */
    'select': [refs: PickedCompendiumRef[]];
  }>();

  /** Типы записей списком: проп принимает и один тип, и несколько. */
  const kinds = computed<readonly string[]>(() =>
    typeof props.kind === 'string' ? [props.kind] : props.kind,
  );

  const itemsStore = useItemsStore();
  const { getSourceDefinition } = useSourceLabels();

  /**
   * Пометка строки: сокращение источника («PHB»), а без него — компендиум, из
   * которого запись приехала. Пустой пометки не бывает: по ней и различают
   * одноимённые записи разных книг.
   *
   * @param entry - строка списка
   */
  function entryBadge(entry: PickerEntry): string {
    return (
      getSourceDefinition(entry.sourceKey)?.abbreviation ?? entry.filterValue
    );
  }

  const compendiumPacks = ref<PackKindEntries[]>([]);
  const isLoading = ref(false);
  const searchQuery = ref('');
  const selectedPackId = ref<string>(ALL_PACKS_ID);

  /** Отмеченные значения фильтра; пусто — фильтр ничего не сужает */
  const selectedFilterValues = ref<string[]>([]);

  /** Подпись панели фильтра: вызывающий мог её и не назвать */
  const filterPlaceholder = computed(
    () => props.filterLabel || REF_PICKER_LABELS.filterPlaceholder,
  );

  /**
   * Отмеченные записи. Храним их целиком, а не ключи: отметку не должны терять
   * ни переключение компендиума, ни поиск.
   */
  const selectedEntries = ref<PickerEntry[]>([]);

  /**
   * Приводит запись компендиума к строке выбора. Поля берёт `resolveEntry`
   * вызывающего, а без него — общее правило {@link defaultEntryFields}.
   *
   * @param entry - запись компендиума
   * @param packId - идентификатор пака-источника
   * @param packName - название пака-источника
   */
  function toPickerEntry(
    entry: CompendiumEntry,
    packId: string,
    packName: string,
  ): PickerEntry | null {
    const fields = props.resolveEntry
      ? props.resolveEntry(entry)
      : defaultEntryFields(entry);

    if (!fields) {
      return null;
    }

    return {
      ...fields,
      packId,
      packName,
      sourceKey:
        isRecord(entry) && typeof entry.sourceKey === 'string'
          ? entry.sourceKey
          : '',
      filterValue: props.filterValue?.(entry)?.trim() ?? '',
    };
  }

  /**
   * Записи нужного типа, созданные в самом мире. Копия записи компендиума
   * получает НОВЫЙ ключ и в паках уже не находится — без этого источника её
   * нельзя было бы выбрать.
   */
  const worldEntries = computed<PickerEntry[]>(() =>
    kinds.value
      .flatMap((kind) => itemsStore.itemsByType(kind))
      .map((worldItem) =>
        toPickerEntry(
          worldItem,
          WORLD_PACK_ID,
          COMPENDIUM_PICKER_LABELS.worldPack,
        ),
      )
      .filter((entry): entry is PickerEntry => entry !== null),
  );

  /** Компендиумы левой колонки: паки сервера плюс записи мира */
  const packs = computed<
    { packId: string; packName: string; entries: PickerEntry[] }[]
  >(() => {
    const result = compendiumPacks.value.map((pack) => ({
      packId: pack.packId,
      packName: pack.packName,
      entries: pack.entries
        .map((entry) => toPickerEntry(entry, pack.packId, pack.packName))
        .filter((entry): entry is PickerEntry => entry !== null),
    }));

    if (worldEntries.value.length > 0) {
      result.push({
        packId: WORLD_PACK_ID,
        packName: COMPENDIUM_PICKER_LABELS.worldPack,
        entries: worldEntries.value,
      });
    }

    return result;
  });

  /**
   * Записи выбранного компендиума. В режиме «все» одинаковые ключи из разных
   * паков схлопываются — приоритет у пака, который идёт раньше.
   */
  const packEntries = computed<PickerEntry[]>(() => {
    if (selectedPackId.value !== ALL_PACKS_ID) {
      return (
        packs.value.find((pack) => pack.packId === selectedPackId.value)
          ?.entries ?? []
      );
    }

    const seenKeys = new Set<string>();
    const merged: PickerEntry[] = [];

    for (const pack of packs.value) {
      for (const entry of pack.entries) {
        if (seenKeys.has(entry.key)) {
          continue;
        }

        seenKeys.add(entry.key);
        merged.push(entry);
      }
    }

    return merged;
  });

  /**
   * Значения фильтра, которые встречаются в записях. Считаются по всем пакам, а
   * не по выбранному: иначе отметка исчезала бы при переключении компендиума, а
   * вместе с ней и половина списка.
   */
  const filterOptions = computed<string[]>(() => {
    if (!props.filterValue) {
      return [];
    }

    const values = new Set<string>();

    for (const pack of packs.value) {
      for (const entry of pack.entries) {
        if (entry.filterValue) {
          values.add(entry.filterValue);
        }
      }
    }

    const order = props.filterOrder;

    return [...values].sort((first, second) => {
      const firstIndex = order.indexOf(first);
      const secondIndex = order.indexOf(second);

      // Незнакомые порядку значения уходят в конец и там равняются по алфавиту
      if (firstIndex !== secondIndex) {
        return (
          (firstIndex < 0 ? order.length : firstIndex)
          - (secondIndex < 0 ? order.length : secondIndex)
        );
      }

      return first.localeCompare(second);
    });
  });

  /**
   * Переключает значение фильтра.
   *
   * @param value - значение фильтра
   */
  function toggleFilterValue(value: string): void {
    selectedFilterValues.value = selectedFilterValues.value.includes(value)
      ? selectedFilterValues.value.filter((selected) => selected !== value)
      : [...selectedFilterValues.value, value];
  }

  /**
   * Оформление кнопки фильтра — тем же приёмом, что у компендиумов слева.
   *
   * @param value - значение фильтра
   */
  function filterButtonClass(value: string): string {
    const stateClass = selectedFilterValues.value.includes(value)
      ? COMPENDIUM_PACK_BUTTON_SELECTED_CLASS
      : COMPENDIUM_PACK_BUTTON_IDLE_CLASS;

    return `${COMPENDIUM_PACK_BUTTON_CLASS} ${stateClass}`;
  }

  /** Записи после поиска по названию (русскому и английскому) и фильтра */
  const visibleEntries = computed<PickerEntry[]>(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const allowed = new Set(selectedFilterValues.value);

    return packEntries.value.filter((entry) => {
      if (allowed.size > 0 && !allowed.has(entry.filterValue)) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        entry.name.toLowerCase().includes(query)
        || entry.nameEn.toLowerCase().includes(query)
      );
    });
  });

  /** Ключи отмеченных записей */
  const selectedKeys = computed(
    () => new Set(selectedEntries.value.map((entry) => entry.key)),
  );

  /**
   * Что показать вместо списка: под поиском и фильтром «ничего не нашлось», а
   * без них записей этого типа в мире просто нет — и чинить это надо по-разному.
   */
  const emptyMessage = computed(() =>
    searchQuery.value.trim() || selectedFilterValues.value.length > 0
      ? COMPENDIUM_LABELS.nothingFound
      : REF_PICKER_LABELS.empty,
  );

  const canConfirm = computed(() => selectedEntries.value.length > 0);

  /**
   * Подпись подтверждения: множественный выбор пополняет список, одиночный
   * занимает единственное поле — «Добавить» там читалось бы как ещё одна запись.
   */
  const confirmLabel = computed(() =>
    props.multiple ? MODAL_BUTTON_LABELS.add : REF_PICKER_LABELS.pick,
  );

  /**
   * Отмечает или снимает отметку. По умолчанию выбор множественный: требование
   * «нужен класс» читается как «любой из перечисленных», а заклинаний черта
   * выдаёт сколько угодно. Одиночный выбор вытесняет прежнюю отметку.
   *
   * @param entry - запись компендиума
   */
  function toggleSelection(entry: PickerEntry): void {
    if (selectedKeys.value.has(entry.key)) {
      selectedEntries.value = selectedEntries.value.filter(
        (selected) => selected.key !== entry.key,
      );

      return;
    }

    selectedEntries.value = props.multiple
      ? [...selectedEntries.value, entry]
      : [entry];
  }

  /** Отдаёт отмеченные записи вызывающему и закрывает окно */
  function confirmSelection(): void {
    if (!canConfirm.value) {
      return;
    }

    emit(
      'select',
      selectedEntries.value.map((entry) => ({
        url: entry.key,
        name: entry.name,
        packId: entry.packId,
        packName: entry.packName,
      })),
    );

    emit('update:open', false);
  }

  /**
   * Выбирает компендиум в левой колонке.
   *
   * @param packId - идентификатор пака (или псевдо-пака «все»)
   */
  function selectPack(packId: string): void {
    selectedPackId.value = packId;
  }

  /**
   * Оформление строки компендиума в левой колонке: выбранный подсвечен, прочие
   * теплеют только под курсором.
   *
   * @param packId - идентификатор пака
   */
  function packButtonClass(packId: string): string {
    const stateClass =
      selectedPackId.value === packId
        ? COMPENDIUM_PACK_BUTTON_SELECTED_CLASS
        : COMPENDIUM_PACK_BUTTON_IDLE_CLASS;

    return `${COMPENDIUM_PACK_BUTTON_CLASS} ${stateClass}`;
  }

  function handleModalClose(): void {
    emit('update:open', false);
  }

  /** Загружает записи выбранных типов по пакам компендиума. */
  async function loadEntries(): Promise<void> {
    const socket = props.socket;

    if (!socket) {
      compendiumPacks.value = [];

      return;
    }

    isLoading.value = true;

    try {
      // Несколько типов сливаются в ОДИН список паков: пак предметов держит и
      // снаряжение, и оружие, и инструменты, а в левой колонке он должен
      // остаться одной строкой. Записи копируются — списки в кеше общие.
      const merged = new Map<string, PackKindEntries>();

      for (const kind of kinds.value) {
        const packsOfKind = await loadCompendiumKindByPack(socket, kind);

        for (const pack of packsOfKind) {
          const known = merged.get(pack.packId);

          if (known) {
            known.entries = [...known.entries, ...pack.entries];
          } else {
            merged.set(pack.packId, { ...pack, entries: [...pack.entries] });
          }
        }
      }

      compendiumPacks.value = [...merged.values()];
    } finally {
      isLoading.value = false;
    }
  }

  // Открытие окна (и смена типа записей) сбрасывает поиск и отметки и
  // запрашивает записи нужного типа.
  watch(
    () => [props.open, kinds.value.join(',')] as const,
    ([isOpen]) => {
      if (!isOpen) {
        return;
      }

      searchQuery.value = '';
      selectedPackId.value = ALL_PACKS_ID;
      selectedFilterValues.value = [];
      selectedEntries.value = [];
      void loadEntries();
    },
    { immediate: true },
  );
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="title"
    :initial-width="820"
    :initial-height="620"
    :min-width="620"
    :min-height="420"
    :z-index="zIndex"
    :ui="{ body: 'overflow-hidden p-0 flex flex-col' }"
    @update:open="handleModalClose"
  >
    <template #body>
      <div class="flex min-h-0 flex-1">
        <!-- Компендиумы: из какого пака берём запись -->
        <div
          class="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-accented/30 p-3"
        >
          <!-- Поиск здесь же, а не над списком: справа тогда остаётся ровно
            список, и прокручивается он один — как в окне компендиума -->
          <UInput
            v-model="searchQuery"
            icon="tabler:search"
            :placeholder="COMPENDIUM_LABELS.searchPlaceholder"
            size="sm"
            class="mb-2"
            :ui="{ root: 'w-full' }"
          />

          <button
            type="button"
            :class="packButtonClass(ALL_PACKS_ID)"
            @click.left.exact.prevent="selectPack(ALL_PACKS_ID)"
          >
            <span class="truncate">
              {{ COMPENDIUM_PICKER_LABELS.allPacks }}
            </span>
          </button>

          <button
            v-for="pack in packs"
            :key="pack.packId"
            type="button"
            :class="packButtonClass(pack.packId)"
            @click.left.exact.prevent="selectPack(pack.packId)"
          >
            <span class="truncate">{{ pack.packName }}</span>

            <span class="shrink-0 text-xs text-dimmed">
              {{ pack.entries.length }}
            </span>
          </button>

          <!-- Фильтр — под компендиумами той же колонкой: сначала выбирают,
            ОТКУДА берут запись, потом сужают, КАКУЮ именно -->
          <template v-if="filterOptions.length > 0">
            <div
              class="mt-2 flex items-center justify-between gap-2 border-t border-accented/30 px-1 pt-3"
            >
              <span
                class="truncate text-xs font-semibold tracking-wider text-muted uppercase"
              >
                {{ filterPlaceholder }}
              </span>

              <UButton
                v-if="selectedFilterValues.length > 0"
                icon="tabler:x"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="REF_PICKER_LABELS.filterReset"
                @click.left.exact.prevent="selectedFilterValues = []"
              />
            </div>

            <button
              v-for="value in filterOptions"
              :key="value"
              type="button"
              :class="filterButtonClass(value)"
              @click.left.exact.prevent="toggleFilterValue(value)"
            >
              <span class="truncate">{{ value }}</span>

              <!-- Галочка: фильтр набирают отметками, а компендиум выше —
                переключением, и на вид их путать нельзя -->
              <UIcon
                v-if="selectedFilterValues.includes(value)"
                name="tabler:check"
                class="h-4 w-4 shrink-0 text-primary"
              />
            </button>
          </template>
        </div>

        <!-- Записи выбранного компендиума -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div
              v-if="isLoading"
              class="flex items-center justify-center py-8"
            >
              <UIcon
                name="tabler:loader-2"
                class="animate-spin text-2xl text-muted"
              />
            </div>

            <div
              v-else-if="visibleEntries.length > 0"
              class="flex flex-col divide-y divide-accented/25"
            >
              <PickerListRow
                v-for="entry in visibleEntries"
                :key="`${entry.packId}-${entry.key}`"
                :name="entry.name"
                :name-en="entry.nameEn"
                :badge="entryBadge(entry)"
                :selected="selectedKeys.has(entry.key)"
                @toggle="toggleSelection(entry)"
              />
            </div>

            <div
              v-else
              class="py-8 text-center text-sm text-dimmed"
            >
              {{ emptyMessage }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <span class="text-xs text-dimmed">
          {{ REF_PICKER_LABELS.selectedPrefix }}{{ selectedEntries.length }}
        </span>

        <div class="flex gap-3">
          <UButton
            :label="MODAL_BUTTON_LABELS.cancel"
            color="neutral"
            variant="ghost"
            @click.left.exact.prevent="handleModalClose"
          />

          <UButton
            :label="confirmLabel"
            color="primary"
            :disabled="!canConfirm"
            @click.left.exact.prevent="confirmSelection"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
