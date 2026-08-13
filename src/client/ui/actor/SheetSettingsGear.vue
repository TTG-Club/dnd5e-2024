<script setup lang="ts">
  /**
   * Шестерёнка настройки блока листа — одна на все блоки.
   *
   * Стоит в подписи рамки блока (слот `actions` у `FieldsetLabel`) либо в
   * заголовке раздела и ведёт в окно настройки этого блока. Значок общий
   * намеренно: свой размер и цвет в каждом блоке читались бы как разные кнопки,
   * хотя действие у них одно.
   *
   * Показывать значок вне режима правки не нужно — настраивать там нечего;
   * решает это сам блок, а не значок.
   */
  interface Props {
    /** Что настраивает значок: подсказка по наведению и подпись для скринридера */
    label: string;
  }

  defineProps<Props>();

  const emit = defineEmits<{
    /** Значок нажат: блок открывает своё окно настройки */
    open: [];
  }>();

  /** Мышь и клавиатура ведут в одно и то же окно */
  function handleOpen(): void {
    emit('open');
  }
</script>

<template>
  <UTooltip
    :text="label"
    :delay-duration="300"
  >
    <!-- Клик не всплывает: у блока под значком свой обработчик (бросок,
      окно хитов), и он не должен срабатывать заодно с настройкой -->
    <UIcon
      name="tabler:settings-filled"
      class="h-3.5 w-3.5 shrink-0 cursor-pointer text-primary transition-colors hover:text-primary/80"
      role="button"
      tabindex="0"
      :aria-label="label"
      @click.left.exact.prevent.stop="handleOpen"
      @keydown.enter.prevent="handleOpen"
      @keydown.space.prevent="handleOpen"
    />
  </UTooltip>
</template>
