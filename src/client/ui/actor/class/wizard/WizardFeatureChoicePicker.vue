<script setup lang="ts">
  import type { ClassFeatureChoice } from '@vtt/shared/system/dnd.js';

  import type { WizardFeatureChoicePick } from './useClassWizard';

  import { computed, ref } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';

  import { CLASS_WIZARD_LABELS } from '../../constants';

  /**
   * Выбор вариантов одного умения: боевой стиль, манёвры, воззвания.
   *
   * Вариантов берут столько, сколько назначила настройка выбора умения, и это
   * число растёт по уровням — поэтому пикер не «одна кнопка из списка», а набор
   * со счётчиком. Когда берут один вариант, нажатие переносит выбор на него:
   * снимать прежний вручную незачем.
   *
   * Варианты показываются строками в одно название: у колдуна их два десятка, и
   * с описанием каждого список занимал несколько экранов — за ним не было видно
   * ни счётчика, ни остальных умений уровня. Описание открывается отдельным
   * окном по кнопке.
   *
   * Взятое на прошлых уровнях показывается отдельной строкой и не выбирается —
   * второй раз одно и то же воззвание не берут. Помеченные повторяемыми
   * остаются в общем списке: их для того и помечают.
   */
  const props = defineProps<{
    pick: WizardFeatureChoicePick;
    /** Ключи вариантов, выбранных на этом уровне */
    selected: string[];
  }>();

  const emit = defineEmits<{
    'update:selected': [featureKey: string, choiceKeys: string[]];
  }>();

  const { getNextZIndex } = useModalManager();

  /** Вариант, описание которого открыто окном; `null` — окна нет. */
  const detailChoice = ref<ClassFeatureChoice | null>(null);

  /** Z-index окна описания: оно встаёт поверх окна мастера. */
  const detailZIndex = ref<number | undefined>(undefined);

  /** Счётчик набранного: «выбрано 1 из 2». */
  const counter = computed(
    () =>
      `${CLASS_WIZARD_LABELS.choiceCounterPrefix}${props.selected.length} `
      + `${CLASS_WIZARD_LABELS.choiceCounterOf} ${props.pick.count}`,
  );

  /** Набрано ли положенное число вариантов. */
  const isComplete = computed(() => props.selected.length >= props.pick.count);

  /**
   * Выбран ли вариант прямо сейчас.
   *
   * @param choiceKey - ключ варианта
   */
  function isSelected(choiceKey: string): boolean {
    return props.selected.includes(choiceKey);
  }

  /** Оформление счётчика: пока не набрано — предупреждением. */
  const counterClass = computed(() =>
    isComplete.value ? 'text-dimmed' : 'text-warning',
  );

  /**
   * Значок выбора в строке варианта: закрашенный кружок у взятого.
   *
   * @param choiceKey - ключ варианта
   */
  function optionIcon(choiceKey: string): string {
    return isSelected(choiceKey)
      ? 'tabler:circle-check-filled'
      : 'tabler:circle';
  }

  /**
   * Цвет значка выбора: у взятого варианта он ведущий, у остальных приглушён.
   *
   * @param choiceKey - ключ варианта
   */
  function optionIconClass(choiceKey: string): string {
    return isSelected(choiceKey) ? 'text-primary' : 'text-dimmed';
  }

  /**
   * Оформление строки варианта: выбранный подсвечен, лишний при наборе полного
   * числа приглушён — чтобы было видно, что больше не берут.
   *
   * @param choiceKey - ключ варианта
   */
  function optionClass(choiceKey: string): string {
    if (isSelected(choiceKey)) {
      return 'border-primary/50 bg-primary/10';
    }

    return isComplete.value && props.pick.count > 1
      ? 'border-default/50 bg-default/30 opacity-60'
      : 'border-default/50 bg-default/30 hover:border-accented/50';
  }

  /**
   * Открывает описание варианта отдельным окном.
   *
   * @param choice - вариант, чьё описание читают
   */
  function openDetail(choice: ClassFeatureChoice): void {
    detailChoice.value = choice;
    detailZIndex.value = getNextZIndex();
  }

  /**
   * Закрывает окно описания. Крестик и клик мимо приходят сюда же.
   *
   * @param isOpen - новое состояние окна
   */
  function handleDetailOpenChange(isOpen: boolean): void {
    if (!isOpen) {
      detailChoice.value = null;
    }
  }

  /**
   * Берёт вариант или снимает его.
   *
   * @param choiceKey - ключ варианта
   */
  function toggle(choiceKey: string): void {
    if (isSelected(choiceKey)) {
      emit(
        'update:selected',
        props.pick.featureKey,
        props.selected.filter((key) => key !== choiceKey),
      );

      return;
    }

    // Один вариант — нажатие переносит выбор; несколько — набирают до предела
    if (props.pick.count === 1) {
      emit('update:selected', props.pick.featureKey, [choiceKey]);

      return;
    }

    if (isComplete.value) {
      return;
    }

    emit('update:selected', props.pick.featureKey, [
      ...props.selected,
      choiceKey,
    ]);
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-sm font-medium text-toned">
        {{ props.pick.label }}
      </span>

      <span
        class="text-xs"
        :class="counterClass"
      >
        {{ counter }}
      </span>
    </div>

    <!-- Взятое раньше: видно, что уже потрачено, но выбрать нельзя -->
    <div
      v-if="props.pick.taken.length > 0"
      class="flex flex-wrap items-center gap-1.5"
    >
      <span class="text-xs text-dimmed">
        {{ CLASS_WIZARD_LABELS.choiceTakenTitle }}
      </span>

      <UBadge
        v-for="choice in props.pick.taken"
        :key="choice.key"
        size="sm"
        color="neutral"
        variant="subtle"
      >
        {{ choice.name }}
      </UBadge>
    </div>

    <!-- Строка варианта — две сомкнутые кнопки: плашка берёт вариант, приросшая
      к ней справа кнопка открывает описание. Кнопка внутри кнопки недопустима,
      поэтому они соседи со сведёнными скруглениями и общей границей -->
    <div class="flex flex-col gap-1.5">
      <div
        v-for="choice in props.pick.options"
        :key="choice.key"
        class="flex items-stretch"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-l-md border border-r-0 p-2 text-left transition-colors"
          :class="optionClass(choice.key)"
          :aria-pressed="isSelected(choice.key)"
          @click.left.exact.prevent="toggle(choice.key)"
        >
          <UIcon
            :name="optionIcon(choice.key)"
            class="size-4 shrink-0"
            :class="optionIconClass(choice.key)"
          />

          <span class="min-w-0 flex-1 truncate text-sm text-highlighted">
            {{ choice.name }}
          </span>

          <!-- Подсказка варианта: короткая подпись из записи класса -->
          <span
            v-if="choice.additional"
            class="hidden shrink-0 text-xs text-dimmed md:inline"
            >{{ choice.additional }}</span
          >

          <span
            v-if="choice.prerequisite"
            class="hidden shrink-0 text-xs text-warning lg:inline"
            >{{ choice.prerequisite }}</span
          >

          <UBadge
            v-if="choice.repeatable"
            size="sm"
            color="info"
            variant="subtle"
            class="hidden shrink-0 md:inline-flex"
          >
            {{ CLASS_WIZARD_LABELS.choiceRepeatableBadge }}
          </UBadge>
        </button>

        <button
          type="button"
          class="flex shrink-0 cursor-pointer items-center justify-center rounded-r-md border border-default/50 bg-default/30 px-3 text-dimmed transition-colors hover:border-accented/50 hover:bg-elevated/50 hover:text-default"
          :aria-label="CLASS_WIZARD_LABELS.choiceDetailOpen"
          @click.left.exact.prevent="openDetail(choice)"
        >
          <UIcon
            name="tabler:info-circle"
            class="size-5"
          />
        </button>
      </div>
    </div>
  </div>

  <!-- Описание варианта отдельным окном: список остаётся коротким, а прочитать
    вариант целиком можно, не разворачивая весь список -->
  <UDraggableModal
    :open="detailChoice !== null"
    :title="detailChoice?.name ?? CLASS_WIZARD_LABELS.choiceDetailTitle"
    :subtitle="detailChoice?.nameEn"
    blocking
    :min-width="420"
    :min-height="240"
    :z-index="detailZIndex"
    @update:open="handleDetailOpenChange"
  >
    <template #body>
      <div
        v-if="detailChoice"
        class="flex flex-col gap-2"
      >
        <div
          v-if="detailChoice.additional || detailChoice.prerequisite"
          class="flex flex-col gap-1"
        >
          <span
            v-if="detailChoice.additional"
            class="text-xs text-dimmed"
            >{{ detailChoice.additional }}</span
          >

          <span
            v-if="detailChoice.prerequisite"
            class="text-xs text-warning"
            >{{ CLASS_WIZARD_LABELS.choicePrerequisitePrefix
            }}{{ detailChoice.prerequisite }}</span
          >
        </div>

        <ItemDescriptionRenderer
          :content="detailChoice.description"
          class="text-muted"
        />
      </div>
    </template>
  </UDraggableModal>
</template>
