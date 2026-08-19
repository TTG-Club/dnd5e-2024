<script setup lang="ts">
  import { computed, useSlots } from 'vue';

  import { FORM_TAB_LABELS } from './constants';

  /** Пункт списка вкладок: подпись и имя слота с содержимым */
  interface TabItem {
    label: string;
    slot: string;
  }

  /**
   * Переиспользуемый таб-контейнер для модалок ПРОСМОТРА предметов.
   * Вкладки «Основное» и «Эффекты» — всегда; «Бой» — опциональна и
   * показывается только если передан слот `combat`. Каждая модалка наполняет
   * одноимённые слоты своим содержимым.
   */
  const props = withDefaults(
    defineProps<{
      /**
       * Меняет ли размер модалка-носитель. У карточек он фиксирован, поэтому
       * по умолчанию высота содержимого вкладки ограничена потолком и длинный
       * текст прокручивается внутри неё. У растягиваемой модалки такой потолок
       * обрезал бы содержимое на середине окна — там прокрутка остаётся, а
       * потолок снимается.
       */
      resizableModal?: boolean;
    }>(),
    { resizableModal: false },
  );

  const slots = useSlots();

  /** Классы содержимого вкладки: потолок высоты — только у фиксированных окон */
  const contentClass = computed(() =>
    props.resizableModal ? 'overflow-y-auto' : 'overflow-y-auto max-h-150',
  );

  /**
   * Список вкладок. Намеренно функция, а не `computed`: набор слотов Vue не
   * реактивен, и закешированный список не заметил бы, что слот `combat`
   * появился или исчез у уже открытой карточки — вкладка «Бой» тогда не
   * пришла бы и не ушла. Список пересобирается на каждую отрисовку, как и
   * проверка `slots.combat` в самом шаблоне.
   *
   * @returns вкладки в порядке показа
   */
  function buildTabItems(): TabItem[] {
    const items: TabItem[] = [{ label: FORM_TAB_LABELS.main, slot: 'general' }];

    if (slots.combat) {
      items.push({ label: FORM_TAB_LABELS.combat, slot: 'combat' });
    }

    items.push({ label: FORM_TAB_LABELS.effects, slot: 'effects' });

    return items;
  }
</script>

<template>
  <UTabs
    :items="buildTabItems()"
    variant="pill"
    class="flex flex-col"
    :ui="{
      list: 'mb-3',
      trigger: 'flex-1 justify-center',
      content: contentClass,
    }"
  >
    <template #general>
      <slot name="general" />
    </template>

    <template
      v-if="slots.combat"
      #combat
    >
      <slot name="combat" />
    </template>

    <template #effects>
      <slot name="effects" />
    </template>
  </UTabs>
</template>
