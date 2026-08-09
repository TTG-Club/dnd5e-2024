<script setup lang="ts">
  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { LANGUAGE_TYPES } from '@vtt/shared/system/dnd.js';

  /** Блокирующий модал — фиксированный z-index поверх остальных */
  const MODAL_Z_INDEX = Z_INDEX.MODAL_ELEVATED;

  interface Props {
    open: boolean;
    /** Текущие владения языками */
    selected: string[];
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [selected: string[]];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Локальная копия владений */
  const localSelected = ref<Set<string>>(new Set());

  /** Поле ввода своего языка */
  const customLanguage = ref('');

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        localSelected.value = new Set(props.selected);
        customLanguage.value = '';
      }
    },
  );

  /** Конфигурация панелей */
  const panels = computed(() => [
    {
      key: 'standard' as const,
      title: 'Стандартные',
      color: 'text-primary',
      items: LANGUAGE_TYPES.slice(0, 8),
    },
    {
      key: 'rare' as const,
      title: 'Редкие',
      color: 'text-primary',
      items: LANGUAGE_TYPES.slice(8, 16),
    },
    {
      key: 'exotic' as const,
      title: 'Экзотические',
      color: 'text-primary',
      items: LANGUAGE_TYPES.slice(16),
    },
  ]);

  /**
   * Переключает владение конкретным языком
   */
  function toggleItem(key: string): void {
    const set = new Set(localSelected.value);

    if (set.has(key)) {
      set.delete(key);
    } else {
      set.add(key);
    }

    localSelected.value = set;
  }

  /**
   * Переключает «Все» в категории
   */
  function toggleAllCategory(category: string): void {
    const panel = panels.value.find((playlist) => playlist.key === category);

    if (!panel) {
      return;
    }

    const allKeys = panel.items;
    const set = new Set(localSelected.value);
    const allSelected = allKeys.every((key) => set.has(key));

    if (allSelected) {
      for (const key of allKeys) {
        set.delete(key);
      }
    } else {
      for (const key of allKeys) {
        set.add(key);
      }
    }

    localSelected.value = set;
  }

  /**
   * Проверяет, выбраны ли все элементы категории
   */
  function isAllCategorySelected(category: string): boolean {
    const panel = panels.value.find((playlist) => playlist.key === category);

    if (!panel || panel.items.length === 0) {
      return false;
    }

    return panel.items.every((item) => localSelected.value.has(item));
  }

  /**
   * Свои языки: всё отмеченное, чего нет в списках. Порядок — тот, в котором их
   * заводили: `Set` держит порядок вставки, и записи не прыгают при правке.
   */
  const customLanguages = computed(() =>
    [...localSelected.value].filter(
      (language) => !LANGUAGE_TYPES.includes(language),
    ),
  );

  /** В поле только пробелы — заводить нечего */
  const canAddCustom = computed(() => customLanguage.value.trim().length > 0);

  /**
   * Заводит язык из поля ввода. Название, совпавшее со списочным языком (с
   * точностью до регистра), не удваивает запись — вместо своего языка встаёт
   * галочка в списке.
   */
  function addCustomLanguage(): void {
    const name = customLanguage.value.trim();

    if (!name) {
      return;
    }

    const sameName = [...LANGUAGE_TYPES, ...localSelected.value].find(
      (language) => language.toLowerCase() === name.toLowerCase(),
    );

    const set = new Set(localSelected.value);

    set.add(sameName ?? name);
    localSelected.value = set;
    customLanguage.value = '';
  }

  /**
   * Убирает свой язык. Списочные языки снимают галочкой, поэтому отдельной
   * кнопки удаления у них нет — а свой язык вне списков снять больше нечем.
   *
   * @param language - название своего языка
   */
  function removeCustomLanguage(language: string): void {
    const set = new Set(localSelected.value);

    set.delete(language);
    localSelected.value = set;
  }

  /**
   * Применяет выбранные владения
   */
  function applySelection(): void {
    emit('apply', [...localSelected.value]);
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="800"
    :min-height="350"
    title="Владение языками"
    :z-index="MODAL_Z_INDEX"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <!-- 3 панели: 3 столбца -->
        <div class="grid grid-cols-3 gap-4">
          <div
            v-for="panel in panels"
            :key="panel.key"
            class="rounded-lg border border-default/50 bg-elevated/30 p-2"
          >
            <div
              class="mb-2 border-b border-default/50 pb-2 text-center text-xs font-bold tracking-wider uppercase"
              :class="panel.color"
            >
              {{ panel.title }}
            </div>

            <!-- Заголовок столбца -->
            <div
              class="mb-1 grid items-center px-1"
              style="grid-template-columns: 1fr 16px; gap: 4px"
            >
              <span />

              <UTooltip text="Владение">
                <UIcon
                  name="tabler:circle-dot"
                  class="mx-auto block h-3.5 w-3.5 text-healing"
                />
              </UTooltip>
            </div>

            <!-- Все категории -->
            <div
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 text-sm font-semibold text-highlighted">
                Все {{ panel.title }}
              </span>

              <UCheckbox
                :model-value="isAllCategorySelected(panel.key)"
                @update:model-value="toggleAllCategory(panel.key)"
              />
            </div>

            <!-- Список -->
            <div
              v-for="item in panel.items"
              :key="item"
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 truncate text-sm text-toned">
                {{ item }}
              </span>

              <UCheckbox
                :model-value="localSelected.has(item)"
                @update:model-value="toggleItem(item)"
              />
            </div>
          </div>
        </div>

        <!-- Свои языки: списками мир не исчерпывается — тайное наречие стола,
          язык из домашнего сеттинга. Заводят их прямо здесь и хранят наравне со
          списочными, поэтому в лист они попадают обычными языками -->
        <div class="rounded-lg border border-default/50 bg-elevated/30 p-2">
          <div
            class="mb-2 border-b border-default/50 pb-2 text-center text-xs font-bold tracking-wider text-primary uppercase"
          >
            Свои языки
          </div>

          <div class="flex items-center gap-2">
            <UInput
              v-model="customLanguage"
              placeholder="Название языка"
              size="sm"
              class="flex-1"
              @keydown.enter.prevent="addCustomLanguage"
            />

            <UButton
              icon="tabler:plus"
              color="primary"
              variant="soft"
              size="sm"
              :disabled="!canAddCustom"
              @click.left.exact.prevent="addCustomLanguage"
            >
              Добавить
            </UButton>
          </div>

          <div
            v-if="customLanguages.length > 0"
            class="mt-2 grid grid-cols-3 gap-x-4"
          >
            <div
              v-for="language in customLanguages"
              :key="language"
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 truncate text-sm text-toned">
                {{ language }}
              </span>

              <UButton
                icon="tabler:trash"
                color="error"
                variant="ghost"
                size="xs"
                :aria-label="`Убрать язык «${language}»`"
                @click.left.exact.prevent="removeCustomLanguage(language)"
              />
            </div>
          </div>

          <div
            v-else
            class="px-1 py-0.5 text-xs text-dimmed italic"
          >
            Своих языков нет
          </div>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            Отмена
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applySelection"
          >
            Применить
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
