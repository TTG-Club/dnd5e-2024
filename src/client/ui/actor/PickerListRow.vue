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
   *
   * В режиме «все компендиумы» к строке добавляется ещё и название пака
   * ({@link packName}): один и тот же класс лежит и в рабочем компендиуме, и в
   * его тестовой копии, а по книге («PHB») они неразличимы.
   */

  import type { SourceDefinition } from '@vtt/shared';

  import type { ListRowExpandLabels } from './ListRowExpandButton.vue';

  import { createReusableTemplate } from '@vueuse/core';
  import { computed } from 'vue';

  import {
    LIST_ROW_DISABLED_CLASS,
    LIST_ROW_LEADING_ACTIVE_CLASS,
    LIST_ROW_LEADING_CLASS,
    LIST_ROW_PACK_NAME_CLASS,
  } from './constants';
  import EntityRowBody from './EntityRowBody.vue';
  import ListRowExpandButton from './ListRowExpandButton.vue';

  // Корней у строки два (с карточкой и без), поэтому классы и атрибуты родителя
  // вешаются на корень явно — сами они на фрагмент не ложатся
  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    /** Название — первая строка */
    name: string;
    /** Английское название — вторая строка; пусто, и строки не будет */
    nameEn?: string;
    /** Пометка справа у значения справочника: категория, приём */
    badge?: string;
    /**
     * Приписка перед пометкой и источником — напр. цена предмета. Колонкой
     * одной ширины: приписки соседних строк стоят друг под другом.
     */
    note?: string;
    /**
     * Компендиум, из которого приехала запись. Показывается только в режиме
     * «все компендиумы» — внутри выбранного пака он и так назван слева.
     */
    packName?: string;
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
    /**
     * Нажатие на строку открывает карточку записи (`open`), а отметку ставит
     * только флажок. Так строка обходится без отдельной кнопки карточки справа.
     * Без пропа отметку ставит вся строка — как в окнах без карточек.
     */
    detailOnClick?: boolean;
    /**
     * Вместо флажка — стрелка раскрытия (`expand`): у вида с подвидами берут
     * подвид, а не сам вид. Действует вместе с {@link detailOnClick} и
     * подписями {@link expandLabels}.
     */
    expandable?: boolean;
    /** Раскрыта ли строка — стрелка смотрит вниз */
    expanded?: boolean;
    /** Подписи стрелки раскрытия; без них стрелки нет */
    expandLabels?: ListRowExpandLabels;
  }>();

  const emit = defineEmits<{ toggle: []; open: []; expand: [] }>();

  /** Тело строки — одно в обоих режимах */
  const [DefineRowBody, ReuseRowBody] = createReusableTemplate();

  /** Оформление строки-кнопки: недоступная гаснет и не отзывается на наведение */
  const rowStateClass = computed(() =>
    props.disabled ? LIST_ROW_DISABLED_CLASS : 'hover:bg-primary/10',
  );

  /**
   * Оформление колонки флажка в строке с карточкой: колонка подсвечивается
   * отдельно от строки — видно, что нажатие на неё отмечает, а не открывает
   * карточку. Флажок недоступной записи гаснет.
   */
  const leadingStateClass = computed(() =>
    props.disabled ? LIST_ROW_DISABLED_CLASS : LIST_ROW_LEADING_ACTIVE_CLASS,
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
  <DefineRowBody>
    <EntityRowBody
      :name="name"
      :name-en="nameEn"
      :source-key="sourceKey"
      :source="source"
    >
      <template #badges>
        <!-- Компендиум записи — перед пометкой и книгой: сначала «откуда
          запись», потом чем она отличается -->
        <span
          v-if="packName"
          :class="LIST_ROW_PACK_NAME_CLASS"
        >
          {{ packName }}
        </span>

        <span
          v-if="note"
          class="w-20 shrink-0 truncate text-right text-xs font-medium text-toned tabular-nums"
        >
          {{ note }}
        </span>

        <UBadge
          v-if="badge"
          color="neutral"
          variant="subtle"
          size="sm"
          class="shrink-0"
        >
          {{ badge }}
        </UBadge>

        <!-- Пометки окна сверх пропов («Уже взят»): внутри строки, чтобы
          подсветка наведения и нажатие шли по всей её ширине -->
        <slot name="badges" />
      </template>
    </EntityRowBody>
  </DefineRowBody>

  <!-- Строка с карточкой: колонка флажка или стрелки — своя кнопка во всю
    высоту строки, остальная строка открывает карточку -->
  <div
    v-if="detailOnClick"
    v-bind="$attrs"
    class="flex w-full items-stretch text-left"
  >
    <ListRowExpandButton
      v-if="expandable && expandLabels"
      :expanded="expanded === true"
      :labels="expandLabels"
      @toggle="emit('expand')"
    />

    <!-- Флажок только показывает отметку: ставит её вся колонка -->
    <button
      v-else
      type="button"
      :class="[LIST_ROW_LEADING_CLASS, leadingStateClass]"
      :disabled="disabled"
      @click.left.exact.prevent="toggle"
    >
      <UCheckbox
        :model-value="selected"
        :disabled="disabled"
        class="pointer-events-none"
      />
    </button>

    <div
      role="button"
      tabindex="0"
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-2 py-2 transition-colors hover:bg-primary/10"
      @click.left.exact.prevent="emit('open')"
      @keydown.enter.prevent="emit('open')"
    >
      <ReuseRowBody />
    </div>
  </div>

  <button
    v-else
    v-bind="$attrs"
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

    <ReuseRowBody />
  </button>
</template>
