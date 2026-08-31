<script setup lang="ts">
  import type { EditableClassFeatureChoice } from './classEditorTypes';

  import { watch } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';

  import { useExpandedRows } from '../../../composables/useExpandedRows';
  import {
    CLASS_FEATURE_CHOICE_LABELS,
    CLASS_FEATURE_LABELS,
    CLASS_LEVEL_MAX,
  } from '../constants';
  import FieldHint from '../FieldHint.vue';

  /**
   * Варианты умения строками: манёвры, воззвания, боевые стили.
   *
   * Строка свёрнута до названия: списки вариантов длинные — у мастера боевых
   * искусств два десятка манёвров, — и развёрнутые все разом они заслоняют само
   * умение. В шапке остаётся то, что важно, не разворачивая: с какого уровня
   * вариант берут, повторяемый ли он и скрыт ли в подклассе.
   *
   * Кнопка добавления живёт в шапке блока, а не здесь: пустому блоку хватает
   * одной строки заголовка.
   */
  const choices = defineModel<EditableClassFeatureChoice[]>({ required: true });

  const { isExpanded, expand, toggle, drop } = useExpandedRows();

  /**
   * Добавленный вариант раскрывается сам: заводят его пустым, и свёрнутая
   * строка «Без названия» ничего не даёт заполнить. Кнопка добавления живёт в
   * шапке блока, поэтому строка узнаёт о новом варианте только по списку —
   * добавляют его всегда в конец.
   */
  watch(
    () => choices.value.length,
    (length, previousLength) => {
      if (length <= previousLength) {
        return;
      }

      for (const added of choices.value.slice(previousLength)) {
        expand(added.uid);
      }
    },
  );

  /**
   * Значок свёртки: показывает, куда уедет содержимое строки.
   *
   * @param uid - ключ строки варианта
   */
  function toggleIcon(uid: string): string {
    return isExpanded(uid) ? 'tabler:chevron-down' : 'tabler:chevron-right';
  }

  /**
   * Подпись шапки для скринридера: по нажатию строка раскрывается и
   * сворачивается, и текст должен говорить, что случится дальше.
   *
   * @param uid - ключ строки варианта
   */
  function toggleLabel(uid: string): string {
    return isExpanded(uid)
      ? CLASS_FEATURE_CHOICE_LABELS.collapse
      : CLASS_FEATURE_CHOICE_LABELS.expand;
  }

  /**
   * Бейдж уровня доступа: «С 5 уровня». Не «5 ур.», как у умения: там уровень
   * получения, а здесь — с какого уровня вариант вообще можно взять.
   *
   * @param choice - вариант строки
   */
  function levelBadge(choice: EditableClassFeatureChoice): string {
    return (
      CLASS_FEATURE_CHOICE_LABELS.levelBadgePrefix
      + choice.requiredLevel
      + CLASS_FEATURE_CHOICE_LABELS.levelBadgeSuffix
    );
  }

  /**
   * Убирает вариант.
   *
   * @param index - позиция варианта в списке
   */
  function removeChoice(index: number): void {
    const [removed] = choices.value.splice(index, 1);

    if (removed) {
      drop(removed.uid);
    }
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-if="choices.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ CLASS_FEATURE_LABELS.choicesEmpty }}
    </div>

    <div
      v-for="(choice, choiceIndex) in choices"
      :key="choice.uid"
      class="rounded-md border border-default bg-elevated/30"
    >
      <!-- Нажимается вся шапка целиком: попадать в стрелку незачем, промахи
        мимо неё раньше просто ничего не делали -->
      <div
        class="flex min-h-10 cursor-pointer items-center gap-2 p-2 transition-colors hover:bg-elevated/50"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded(choice.uid)"
        :aria-label="toggleLabel(choice.uid)"
        @click.left.exact.prevent="toggle(choice.uid)"
        @keydown.enter.prevent="toggle(choice.uid)"
        @keydown.space.prevent="toggle(choice.uid)"
      >
        <UIcon
          :name="toggleIcon(choice.uid)"
          class="size-4 shrink-0 text-muted"
        />

        <UBadge
          v-if="choice.requiredLevel"
          size="sm"
          color="neutral"
          variant="outline"
          class="shrink-0 tabular-nums"
        >
          {{ levelBadge(choice) }}
        </UBadge>

        <span class="min-w-0 flex-1 truncate text-sm text-highlighted">
          {{ choice.name || CLASS_FEATURE_CHOICE_LABELS.unnamed }}
        </span>

        <!-- Бейджи прячутся на узком окне: там их место нужнее названию -->
        <UBadge
          v-if="choice.repeatable"
          size="sm"
          color="info"
          variant="subtle"
          class="hidden shrink-0 md:inline-flex"
        >
          {{ CLASS_FEATURE_CHOICE_LABELS.repeatableBadge }}
        </UBadge>

        <UBadge
          v-if="choice.hideInSubclasses"
          size="sm"
          color="warning"
          variant="subtle"
          class="hidden shrink-0 md:inline-flex"
        >
          {{ CLASS_FEATURE_CHOICE_LABELS.hiddenBadge }}
        </UBadge>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="CLASS_FEATURE_CHOICE_LABELS.remove"
          @click.left.exact.prevent.stop="removeChoice(choiceIndex)"
        />
      </div>

      <div
        v-if="isExpanded(choice.uid)"
        class="flex flex-col gap-2 border-t border-default/50 p-2"
      >
        <div class="flex flex-wrap items-end gap-2">
          <UFormField
            :label="CLASS_FEATURE_CHOICE_LABELS.name"
            class="min-w-48 flex-1"
          >
            <UInput
              v-model="choice.name"
              :placeholder="CLASS_FEATURE_CHOICE_LABELS.namePlaceholder"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="CLASS_FEATURE_CHOICE_LABELS.nameEn"
            class="min-w-48 flex-1"
          >
            <UInput
              v-model="choice.nameEn"
              :placeholder="CLASS_FEATURE_CHOICE_LABELS.nameEnPlaceholder"
              class="w-full"
            />
          </UFormField>

          <UFormField class="w-27.5">
            <template #label>
              <span class="flex items-center gap-1">
                {{ CLASS_FEATURE_CHOICE_LABELS.level }}

                <FieldHint :text="CLASS_FEATURE_CHOICE_LABELS.levelHint" />
              </span>
            </template>

            <UInputNumber
              v-model="choice.requiredLevel"
              :min="1"
              :max="CLASS_LEVEL_MAX"
              :placeholder="CLASS_FEATURE_CHOICE_LABELS.levelPlaceholder"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Галочки своим рядом: в колонке рядом с названиями их подписи
          переносились по слогам, а вместе они читаются одним списком -->
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div class="flex items-center gap-1">
            <UCheckbox
              v-model="choice.repeatable"
              :label="CLASS_FEATURE_CHOICE_LABELS.repeatable"
            />

            <FieldHint :text="CLASS_FEATURE_CHOICE_LABELS.repeatableHint" />
          </div>

          <div class="flex items-center gap-1">
            <UCheckbox
              v-model="choice.hideInSubclasses"
              :label="CLASS_FEATURE_CHOICE_LABELS.hideInSubclasses"
            />

            <FieldHint
              :text="CLASS_FEATURE_CHOICE_LABELS.hideInSubclassesHint"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <UFormField
            :label="CLASS_FEATURE_CHOICE_LABELS.additional"
            class="min-w-48 flex-1"
          >
            <UInput
              v-model="choice.additional"
              :placeholder="CLASS_FEATURE_CHOICE_LABELS.additionalPlaceholder"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="CLASS_FEATURE_CHOICE_LABELS.prerequisite"
            class="min-w-48 flex-1"
          >
            <UInput
              v-model="choice.prerequisite"
              :placeholder="CLASS_FEATURE_CHOICE_LABELS.prerequisitePlaceholder"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField :label="CLASS_FEATURE_CHOICE_LABELS.description">
          <RichTextEditor v-model="choice.description" />
        </UFormField>
      </div>
    </div>
  </div>
</template>
