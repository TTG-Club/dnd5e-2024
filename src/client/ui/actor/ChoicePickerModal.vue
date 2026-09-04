<script setup lang="ts">
  /**
   * Окно выбора в мастерах персонажа: заклинания, навыки, инструменты, оружие,
   * варианты умений, черта, происхождение — всё, из чего игрок выбирает.
   *
   * Одно окно на все выборы листа. Раньше выбор выглядел по-разному в
   * зависимости от длины пула: три заговора — плашками, два десятка — селектом,
   * воззвания — списком прямо в шаге мастера. Игрок за одно повышение уровня
   * проходит их подряд, и три разных жеста для одной и той же работы он читает
   * как три разные механики. Теперь везде одинаково: строка со счётчиком и
   * кнопкой «Выбрать», а сам выбор — здесь.
   *
   * Отметки правятся на копии и уходят наружу кнопкой: закрытие крестиком или
   * «Отменой» оставляет выбор таким, каким он был до открытия.
   *
   * Поиск появляется только у длинных пулов ({@link CHOICE_PICKER_SEARCH_LIMIT}):
   * список из трёх строк глазами берут быстрее, чем набирают запрос.
   */

  import type { Spell } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';

  import { useEntityDetailModals } from '../../composables/useEntityDetailModals';
  import {
    CHOICE_PICKER_LABELS,
    CHOICE_PICKER_SEARCH_LIMIT,
    MODAL_BUTTON_LABELS,
  } from './constants';

  /** Вариант, из которых выбирают. */
  export interface ChoicePickerOption {
    /** То, что уйдёт на лист: ключ навыка, идентификатор заклинания, ключ варианта */
    value: string;
    /** Подпись для игрока */
    name: string;
    /** Английское название — второй строкой; есть не у всех справочников */
    nameEn?: string;
    /** Короткая подпись справа: категория черты, круг заклинания, приём */
    badge?: string;
    /** Пояснение варианта одной строкой — из записи класса или вида */
    additional?: string;
    /** Требования варианта: лист их не проверяет, решает игрок */
    prerequisite?: string;
    /** Описание целиком — открывается отдельным окном по кнопке */
    description?: string;
    /**
     * Запись заклинания целиком. У заклинания одного описания мало — игроку
     * нужны круг, время, дистанция и урон, — поэтому кнопка «i» открывает
     * его обычную карточку, а не выжимку из описания.
     */
    spell?: Spell;
    /** Вариант берут повторно — пометка строки */
    repeatable?: boolean;
    /**
     * Отметить нельзя: воззвание, взятое на прошлом уровне, второй раз не
     * берут. Строка видна и гаснет — так понятно, куда делся вариант.
     */
    disabled?: boolean;
  }

  const props = withDefaults(
    defineProps<{
      open: boolean;
      /** Заголовок окна — что именно выбирают */
      title: string;
      /** Подзаголовок: источник выбора, умение, черта */
      subtitle?: string;
      /** Варианты в порядке показа */
      options: ReadonlyArray<ChoicePickerOption>;
      /** Уже отмеченное — с чего окно начинает */
      selected: ReadonlyArray<string>;
      /** Сколько вариантов берут */
      max: number;
      /** Z-index (управляется вызывающим для bring-to-front) */
      zIndex?: number;
    }>(),
    { subtitle: undefined, zIndex: undefined },
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Отметки подтверждены — выбор забирает их целиком */
    'apply': [values: string[]];
  }>();

  const { getNextZIndex } = useModalManager();

  /** Карточка заклинания — ею открываются варианты выбора заклинаний */
  const { openSpellDetail } = useEntityDetailModals();

  const searchQuery = ref('');

  /** Отметки правятся на копии, применяются кнопкой */
  const localSelected = ref<string[]>([]);

  /** Вариант, описание которого открыто окном; `null` — окна нет. */
  const detailOption = ref<ChoicePickerOption | null>(null);

  /** Z-index окна описания: оно встаёт поверх окна выбора. */
  const detailZIndex = ref<number | undefined>(undefined);

  const selectedKeys = computed(() => new Set(localSelected.value));

  /** Набрано ли положенное число вариантов */
  const isComplete = computed(() => localSelected.value.length >= props.max);

  /** Поиск нужен только длинному пулу — короткий читается целиком */
  const isSearchable = computed(
    () => props.options.length > CHOICE_PICKER_SEARCH_LIMIT,
  );

  /** Счётчик набранного: «Выбрано 1 из 2» */
  const counter = computed(
    () =>
      `${CHOICE_PICKER_LABELS.chosenPrefix}${localSelected.value.length}`
      + `${CHOICE_PICKER_LABELS.chosenMiddle}${props.max}`,
  );

  /** Оформление счётчика: пока не набрано — предупреждением */
  const counterClass = computed(() =>
    isComplete.value ? 'text-dimmed' : 'text-warning',
  );

  /** Варианты после поиска по названию — русскому и английскому */
  const visibleOptions = computed<ChoicePickerOption[]>(() => {
    const query = searchQuery.value.trim().toLowerCase();

    if (!query) {
      return [...props.options];
    }

    return props.options.filter(
      (option) =>
        option.name.toLowerCase().includes(query)
        || Boolean(option.nameEn?.toLowerCase().includes(query)),
    );
  });

  /**
   * Отмечен ли вариант прямо сейчас.
   *
   * @param value - значение варианта
   */
  function isPicked(value: string): boolean {
    return selectedKeys.value.has(value);
  }

  /**
   * Значок отметки: закрашенный кружок у взятого варианта.
   *
   * @param value - значение варианта
   */
  function optionIcon(value: string): string {
    return isPicked(value) ? 'tabler:circle-check-filled' : 'tabler:circle';
  }

  /**
   * Цвет значка: у взятого он ведущий, у остальных приглушён.
   *
   * @param value - значение варианта
   */
  function optionIconClass(value: string): string {
    return isPicked(value) ? 'text-primary' : 'text-dimmed';
  }

  /**
   * Оформление строки: отмеченная подсвечена, недоступная гаснет, лишняя при
   * наборе полного числа приглушена — видно, что больше не берут.
   *
   * @param option - вариант строки
   */
  function optionClass(option: ChoicePickerOption): string {
    if (isPicked(option.value)) {
      return 'border-primary/50 bg-primary/10 cursor-pointer';
    }

    if (option.disabled) {
      return 'border-default/50 bg-default/30 opacity-50 cursor-not-allowed';
    }

    // Выбор на одно значение переносится нажатием, поэтому гасить у него нечего
    return isComplete.value && props.max > 1
      ? 'border-default/50 bg-default/30 opacity-60 cursor-pointer'
      : 'border-default/50 bg-default/30 hover:border-accented/50 cursor-pointer';
  }

  /**
   * Есть ли у варианта что показать по кнопке «i»: карточка заклинания или
   * описание из записи.
   *
   * @param option - вариант строки
   */
  function hasDetail(option: ChoicePickerOption): boolean {
    return Boolean(option.spell ?? option.description);
  }

  /**
   * Скругления плашки варианта: у строки с описанием справа приросла кнопка
   * «i», и общая граница у них одна.
   *
   * @param option - вариант строки
   */
  function optionRoundingClass(option: ChoicePickerOption): string {
    return hasDetail(option) ? 'rounded-l-md border-r-0' : 'rounded-md';
  }

  /**
   * Отмечает вариант или снимает отметку. Выбор на одно значение нажатие
   * переносит: снимать прежнее вручную незачем.
   *
   * @param option - вариант строки
   */
  function toggle(option: ChoicePickerOption): void {
    if (option.disabled) {
      return;
    }

    if (isPicked(option.value)) {
      localSelected.value = localSelected.value.filter(
        (value) => value !== option.value,
      );

      return;
    }

    if (props.max === 1) {
      localSelected.value = [option.value];

      return;
    }

    if (isComplete.value) {
      return;
    }

    localSelected.value = [...localSelected.value, option.value];
  }

  /**
   * Открывает описание варианта. У заклинания — его обычной карточкой: круг,
   * время и урон живут там, а не в тексте описания. У прочих вариантов — своим
   * окном с описанием из записи.
   *
   * @param option - вариант, чьё описание читают
   */
  function openDetail(option: ChoicePickerOption): void {
    if (option.spell) {
      openSpellDetail(option.spell);

      return;
    }

    detailOption.value = option;
    detailZIndex.value = getNextZIndex();
  }

  /**
   * Закрывает окно описания. Крестик и клик мимо приходят сюда же.
   *
   * @param isOpen - новое состояние окна
   */
  function handleDetailOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      detailOption.value = null;
    }
  }

  function handleModalClose(): void {
    emit('update:open', false);
  }

  /** Отдаёт отметки выбору и закрывает окно */
  function applySelection(): void {
    emit('apply', [...localSelected.value]);
    emit('update:open', false);
  }

  // Открытие сбрасывает поиск и берёт отметки выбора заново: окно одно на всю
  // строку, и прошлый его показ к нынешнему выбору отношения не имеет
  watch(
    () => props.open,
    (isOpen) => {
      if (!isOpen) {
        return;
      }

      searchQuery.value = '';
      localSelected.value = [...props.selected];
    },
    { immediate: true },
  );
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="title"
    :subtitle="subtitle"
    blocking
    :initial-width="620"
    :initial-height="560"
    :min-width="420"
    :min-height="320"
    :z-index="zIndex"
    :ui="{ body: 'overflow-hidden p-0 flex flex-col' }"
    @update:open="handleModalClose"
  >
    <template #body>
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          v-if="isSearchable"
          class="shrink-0 border-b border-accented/30 p-3"
        >
          <UInput
            v-model="searchQuery"
            icon="tabler:search"
            :placeholder="CHOICE_PICKER_LABELS.searchPlaceholder"
            size="sm"
            :ui="{ root: 'w-full' }"
          />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <!-- Строка варианта — две сомкнутые кнопки: плашка отмечает вариант,
            приросшая справа открывает описание. Кнопка внутри кнопки
            недопустима, поэтому они соседи со сведёнными скруглениями -->
          <div
            v-if="visibleOptions.length > 0"
            class="flex flex-col gap-1.5"
          >
            <div
              v-for="option in visibleOptions"
              :key="option.value"
              class="flex items-stretch"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 border p-2 text-left transition-colors"
                :class="[optionClass(option), optionRoundingClass(option)]"
                :disabled="option.disabled"
                :aria-pressed="isPicked(option.value)"
                @click.left.exact.prevent="toggle(option)"
              >
                <UIcon
                  :name="optionIcon(option.value)"
                  class="size-4 shrink-0"
                  :class="optionIconClass(option.value)"
                />

                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-sm text-highlighted">
                    {{ option.name }}
                  </span>

                  <span
                    v-if="option.nameEn"
                    class="truncate text-xs text-dimmed"
                  >
                    {{ option.nameEn }}
                  </span>
                </span>

                <span
                  v-if="option.additional"
                  class="hidden shrink-0 text-xs text-dimmed md:inline"
                >
                  {{ option.additional }}
                </span>

                <span
                  v-if="option.prerequisite"
                  class="hidden shrink-0 text-xs text-warning lg:inline"
                >
                  {{ option.prerequisite }}
                </span>

                <UBadge
                  v-if="option.repeatable"
                  size="sm"
                  color="info"
                  variant="subtle"
                  class="hidden shrink-0 md:inline-flex"
                >
                  {{ CHOICE_PICKER_LABELS.repeatableBadge }}
                </UBadge>

                <UBadge
                  v-if="option.badge"
                  size="sm"
                  color="neutral"
                  variant="subtle"
                  class="shrink-0"
                >
                  {{ option.badge }}
                </UBadge>
              </button>

              <button
                v-if="hasDetail(option)"
                type="button"
                class="flex shrink-0 cursor-pointer items-center justify-center rounded-r-md border border-default/50 bg-default/30 px-3 text-dimmed transition-colors hover:border-accented/50 hover:bg-elevated/50 hover:text-default"
                :aria-label="CHOICE_PICKER_LABELS.detailOpen"
                @click.left.exact.prevent="openDetail(option)"
              >
                <UIcon
                  name="tabler:info-circle"
                  class="size-5"
                />
              </button>
            </div>
          </div>

          <div
            v-else
            class="py-8 text-center text-sm text-dimmed"
          >
            {{ CHOICE_PICKER_LABELS.nothingFound }}
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span
            class="text-xs"
            :class="counterClass"
          >
            {{ counter }}
          </span>

          <UButton
            :label="CHOICE_PICKER_LABELS.clear"
            color="neutral"
            variant="ghost"
            size="xs"
            :disabled="localSelected.length === 0"
            @click.left.exact.prevent="localSelected = []"
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

  <!-- Описание варианта отдельным окном: список остаётся коротким, а прочитать
    вариант целиком можно, не разворачивая весь список -->
  <UDraggableModal
    :open="detailOption !== null"
    :title="detailOption?.name ?? CHOICE_PICKER_LABELS.detailTitle"
    :subtitle="detailOption?.nameEn"
    blocking
    :min-width="420"
    :min-height="240"
    :z-index="detailZIndex"
    @update:open="handleDetailOpenChange"
  >
    <template #body>
      <div
        v-if="detailOption"
        class="flex flex-col gap-2"
      >
        <div
          v-if="detailOption.additional || detailOption.prerequisite"
          class="flex flex-col gap-1"
        >
          <span
            v-if="detailOption.additional"
            class="text-xs text-dimmed"
          >
            {{ detailOption.additional }}
          </span>

          <span
            v-if="detailOption.prerequisite"
            class="text-xs text-warning"
          >
            {{ CHOICE_PICKER_LABELS.prerequisitePrefix
            }}{{ detailOption.prerequisite }}
          </span>
        </div>

        <ItemDescriptionRenderer
          :content="detailOption.description ?? ''"
          class="text-muted"
        />
      </div>
    </template>
  </UDraggableModal>
</template>
