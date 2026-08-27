<script setup lang="ts">
  /**
   * Окно выбора вида, класса или предыстории из компендиума для листа персонажа.
   *
   * Слева перечислены компендиумы (паки сервера плюс записи, созданные в самом
   * мире) — их бывает много, и надо понимать, откуда берётся запись. Справа —
   * записи выбранного компендиума и полоса с тем, что уже выбрано у персонажа,
   * с кнопкой удаления.
   *
   * Само применение выбранной записи окну не принадлежит: оно эмитит
   * определение, а лист запускает тот же мастер настройки, что и при
   * перетаскивании из компендиума.
   */

  import type { PackKindEntries } from '@/core/compendiumDataClient';
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    BackgroundDefinition,
    ClassDefinition,
    DnDActor,
    DnDGameItem,
    SpeciesDefinition,
  } from '@vtt/shared/system/dnd.js';

  import type { MissingSheetSectionKey } from './constants';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
  import EntityCard from '@/shared_ui/components/EntityCard.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { useItemsStore } from '@/stores/itemsStore';
  import { isRecord } from '@vtt/shared';
  import { isDnDGameItem } from '@vtt/shared/system/dnd.js';

  import BackgroundDetailModal from './background/BackgroundDetailModal.vue';
  import ClassDetailModal from './class/ClassDetailModal.vue';
  import {
    COMPENDIUM_LABELS,
    COMPENDIUM_PACK_BUTTON_CLASS,
    COMPENDIUM_PACK_BUTTON_IDLE_CLASS,
    COMPENDIUM_PACK_BUTTON_SELECTED_CLASS,
    COMPENDIUM_PICKER_CURRENT_TITLES,
    COMPENDIUM_PICKER_LABELS,
    COMPENDIUM_PICKER_TITLES,
    MODAL_BUTTON_LABELS,
  } from './constants';
  import SpeciesDetailModal from './species/SpeciesDetailModal.vue';

  /** Определение, выбираемое этим окном */
  type PickerDefinition =
    SpeciesDefinition | ClassDefinition | BackgroundDefinition;

  /** Один компендиум в левой колонке: его записи нужного типа */
  interface PickerPack {
    packId: string;
    packName: string;
    entries: PickerDefinition[];
  }

  /** Уже выбранное персонажем: подпись в полосе и ключ для удаления */
  interface CurrentEntry {
    key: string;
    label: string;
  }

  /** Псевдо-пак «все компендиумы» — выбран по умолчанию */
  const ALL_PACKS_ID = '__all__';
  /** Псевдо-пак записей, созданных в самом мире (панель «Предметы») */
  const WORLD_PACK_ID = '__world__';

  const props = defineProps<{
    /** Открыто ли окно */
    open: boolean;
    /** WebSocket-клиент: загрузка записей компендиума по пакам */
    socket: TypedWebSocketClient | null;
    /** Что выбираем: вид, класс или предысторию */
    kind: MissingSheetSectionKey;
    /** Персонаж — из него берётся уже выбранное */
    actor: DnDActor;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /**
     * Записи отмечены и подтверждены — лист запускает мастера настройки. Список
     * всегда: у вида и предыстории в нём одна запись, у класса — сколько
     * отметили (мультикласс за один заход).
     */
    'select': [definitions: PickerDefinition[]];
    /** Снять с персонажа текущий вид или предысторию */
    'remove-current': [];
    /** Снять с персонажа класс по его ключу */
    'remove-class': [classKey: string];
  }>();

  const itemsStore = useItemsStore();

  /** Записи компендиума по пакам (без записей мира) */
  const compendiumPacks = ref<PickerPack[]>([]);
  const isLoading = ref(false);
  const searchQuery = ref('');
  const selectedPackId = ref<string>(ALL_PACKS_ID);

  /**
   * Отмеченные записи. Храним сами определения, а не ключи: отметку не должны
   * терять ни переключение компендиума, ни поиск.
   */
  const selectedDefinitions = ref<PickerDefinition[]>([]);

  /** Запись, открытая на просмотр — из её окна её тоже можно отметить */
  const detailDefinition = ref<PickerDefinition | null>(null);
  const isDetailOpen = ref(false);

  /**
   * Ключ записи, для которой нажато «Удалить» и ждём подтверждения. Отдельного
   * окна не заводим: подтверждение живёт прямо в полосе выбранного.
   */
  const pendingRemovalKey = ref<string | null>(null);

  /**
   * Проверяет, что запись — определение нужного нам типа. Дискриминант `type`
   * есть у всех трёх определений; по нему же их отбирает лист персонажа.
   *
   * Записи-подвиды (`parentKey`) самостоятельным видом не предлагаются:
   * происхождение выбирается внутри мастера настройки после выбора родителя.
   *
   * @param value - запись компендиума или предмета мира
   * @param kind - тип выбираемой записи
   */
  function isKindDefinition(
    value: unknown,
    kind: MissingSheetSectionKey,
  ): value is PickerDefinition {
    if (
      !isRecord(value)
      || value.type !== kind
      || typeof value.key !== 'string'
    ) {
      return false;
    }

    return kind !== 'species' || !value.parentKey;
  }

  /**
   * Достаёт определение из предмета мира: вид и класс лежат во вложенном блобе,
   * предыстория — на самом предмете.
   *
   * @param worldItem - предмет мира
   */
  function worldDefinitionOf(worldItem: DnDGameItem): unknown {
    if (worldItem.type === 'species') {
      return worldItem.speciesData;
    }

    if (worldItem.type === 'class') {
      return worldItem.classData;
    }

    return worldItem;
  }

  /**
   * Записи нужного типа, созданные в самом мире. Копия записи компендиума
   * получает НОВЫЙ ключ и в паках уже не находится — без этого источника её
   * нельзя было бы выбрать.
   */
  const worldDefinitions = computed<PickerDefinition[]>(() =>
    itemsStore.items
      .filter(isDnDGameItem)
      .filter((worldItem) => worldItem.type === props.kind)
      .map(worldDefinitionOf)
      .filter((definition): definition is PickerDefinition =>
        isKindDefinition(definition, props.kind),
      ),
  );

  /** Компендиумы левой колонки: паки сервера плюс записи мира */
  const packs = computed<PickerPack[]>(() => {
    const result = [...compendiumPacks.value];

    if (worldDefinitions.value.length > 0) {
      result.push({
        packId: WORLD_PACK_ID,
        packName: COMPENDIUM_PICKER_LABELS.worldPack,
        entries: worldDefinitions.value,
      });
    }

    return result;
  });

  /**
   * Записи выбранного компендиума. В режиме «все» одинаковые ключи из разных
   * паков схлопываются — приоритет у того пака, что идёт раньше (так же
   * собирает свои списки сам лист персонажа).
   */
  const packEntries = computed<PickerDefinition[]>(() => {
    if (selectedPackId.value !== ALL_PACKS_ID) {
      const pack = packs.value.find(
        (candidate) => candidate.packId === selectedPackId.value,
      );

      return pack?.entries ?? [];
    }

    const seenKeys = new Set<string>();
    const merged: PickerDefinition[] = [];

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

  /** Записи после поиска по названию (русскому и английскому) */
  const visibleEntries = computed<PickerDefinition[]>(() => {
    const query = searchQuery.value.trim().toLowerCase();

    if (!query) {
      return packEntries.value;
    }

    return packEntries.value.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query)
        || (entry.nameEn ?? '').toLowerCase().includes(query),
    );
  });

  /** Что у персонажа уже выбрано: вид, предыстория или список классов */
  const currentEntries = computed<CurrentEntry[]>(() => {
    if (props.kind === 'species') {
      const species = props.actor.system.species;

      return species
        ? [{ key: species.speciesKey, label: species.speciesName }]
        : [];
    }

    if (props.kind === 'background') {
      const background = props.actor.system.background;

      return background
        ? [{ key: background.backgroundKey, label: background.backgroundName }]
        : [];
    }

    return props.actor.system.classes.map((entry) => ({
      key: entry.classKey,
      label: `${entry.className} ${entry.level}`,
    }));
  });

  /** Ключи записей, которые у персонажа уже есть */
  const takenKeys = computed(
    () => new Set(currentEntries.value.map((entry) => entry.key)),
  );

  /**
   * Можно ли отметить несколько записей разом. Классов у персонажа бывает
   * несколько (мультикласс), вид и предыстория — по одному.
   */
  const isMultiSelect = computed(() => props.kind === 'class');

  /** Ключи отмеченных записей */
  const selectedKeys = computed(
    () => new Set(selectedDefinitions.value.map((entry) => entry.key)),
  );

  /** Можно ли подтвердить выбор */
  const canConfirmSelection = computed(
    () => selectedDefinitions.value.length > 0,
  );

  /** Текст подтверждения удаления — свой у каждого типа записи */
  const removalConfirmText = computed(() => {
    if (props.kind === 'species') {
      return COMPENDIUM_PICKER_LABELS.removeSpeciesConfirm;
    }

    if (props.kind === 'background') {
      return COMPENDIUM_PICKER_LABELS.removeBackgroundConfirm;
    }

    const pending = currentEntries.value.find(
      (entry) => entry.key === pendingRemovalKey.value,
    );

    return (
      COMPENDIUM_PICKER_LABELS.removeClassConfirmPrefix
      + (pending?.label ?? '')
      + COMPENDIUM_PICKER_LABELS.removeClassConfirmSuffix
    );
  });

  /** Открытая на просмотр запись, суженная до вида */
  const detailSpecies = computed<SpeciesDefinition | null>(() => {
    const definition = detailDefinition.value;

    return definition && definition.type === 'species' ? definition : null;
  });

  /** Открытая на просмотр запись, суженная до класса */
  const detailClass = computed<ClassDefinition | null>(() => {
    const definition = detailDefinition.value;

    return definition && definition.type === 'class' ? definition : null;
  });

  /** Открытая на просмотр запись, суженная до предыстории */
  const detailBackground = computed<BackgroundDefinition | null>(() => {
    const definition = detailDefinition.value;

    return definition && definition.type === 'background' ? definition : null;
  });

  /**
   * Приводит определение к свободной форме записи карточки: у интерфейсов нет
   * неявной индексной сигнатуры, а `EntityCard` ждёт именно её.
   *
   * @param entry - определение вида, класса или предыстории
   */
  function toCardEntry<T extends object>(entry: T): { [K in keyof T]: T[K] } {
    return entry;
  }

  /**
   * Загружает записи выбранного типа по пакам компендиума.
   *
   * @param kind - тип записей на момент запроса: пока идёт загрузка, окно могли
   * открыть уже для другого раздела — тогда ответ выбрасываем
   */
  async function loadPacks(kind: MissingSheetSectionKey): Promise<void> {
    if (!props.socket) {
      compendiumPacks.value = [];
      isLoading.value = false;

      return;
    }

    isLoading.value = true;

    const loaded: PackKindEntries[] = await loadCompendiumKindByPack(
      props.socket,
      kind,
    );

    // Раздел успели сменить — ответ уже не про то, что показано; спиннер снимет
    // запрос нового раздела, он идёт следом.
    if (kind !== props.kind) {
      return;
    }

    const result: PickerPack[] = [];

    for (const pack of loaded) {
      // Расширяем до unknown[]: определения не подтипы CompendiumEntry, и
      // сужающий предикат иначе отвергается как несовместимый (TS2677).
      const rawEntries: unknown[] = pack.entries;

      const entries = rawEntries.filter((entry): entry is PickerDefinition =>
        isKindDefinition(entry, kind),
      );

      if (entries.length > 0) {
        result.push({
          packId: pack.packId,
          packName: pack.packName,
          entries,
        });
      }
    }

    compendiumPacks.value = result;
    isLoading.value = false;
  }

  /**
   * Открывает запись на просмотр: описание, дары, особенности. Отметку клик по
   * карточке не меняет — за неё отвечает флажок слева.
   *
   * @param entry - запись компендиума
   */
  function openDetail(entry: PickerDefinition): void {
    detailDefinition.value = entry;
    isDetailOpen.value = true;
  }

  /**
   * Можно ли отметить запись. Класс, который у персонажа уже есть, из этого
   * окна не берут: его следующий уровень выдаёт окно повышения уровня.
   *
   * @param entry - запись компендиума
   */
  function isSelectable(entry: PickerDefinition): boolean {
    return !(props.kind === 'class' && takenKeys.value.has(entry.key));
  }

  /**
   * Отмечает или снимает отметку с записи. У вида и предыстории отметка одна:
   * новая заменяет прежнюю.
   *
   * @param entry - запись компендиума
   */
  function toggleSelection(entry: PickerDefinition): void {
    if (!isSelectable(entry)) {
      return;
    }

    if (selectedKeys.value.has(entry.key)) {
      selectedDefinitions.value = selectedDefinitions.value.filter(
        (selected) => selected.key !== entry.key,
      );

      return;
    }

    selectedDefinitions.value = isMultiSelect.value
      ? [...selectedDefinitions.value, entry]
      : [entry];
  }

  /** Отмечает запись из окна её просмотра и возвращает к списку */
  function handleDetailSelect(): void {
    const definition = detailDefinition.value;

    if (!definition) {
      return;
    }

    isDetailOpen.value = false;

    if (!selectedKeys.value.has(definition.key)) {
      toggleSelection(definition);
    }
  }

  /** Отдаёт отмеченные записи листу и закрывает окно */
  function confirmSelection(): void {
    if (!canConfirmSelection.value) {
      return;
    }

    emit('select', [...selectedDefinitions.value]);
    emit('update:open', false);
  }

  /**
   * Запрашивает подтверждение удаления записи с листа.
   *
   * @param key - ключ удаляемой записи
   */
  function requestRemoval(key: string): void {
    pendingRemovalKey.value = key;
  }

  /** Отменяет подтверждение удаления */
  function cancelRemoval(): void {
    pendingRemovalKey.value = null;
  }

  /** Подтверждает удаление записи с листа персонажа */
  function confirmRemoval(): void {
    const key = pendingRemovalKey.value;

    if (!key) {
      return;
    }

    pendingRemovalKey.value = null;

    if (props.kind === 'class') {
      emit('remove-class', key);
    } else {
      emit('remove-current');
    }
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

  // Открытие окна (и смена раздела) сбрасывает поиск, выбор пака и подтверждения
  // и запрашивает записи нужного типа.
  watch(
    () => [props.open, props.kind] as const,
    ([isOpen, kind]) => {
      if (!isOpen) {
        return;
      }

      searchQuery.value = '';
      selectedPackId.value = ALL_PACKS_ID;
      selectedDefinitions.value = [];
      pendingRemovalKey.value = null;
      detailDefinition.value = null;
      isDetailOpen.value = false;
      compendiumPacks.value = [];

      void loadPacks(kind);
    },
    { immediate: true },
  );
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="COMPENDIUM_PICKER_TITLES[kind]"
    :initial-width="820"
    :initial-height="620"
    :min-width="560"
    :min-height="360"
    :z-index="Z_INDEX.MODAL_ELEVATED"
    :ui="{ body: 'overflow-hidden p-0 flex flex-col' }"
    @update:open="handleModalClose"
  >
    <template #body>
      <div class="flex min-h-0 flex-1">
        <!-- Компендиумы: из какого пака берём запись -->
        <div
          class="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-accented/30 p-3"
        >
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
        </div>

        <!-- Записи выбранного компендиума -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <!-- Что уже выбрано у персонажа -->
          <div
            v-if="currentEntries.length > 0"
            class="shrink-0 border-b border-default/50 px-4 py-3"
          >
            <span
              class="text-xs font-semibold tracking-wider text-muted uppercase"
            >
              {{ COMPENDIUM_PICKER_CURRENT_TITLES[kind] }}
            </span>

            <!-- Подтверждение удаления живёт на месте самой полосы -->
            <div
              v-if="pendingRemovalKey"
              class="mt-2 flex flex-col gap-2"
            >
              <p class="text-sm text-toned">{{ removalConfirmText }}</p>

              <div class="flex items-center gap-2">
                <UButton
                  color="error"
                  size="xs"
                  icon="tabler:trash"
                  @click.left.exact.prevent="confirmRemoval"
                >
                  {{ MODAL_BUTTON_LABELS.remove }}
                </UButton>

                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click.left.exact.prevent="cancelRemoval"
                >
                  {{ MODAL_BUTTON_LABELS.cancel }}
                </UButton>
              </div>
            </div>

            <div
              v-else
              class="mt-2 flex flex-wrap items-center gap-2"
            >
              <div
                v-for="entry in currentEntries"
                :key="entry.key"
                class="flex items-center gap-1.5 rounded-full border border-default/50 bg-elevated/40 py-1 pr-1 pl-3"
              >
                <span class="text-sm text-toned">{{ entry.label }}</span>

                <UButton
                  color="error"
                  variant="ghost"
                  size="xs"
                  icon="tabler:trash"
                  :title="MODAL_BUTTON_LABELS.remove"
                  @click.left.exact.prevent="requestRemoval(entry.key)"
                />
              </div>
            </div>
          </div>

          <!-- Поиск по записям -->
          <div class="shrink-0 px-4 pt-3 pb-2">
            <UInput
              v-model="searchQuery"
              icon="tabler:search"
              :placeholder="COMPENDIUM_LABELS.searchPlaceholder"
              size="sm"
              :ui="{ root: 'w-full' }"
            />
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
              class="flex flex-col gap-1"
            >
              <div
                v-for="entry in visibleEntries"
                :key="entry.key"
                class="flex items-center gap-2"
              >
                <!-- Отметка: клик по самой карточке открывает просмотр -->
                <UCheckbox
                  :model-value="selectedKeys.has(entry.key)"
                  :disabled="!isSelectable(entry)"
                  @update:model-value="toggleSelection(entry)"
                />

                <EntityCard
                  class="flex-1 hover:bg-primary/10"
                  :class="{ 'opacity-60': !isSelectable(entry) }"
                  :entity-type="kind"
                  :entry="toCardEntry(entry)"
                  @click="openDetail(entry)"
                />

                <UBadge
                  v-if="takenKeys.has(entry.key)"
                  color="success"
                  variant="subtle"
                  size="sm"
                  class="shrink-0"
                >
                  {{ COMPENDIUM_PICKER_LABELS.taken }}
                </UBadge>
              </div>
            </div>

            <div
              v-else-if="searchQuery.trim()"
              class="py-8 text-center text-sm text-dimmed"
            >
              {{ COMPENDIUM_LABELS.nothingFound }}
            </div>

            <div
              v-else
              class="py-8 text-center text-sm text-dimmed"
            >
              {{ COMPENDIUM_PICKER_LABELS.emptyPack }}
            </div>
          </div>

          <!-- Подтверждение выбора -->
          <div class="shrink-0 border-t border-default/50 px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-0.5 text-sm text-muted">
                <span>
                  {{ COMPENDIUM_PICKER_LABELS.selectedCount }}
                  <span class="font-semibold text-toned">
                    {{ selectedDefinitions.length }}
                  </span>
                </span>

                <span
                  v-if="isMultiSelect"
                  class="text-xs text-dimmed"
                >
                  {{ COMPENDIUM_PICKER_LABELS.multiClassHint }}
                </span>
              </div>

              <UButton
                color="primary"
                size="sm"
                icon="tabler:plus"
                :disabled="!canConfirmSelection"
                @click.left.exact.prevent="confirmSelection"
              >
                {{ MODAL_BUTTON_LABELS.add }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDraggableModal>

  <!-- Просмотр вида: кнопка «Выбрать» в шапке отмечает запись в списке -->
  <SpeciesDetailModal
    v-if="detailSpecies"
    v-model:open="isDetailOpen"
    :species-definition="detailSpecies"
    :z-index="Z_INDEX.MODAL_CONFIRM"
    show-select-button
    @select="handleDetailSelect"
  />

  <!-- Просмотр класса -->
  <ClassDetailModal
    v-if="detailClass"
    v-model:open="isDetailOpen"
    :class-definition="detailClass"
    :z-index="Z_INDEX.MODAL_CONFIRM"
    show-select-button
    @select="handleDetailSelect"
  />

  <!-- Просмотр предыстории -->
  <BackgroundDetailModal
    v-if="detailBackground"
    v-model:open="isDetailOpen"
    :background-definition="detailBackground"
    :z-index="Z_INDEX.MODAL_CONFIRM"
    show-select-button
    @select="handleDetailSelect"
  />
</template>
