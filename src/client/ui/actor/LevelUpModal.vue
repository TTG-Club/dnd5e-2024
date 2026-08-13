<script setup lang="ts">
  import type { ActorClassEntry } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    calculateExperienceForNextLevel,
    getTotalLevel,
    MAX_LEVEL,
  } from '@vtt/shared/system/dnd.js';

  import { LEVEL_UP_LABELS, MODAL_BUTTON_LABELS } from './constants';

  interface Props {
    open: boolean;
    classes: ActorClassEntry[];
    experience: number;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [data: { classes: ActorClassEntry[]; experience: number }];
    'start-wizard': [
      data: {
        queue: Array<{ classKey: string; targetLevel: number }>;
        experience: number;
        forceApplies: ActorClassEntry[];
      },
    ];
    'remove-class': [classKey: string];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const editClasses = ref<ActorClassEntry[]>([]);

  /**
   * Введённый опыт. Тип не только `number`: `UInput` с `type="number"` отдаёт
   * пустую строку, когда поле очищено или в нём мусор, — `applyLevelUp`
   * приводит такое значение к 0.
   */
  const editExperience = ref<number | string>(0);

  const forceLevelUp = ref(false);

  /** Ключ класса, ожидающего подтверждения удаления */
  const pendingRemoveKey = ref<string | null>(null);

  /** Суммарный уровень по всем классам в форме */
  const editTotalLevel = computed(() => {
    return getTotalLevel(editClasses.value);
  });

  /** Опыт, нужный для следующего уровня при текущем наборе классов */
  const editNextLevelXP = computed(() => {
    return calculateExperienceForNextLevel(editTotalLevel.value);
  });

  // При открытии — подставляем текущие значения
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        editClasses.value = JSON.parse(JSON.stringify(props.classes ?? []));
        editExperience.value = props.experience;
        forceLevelUp.value = false;
        pendingRemoveKey.value = null;
      }
    },
  );

  /** Повышает уровень класса, пока суммарный не упёрся в потолок (20) */
  function incrementClassLevel(index: number) {
    if (editTotalLevel.value < MAX_LEVEL) {
      editClasses.value[index].level += 1;
    }
  }

  /** Понижает уровень класса, но не ниже первого */
  function decrementClassLevel(index: number) {
    if (editClasses.value[index].level > 1) {
      editClasses.value[index].level -= 1;
    }
  }

  /**
   * Запрашивает подтверждение удаления класса
   */
  function requestRemoveClass(classKey: string) {
    pendingRemoveKey.value = classKey;
  }

  /**
   * Отменяет запрос на удаление класса
   */
  function cancelRemove() {
    pendingRemoveKey.value = null;
  }

  /**
   * Подтверждает удаление класса у актёра и всех связанных данных
   */
  function confirmRemoveClass() {
    if (!pendingRemoveKey.value) {
      return;
    }

    emit('remove-class', pendingRemoveKey.value);
    pendingRemoveKey.value = null;
    isOpen.value = false;
  }

  /**
   * Применяет изменения уровня и опыта
   */
  function applyLevelUp() {
    const xp =
      typeof editExperience.value === 'string'
        ? Number.parseInt(editExperience.value, 10)
        : editExperience.value;

    const safeXp = Number.isNaN(xp) ? 0 : Math.max(0, xp);

    if (forceLevelUp.value) {
      emit('apply', {
        classes: JSON.parse(JSON.stringify(editClasses.value)),
        experience: safeXp,
      });
    } else {
      // Собираем очередь уровней "пройти через мастер"
      const queue: Array<{ classKey: string; targetLevel: number }> = [];

      for (const editedClass of editClasses.value) {
        const originalClass = props.classes.find(
          (classEntry) => classEntry.classKey === editedClass.classKey,
        );

        const originalLevel = originalClass ? originalClass.level : 0;

        // Добавляем по одному таску на каждый полученный уровень
        if (editedClass.level > originalLevel) {
          for (
            let level = originalLevel + 1;
            level <= editedClass.level;
            level++
          ) {
            queue.push({
              classKey: editedClass.classKey,
              targetLevel: level,
            });
          }
        }
      }

      if (queue.length > 0) {
        // Мы НЕ передаём новые `classes` напрямую (они добавятся через мастер),
        // но надо отдать старые + всё остальное, что нужно. Мастер будет сам апдейтить актора.
        emit('start-wizard', {
          queue,
          experience: safeXp,
          forceApplies: props.classes, // Если есть, вернем исходные, а опыт обновится
        });
      } else {
        // Если уровни не менялись или только уменьшались - просто применяем как форс
        emit('apply', {
          classes: JSON.parse(JSON.stringify(editClasses.value)),
          experience: safeXp,
        });
      }
    }

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="360"
    :min-height="200"
    :title="LEVEL_UP_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-5">
        <!-- Классы -->
        <div
          v-if="editClasses.length > 0"
          class="space-y-3"
        >
          <div
            v-for="(classEntry, index) in editClasses"
            :key="classEntry.classKey"
            class="space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-highlighted">{{
                classEntry.className || LEVEL_UP_LABELS.classLabel
              }}</span>

              <div class="flex items-center gap-3">
                <UButton
                  icon="tabler:minus"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  :disabled="classEntry.level <= 1"
                  @click.left.exact.prevent="decrementClassLevel(index)"
                />

                <span
                  class="w-8 text-center text-xl font-bold text-highlighted tabular-nums"
                  >{{ classEntry.level }}</span
                >

                <UButton
                  icon="tabler:plus"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  :disabled="
                    editTotalLevel >= MAX_LEVEL || classEntry.level >= MAX_LEVEL
                  "
                  @click.left.exact.prevent="incrementClassLevel(index)"
                />

                <UButton
                  icon="tabler:trash"
                  variant="ghost"
                  color="error"
                  size="xs"
                  :title="LEVEL_UP_LABELS.removeClass"
                  @click.left.exact.prevent="
                    requestRemoveClass(classEntry.classKey)
                  "
                />
              </div>
            </div>

            <!-- Инлайн-подтверждение удаления -->
            <div
              v-if="pendingRemoveKey === classEntry.classKey"
              class="flex items-center justify-between rounded-md bg-danger-subtle/30 px-3 py-1.5"
            >
              <span class="text-xs text-danger">
                {{ LEVEL_UP_LABELS.removeClassHint }}
              </span>

              <div class="flex items-center gap-3">
                <button
                  class="text-xs text-muted transition-colors hover:text-highlighted"
                  @click.left.exact.prevent="cancelRemove"
                >
                  {{ MODAL_BUTTON_LABELS.cancel }}
                </button>

                <button
                  class="text-xs font-medium text-danger transition-colors hover:text-danger-muted"
                  @click.left.exact.prevent="confirmRemoveClass"
                >
                  {{ MODAL_BUTTON_LABELS.remove }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else
          class="py-2 text-center text-sm text-muted italic"
        >
          {{ LEVEL_UP_LABELS.empty }}
        </div>

        <div class="h-px w-full bg-elevated" />

        <!-- Опыт -->
        <div class="space-y-4">
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">{{
                LEVEL_UP_LABELS.experience
              }}</span>

              <span class="text-xs text-dimmed">
                {{ LEVEL_UP_LABELS.nextLevelXpPrefix }} {{ editNextLevelXP }}
                {{ LEVEL_UP_LABELS.experienceUnit }}
              </span>
            </div>

            <!-- Enter в поле опыта = «Применить»: правка опыта чаще всего
                 сводится к вводу числа, лишний клик по кнопке не нужен -->
            <UInput
              v-model="editExperience"
              type="number"
              variant="none"
              :min="0"
              size="lg"
              class="w-full"
              :ui="{
                base: 'bg-inverted/5 text-highlighted rounded-lg px-3 py-2 focus:bg-inverted/10 transition-colors tabular-nums',
              }"
              @keydown.enter.prevent="applyLevelUp"
            />
          </div>

          <div class="flex items-center gap-2">
            <UCheckbox
              id="force-levelup-checkbox"
              v-model="forceLevelUp"
            />

            <label
              for="force-levelup-checkbox"
              class="cursor-pointer text-sm leading-none text-muted select-none"
            >
              {{ LEVEL_UP_LABELS.forceLevelUp }}
            </label>
          </div>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applyLevelUp"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
