<script setup lang="ts">
  /**
   * Строка списка в окнах выбора: отметка и общее тело строки.
   *
   * Одна на все окна выбора — и то, что берёт записи компендиума, и то, что
   * берёт значения справочников. Строки в них означают одно и то же, и разный
   * вид сбивал бы: автор ходит по этим окнам подряд.
   *
   * Само тело строки — {@link EntityRowBody}, общее со списками компендиума и
   * листа: название, английское второй строкой и источник справа. Здесь к нему
   * добавляется только отметка. У значения справочника источника нет — вместо
   * него пометка ({@link badge}): приём, категория, характеристика.
   */

  import type { SourceDefinition } from '@vtt/shared';

  import { computed } from 'vue';

  import EntityRowBody from './EntityRowBody.vue';

  const props = defineProps<{
    /** Название — первая строка */
    name: string;
    /** Английское название — вторая строка; пусто, и строки не будет */
    nameEn?: string;
    /** Пометка справа у значения справочника: категория, приём */
    badge?: string;
    /** Ключ источника-книги у записи компендиума */
    sourceKey?: string;
    /** Определение источника, вписанное вместе с записью */
    source?: SourceDefinition;
    /** Отмечена ли строка */
    selected: boolean;
    /**
     * Запись отметить нельзя: класс, который у персонажа уже есть, из окна
     * выбора не берут. Строка гаснет и перестаёт нажиматься.
     */
    disabled?: boolean;
  }>();

  const emit = defineEmits<{ toggle: [] }>();

  /** Оформление строки: недоступная гаснет и не отзывается на наведение. */
  const rowStateClass = computed(() =>
    props.disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-primary/10',
  );

  /**
   * Переключает отметку. Недоступную строку нажимать нечем, но событие
   * проверяется и здесь: `disabled` у кнопки снимают стили и скринридеры.
   */
  function toggle(): void {
    if (props.disabled) {
      return;
    }

    emit('toggle');
  }
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-2 py-2 text-left transition-colors"
    :class="rowStateClass"
    :disabled="disabled"
    @click.left.exact.prevent="toggle"
  >
    <!-- Отметку ставит вся строка: попадать в саму галочку неудобно, а два
      обработчика на строку дали бы двойное переключение -->
    <UCheckbox
      :model-value="selected"
      :disabled="disabled"
      class="pointer-events-none shrink-0"
    />

    <EntityRowBody
      :name="name"
      :name-en="nameEn"
      :source-key="sourceKey"
      :source="source"
    >
      <template #badges>
        <UBadge
          v-if="badge"
          color="neutral"
          variant="subtle"
          size="sm"
          class="shrink-0"
        >
          {{ badge }}
        </UBadge>
      </template>
    </EntityRowBody>
  </button>
</template>
