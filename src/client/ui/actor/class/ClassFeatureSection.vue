<script setup lang="ts">
  import { computed, ref } from 'vue';

  import { CLASS_FEATURE_SECTION_LABELS } from '../constants';
  import FieldHint from '../FieldHint.vue';

  /**
   * Свёрнутый блок внутри умения класса: рост по уровням, варианты, механика.
   *
   * У большинства умений эти блоки пусты, а развёрнутые все разом они заслоняли
   * бы список умений, — поэтому блок свёрнут, а в шапке видно, сколько в нём
   * записей: без пометки автор не знает, какие блоки заполнены, и раскрывает их
   * по одному.
   *
   * Кнопка добавления живёт в шапке: пустому блоку хватает одной строки вместо
   * подписи «записей нет» и кнопки во всю ширину.
   */
  const props = withDefaults(
    defineProps<{
      title: string;
      /** Пояснение к блоку по наведению на ⓘ в шапке. */
      hint?: string;
      /** Сколько записей в блоке; ноль — бейджа нет. */
      count?: number;
      /** Подпись кнопки добавления в шапке; пусто — кнопки нет. */
      addLabel?: string;
    }>(),
    {
      hint: undefined,
      count: 0,
      addLabel: undefined,
    },
  );

  const emit = defineEmits<{ add: [] }>();

  const isOpen = ref(false);

  /** Значок свёртки: показывает, куда уедет содержимое блока. */
  const toggleIcon = computed(() =>
    isOpen.value ? 'tabler:chevron-up' : 'tabler:chevron-down',
  );

  /** Подпись шапки для скринридера. */
  const toggleLabel = computed(() =>
    isOpen.value
      ? CLASS_FEATURE_SECTION_LABELS.collapse
      : CLASS_FEATURE_SECTION_LABELS.expand,
  );

  /** Разворачивает или сворачивает блок. */
  function toggle(): void {
    isOpen.value = !isOpen.value;
  }

  /** Добавление раскрывает блок: иначе новая запись легла бы в свёрнутый. */
  function add(): void {
    isOpen.value = true;

    emit('add');
  }
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-default bg-elevated/20">
    <!-- Нажимается вся шапка целиком: попадать значком в конце строки
      приходилось бы прицельно. Кнопки внутри неё гасят всплытие — иначе
      добавление тут же свернуло бы блок обратно -->
    <div
      class="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-elevated/50"
      role="button"
      tabindex="0"
      :aria-expanded="isOpen"
      :aria-label="toggleLabel"
      @click.left.exact.prevent="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <span
        class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted"
      >
        {{ props.title }}
      </span>

      <UBadge
        v-if="props.count"
        size="sm"
        color="primary"
        variant="subtle"
        class="shrink-0 tabular-nums"
      >
        {{ props.count }}
      </UBadge>

      <FieldHint
        v-if="props.hint"
        :text="props.hint"
      />

      <UButton
        v-if="props.addLabel"
        icon="tabler:plus"
        :label="props.addLabel"
        color="primary"
        variant="soft"
        size="xs"
        class="shrink-0"
        @click.left.exact.prevent.stop="add"
      />

      <UButton
        :icon="toggleIcon"
        color="neutral"
        variant="ghost"
        size="xs"
        class="shrink-0"
        :aria-label="toggleLabel"
        @click.left.exact.prevent.stop="toggle"
      />
    </div>

    <div
      v-if="isOpen"
      class="border-t border-default/50 p-3"
    >
      <slot />
    </div>
  </div>
</template>
