<script setup lang="ts">
  import type {
    ClassFeatureChoice,
    ClassFeatureChoiceConfig,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { formatChoiceCountRange } from '@vtt/shared/system/dnd.js';

  import {
    CLASS_DETAIL_LABELS,
    CLASS_FEATURE_CHOICE_LABELS,
  } from '../constants';
  import EditorNestedSection from '../EditorNestedSection.vue';

  /**
   * Варианты умения в карточке класса: манёвры, воззвания, боевые стили.
   *
   * Блок свёрнут: списки длинные — у колдуна два десятка воззваний, — и
   * развёрнутыми они закрыли бы собой весь класс. В шапке видно, сколько
   * вариантов у умения и сколько из них берут.
   *
   * У подкласса часть вариантов не показывается: так помечает их сам класс
   * («скрывать в подклассе»), чтобы не повторять на странице подкласса то, что
   * уже сказано у класса.
   */
  const props = defineProps<{
    /** Варианты умения из записи класса */
    choices: ClassFeatureChoice[];
    /** Настройка выбора; нет — список справочный */
    config?: ClassFeatureChoiceConfig;
    /** Умение показывается в подклассе */
    isSubclass?: boolean;
  }>();

  /** Варианты, которые видно в этом месте карточки. */
  const visibleChoices = computed(() =>
    props.isSubclass
      ? props.choices.filter((choice) => !choice.hideInSubclasses)
      : props.choices,
  );

  /** Заголовок блока: своя подпись выбора, иначе общее «Варианты». */
  const title = computed(
    () => props.config?.label || CLASS_DETAIL_LABELS.choicesTitle,
  );

  /**
   * Сколько вариантов берут: «Выбирают: 1–10». У справочного списка выбирать
   * нечего — строки нет.
   */
  const countLabel = computed(() => {
    const config = props.config;

    if (!config) {
      return undefined;
    }

    const range = formatChoiceCountRange(
      config.count,
      Object.values(config.progression ?? {}),
    );

    return `${CLASS_DETAIL_LABELS.choiceCountPrefix}${range}`;
  });

  /**
   * Бейдж уровня доступа варианта: «С 5 уровня».
   *
   * @param choice - вариант списка
   */
  function levelBadge(choice: ClassFeatureChoice): string {
    return (
      CLASS_FEATURE_CHOICE_LABELS.levelBadgePrefix
      + choice.requiredLevel
      + CLASS_FEATURE_CHOICE_LABELS.levelBadgeSuffix
    );
  }
</script>

<template>
  <EditorNestedSection
    v-if="visibleChoices.length > 0"
    :title="title"
    :count="visibleChoices.length"
    class="mt-2"
  >
    <div class="flex flex-col gap-2">
      <span
        v-if="countLabel"
        class="text-xs text-dimmed"
      >
        {{ countLabel }}
      </span>

      <div
        v-for="choice in visibleChoices"
        :key="choice.key"
        class="rounded-md bg-default/40 p-2"
      >
        <div class="flex flex-wrap items-baseline gap-x-2">
          <span class="text-sm font-medium text-highlighted">
            {{ choice.name }}
          </span>

          <span
            v-if="choice.additional"
            class="text-xs text-dimmed"
            >{{ choice.additional }}</span
          >

          <UBadge
            v-if="choice.requiredLevel"
            size="sm"
            color="neutral"
            variant="outline"
            class="tabular-nums"
          >
            {{ levelBadge(choice) }}
          </UBadge>

          <UBadge
            v-if="choice.repeatable"
            size="sm"
            color="info"
            variant="subtle"
          >
            {{ CLASS_FEATURE_CHOICE_LABELS.repeatableBadge }}
          </UBadge>
        </div>

        <span
          v-if="choice.prerequisite"
          class="mt-0.5 block text-xs text-warning"
          >{{ CLASS_DETAIL_LABELS.choicePrerequisitePrefix
          }}{{ choice.prerequisite }}</span
        >

        <ItemDescriptionRenderer
          :content="choice.description"
          class="mt-0.5 text-sm text-muted"
        />
      </div>
    </div>
  </EditorNestedSection>
</template>
