<script setup lang="ts">
  import { useSlots } from 'vue';

  import { FORM_TAB_LABELS, WINDOW_TAB_CONTENT_CLASS } from './constants';

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
  const slots = useSlots();

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
      content: WINDOW_TAB_CONTENT_CLASS,
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
