<script setup lang="ts">
  /**
   * Окно выбора значений дара: что строка выдаёт либо из чего игрок выбирает.
   *
   * Устроено как окно выбора записи компендиума (`CompendiumRefPickerModal`):
   * слева — откуда берутся значения и чем их сузить, справа — поиск и список с
   * отметками. Разница только в источнике: там записи паков, здесь справочники
   * правил и данные мира, у которых пака нет. Общий вид важнее общего кода —
   * автор ходит по обоим окнам подряд и не должен переучиваться.
   *
   * Левая колонка у дара — это ВИДЫ строки: у обычной строки он один и колонка
   * показывает только «Все», у смешанной («Умелый»: навык или инструмент) —
   * каждый вид своей строкой. Под ними фильтр: категория оружия, приём, к какой
   * характеристике относится навык.
   */

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';

  import {
    COMPENDIUM_LABELS,
    COMPENDIUM_PACK_BUTTON_CLASS,
    COMPENDIUM_PACK_BUTTON_IDLE_CLASS,
    COMPENDIUM_PACK_BUTTON_SELECTED_CLASS,
    MODAL_BUTTON_LABELS,
    POOL_PICKER_LABELS,
    REF_PICKER_LABELS,
  } from '../constants';
  import PickerListRow from '../PickerListRow.vue';

  /** Значение, доступное к выбору. */
  export interface PoolPickerOption {
    /** То, что уйдёт на лист (`sleightOfHand`, `battleaxe`) */
    value: string;
    /** Подпись для автора и игрока */
    name: string;
    /** Английское название — второй строкой; есть не у всех справочников */
    nameEn?: string;
    /** Вид дара, которому значение принадлежит: им работает левая колонка */
    group: string;
    /** Значение фильтра («Воинское», «Прорубание»); пусто — под фильтр не идёт */
    filter?: string;
  }

  /** Вид дара строки — строка левой колонки. */
  export interface PoolPickerGroup {
    id: string;
    name: string;
  }

  /** Псевдо-группа «все виды» — выбрана по умолчанию. */
  const ALL_GROUPS_ID = '__all__';

  const props = withDefaults(
    defineProps<{
      open: boolean;
      /** Заголовок окна — что именно выбирают */
      title: string;
      /** Виды дара строки в порядке показа */
      groups: PoolPickerGroup[];
      /** Все значения всех видов строки */
      options: PoolPickerOption[];
      /** Уже отмеченные значения строки */
      selected: string[];
      /** Подпись панели фильтра; пусто — общая «Фильтр» */
      filterLabel?: string;
      /**
       * Порядок значений фильтра. Пусто — по алфавиту; там, где порядок
       * содержательный (простое перед воинским), его задают списком.
       */
      filterOrder?: string[];
      /** Z-index (управляется вызывающим для bring-to-front) */
      zIndex?: number;
    }>(),
    { filterLabel: '', filterOrder: () => [], zIndex: undefined },
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Отметки подтверждены — строка забирает их целиком */
    'apply': [values: string[]];
  }>();

  const searchQuery = ref('');
  const selectedGroupId = ref<string>(ALL_GROUPS_ID);
  const selectedFilterValues = ref<string[]>([]);

  /** Отмеченные значения — правятся на копии, применяются кнопкой */
  const localSelected = ref<string[]>([]);

  const selectedKeys = computed(() => new Set(localSelected.value));

  /** Подпись панели фильтра: вызывающий мог её и не назвать */
  const filterPlaceholder = computed(
    () => props.filterLabel || REF_PICKER_LABELS.filterPlaceholder,
  );

  /** Значения выбранного вида; «все» — весь набор строки */
  const groupOptions = computed<PoolPickerOption[]>(() =>
    selectedGroupId.value === ALL_GROUPS_ID
      ? props.options
      : props.options.filter(
          (option) => option.group === selectedGroupId.value,
        ),
  );

  /**
   * Значения фильтра, которые встречаются в наборе. Считаются по всему набору, а
   * не по выбранному виду: иначе отметка исчезала бы при переключении вида, а
   * вместе с ней и половина списка.
   */
  const filterOptions = computed<string[]>(() => {
    const values = new Set<string>();

    for (const option of props.options) {
      if (option.filter) {
        values.add(option.filter);
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

  /** Значения после фильтра и поиска по подписи */
  const visibleOptions = computed<PoolPickerOption[]>(() => {
    const query = searchQuery.value.trim().toLowerCase();
    const allowed = new Set(selectedFilterValues.value);

    return groupOptions.value.filter((option) => {
      if (allowed.size > 0 && !allowed.has(option.filter ?? '')) {
        return false;
      }

      return (
        !query
        || option.name.toLowerCase().includes(query)
        || Boolean(option.nameEn?.toLowerCase().includes(query))
      );
    });
  });

  /** Сколько значений у вида — числом в его строке слева */
  function groupCount(groupId: string): number {
    return props.options.filter((option) => option.group === groupId).length;
  }

  /**
   * Оформление строки левой колонки: выбранная подсвечена, прочие теплеют
   * только под курсором.
   *
   * @param isActive - выбрана ли строка
   */
  function sidebarButtonClass(isActive: boolean): string {
    const stateClass = isActive
      ? COMPENDIUM_PACK_BUTTON_SELECTED_CLASS
      : COMPENDIUM_PACK_BUTTON_IDLE_CLASS;

    return `${COMPENDIUM_PACK_BUTTON_CLASS} ${stateClass}`;
  }

  /**
   * Отмечает или снимает отметку со значения.
   *
   * @param value - значение набора
   */
  function toggleValue(value: string): void {
    localSelected.value = selectedKeys.value.has(value)
      ? localSelected.value.filter((selected) => selected !== value)
      : [...localSelected.value, value];
  }

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

  /** Отмечает всё, что сейчас показано: «все простые» одним движением */
  function selectVisible(): void {
    const known = new Set(localSelected.value);

    localSelected.value = [
      ...localSelected.value,
      ...visibleOptions.value
        .map((option) => option.value)
        .filter((value) => !known.has(value)),
    ];
  }

  /** Снимает отметки со всего, что сейчас показано */
  function clearVisible(): void {
    const shown = new Set(visibleOptions.value.map((option) => option.value));

    localSelected.value = localSelected.value.filter(
      (value) => !shown.has(value),
    );
  }

  function handleModalClose(): void {
    emit('update:open', false);
  }

  /** Отдаёт отметки строке и закрывает окно */
  function applySelection(): void {
    emit('apply', [...localSelected.value]);
    emit('update:open', false);
  }

  // Открытие сбрасывает поиск и фильтр и берёт отметки строки заново: окно одно
  // на всю форму, и прошлый его показ к этой строке отношения не имеет
  watch(
    () => props.open,
    (isOpen) => {
      if (!isOpen) {
        return;
      }

      searchQuery.value = '';
      selectedGroupId.value = ALL_GROUPS_ID;
      selectedFilterValues.value = [];
      localSelected.value = [...props.selected];
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
        <!-- Виды строки и фильтр: откуда значения и чем их сузить -->
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
            :class="sidebarButtonClass(selectedGroupId === ALL_GROUPS_ID)"
            @click.left.exact.prevent="selectedGroupId = ALL_GROUPS_ID"
          >
            <span class="truncate">{{ POOL_PICKER_LABELS.allGroups }}</span>

            <span class="shrink-0 text-xs text-dimmed">
              {{ options.length }}
            </span>
          </button>

          <!-- Один вид собой колонку не наполняет: «Все» и он — одно и то же -->
          <template v-if="groups.length > 1">
            <button
              v-for="group in groups"
              :key="group.id"
              type="button"
              :class="sidebarButtonClass(selectedGroupId === group.id)"
              @click.left.exact.prevent="selectedGroupId = group.id"
            >
              <span class="truncate">{{ group.name }}</span>

              <span class="shrink-0 text-xs text-dimmed">
                {{ groupCount(group.id) }}
              </span>
            </button>
          </template>

          <!-- Фильтр — под видами: сначала выбирают, ЧТО за значения, потом
            сужают, какие именно -->
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
              :class="sidebarButtonClass(selectedFilterValues.includes(value))"
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

        <!-- Значения выбранного вида: справа ровно список, и прокручивается
          он один — как в окне компендиума -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div
              v-if="visibleOptions.length > 0"
              class="flex flex-col divide-y divide-accented/25"
            >
              <PickerListRow
                v-for="option in visibleOptions"
                :key="option.value"
                :name="option.name"
                :name-en="option.nameEn"
                :badge="option.filter"
                :selected="selectedKeys.has(option.value)"
                @toggle="toggleValue(option.value)"
              />
            </div>

            <div
              v-else
              class="py-8 text-center text-sm text-dimmed"
            >
              {{ COMPENDIUM_LABELS.nothingFound }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="text-xs text-dimmed">
            {{ REF_PICKER_LABELS.selectedPrefix }}{{ localSelected.length }}
          </span>

          <!-- Отметить показанное: отобрал «Простое» — и взял его целиком -->
          <UButton
            :label="POOL_PICKER_LABELS.selectVisible"
            color="neutral"
            variant="soft"
            size="xs"
            :disabled="visibleOptions.length === 0"
            @click.left.exact.prevent="selectVisible"
          />

          <UButton
            :label="POOL_PICKER_LABELS.clearVisible"
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="visibleOptions.length === 0"
            @click.left.exact.prevent="clearVisible"
          />
        </div>

        <div class="flex gap-3">
          <UButton
            :label="MODAL_BUTTON_LABELS.cancel"
            color="neutral"
            variant="ghost"
            @click.left.exact.prevent="handleModalClose"
          />

          <UButton
            :label="MODAL_BUTTON_LABELS.apply"
            color="primary"
            @click.left.exact.prevent="applySelection"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
