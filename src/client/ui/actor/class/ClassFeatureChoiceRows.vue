<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableClassFeatureChoice } from './classEditorTypes';

  import { watch } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';

  import { useExpandedRows } from '../../../composables/useExpandedRows';
  import {
    CLASS_FEATURE_CHOICE_LABELS,
    CLASS_LEVEL_MAX,
    CLASS_OPTION_MECHANICS_TITLES,
  } from '../constants';
  import EditorNestedSection from '../EditorNestedSection.vue';
  import FieldHint from '../FieldHint.vue';
  import { countFilledMechanicsBlocks } from './classEditorTypes';
  import ClassMechanicsFields from './ClassMechanicsFields.vue';

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

  const props = withDefaults(
    defineProps<{
      /** Заклинания компендиума по пакам — для подсказок связывания. */
      availableSpells?: SpellOption[];
      /** Сокет для окна выбора заклинания из компендиума. */
      socket?: TypedWebSocketClient | null;
    }>(),
    { availableSpells: () => [], socket: null },
  );

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  const { isExpanded, expand, toggle, drop } = useExpandedRows();

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }

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
   * Оформление шапки варианта: у раскрытого она прилипает к верху окна, под
   * шапкой своего умения. Правя механику варианта на несколько экранов вглубь,
   * видно и чьё это умение, и какой вариант. Прилипает только раскрытая: списку
   * из двух десятков свёрнутых манёвров это лишь мешало бы.
   *
   * @param uid - ключ строки варианта
   */
  function headerClass(uid: string): string {
    return isExpanded(uid)
      ? 'sticky top-11 z-10 rounded-t-md border-b border-default bg-elevated'
      : '';
  }

  /**
   * Сколько блоков механики заполнено у варианта — бейдж свёрнутой строки.
   * Списки вариантов длинные, и без пометки автор не видит, у какого манёвра
   * что настроено.
   *
   * @param choice - вариант строки
   */
  function mechanicsCount(choice: EditableClassFeatureChoice): number {
    return countFilledMechanicsBlocks(choice);
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
      v-for="(choice, choiceIndex) in choices"
      :key="choice.uid"
      class="rounded-md border border-default bg-elevated/30"
    >
      <!-- Нажимается вся шапка целиком: попадать в стрелку незачем, промахи
        мимо неё раньше просто ничего не делали -->
      <div
        class="flex min-h-10 cursor-pointer items-center gap-2 p-2 transition-colors hover:bg-elevated/50"
        :class="headerClass(choice.uid)"
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

        <UBadge
          v-if="mechanicsCount(choice)"
          size="sm"
          color="primary"
          variant="subtle"
          class="shrink-0 tabular-nums"
        >
          {{ CLASS_FEATURE_CHOICE_LABELS.mechanicsBadge
          }}{{ mechanicsCount(choice) }}
        </UBadge>

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

        <!-- Механика варианта той же формой, что у умения: воззвание выдаёт
          заклинание, манёвр — владение приёмом, и лист применяет их одинаково,
          откуда бы они ни пришли -->
        <EditorNestedSection
          :title="CLASS_FEATURE_CHOICE_LABELS.mechanicsTitle"
          :hint="CLASS_FEATURE_CHOICE_LABELS.mechanicsHint"
          :count="mechanicsCount(choice)"
        >
          <ClassMechanicsFields
            v-model:grants="choice.grants"
            v-model:active-effects="choice.activeEffects"
            :titles="CLASS_OPTION_MECHANICS_TITLES"
            :effects-modal-id="`class-option-effect-form-modal-${choice.uid}`"
            :available-spells="props.availableSpells"
            :socket="props.socket"
            @open-spell="forwardOpenSpell"
          />
        </EditorNestedSection>
      </div>
    </div>
  </div>
</template>
