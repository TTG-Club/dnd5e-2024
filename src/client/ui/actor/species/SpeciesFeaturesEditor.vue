<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableFeature } from './speciesEditorTypes';

  import { generateId } from '@vtt/shared';

  import { useExpandedRows } from '../../../composables/useExpandedRows';
  import {
    LEVEL_BADGE_SUFFIX,
    SPECIES_FEATURES_EDITOR_LABELS,
    SPECIES_FORM_DEFAULT_NAMES,
    SPECIES_FORM_LABELS,
  } from '../constants';
  import { createEmptyFeatGrants } from '../feat/featEditorTypes';
  import { createEmptyMovement } from './speciesEditorTypes';
  import SpeciesFeatureFields from './SpeciesFeatureFields.vue';

  /**
   * Список особенностей вида: плоские сворачиваемые строки с редактированием на
   * месте — по образцу редактора умений класса, вместо прежнего дерева со
   * вторым модальным окном.
   *
   * Встроенные легаси-варианты (`choices`) не редактируются: строка помечается
   * бейджем, а данные сохраняются как есть. Новый подвид — отдельная запись
   * вида с указанием основного вида.
   */
  defineProps<{
    /** Заклинания компендиума по пакам — для подсказок связывания. */
    availableSpells?: SpellOption[];
    /**
     * Сокет для окна выбора заклинания из компендиума. Без него добавить
     * заклинание нечем: другого способа завести запись у редактора нет.
     */
    socket?: TypedWebSocketClient | null;
  }>();

  /** Список особенностей вида. */
  const features = defineModel<EditableFeature[]>({ required: true });

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  const { isExpanded, expand, toggle, drop } = useExpandedRows();

  /**
   * Добавляет особенность и сразу раскрывает её редактор. Наружу — кнопка
   * добавления живёт в шапке раздела.
   */
  function addFeature(): void {
    const feature: EditableFeature = {
      key: generateId('sf'),
      name: SPECIES_FORM_DEFAULT_NAMES.feature,
      description: '',
      level: 1,
      isInformationalOnly: false,
      movement: createEmptyMovement(),
      darkvision: 0,
      grantedSpells: [],
      activeEffects: [],
      grants: createEmptyFeatGrants(),
      choices: [],
    };

    features.value.push(feature);
    expand(feature.key);
  }

  /** Удаляет особенность по индексу. */
  function removeFeature(index: number): void {
    const [removed] = features.value.splice(index, 1);

    if (removed) {
      drop(removed.key);
    }
  }

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }

  defineExpose({ addFeature });
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(feature, featureIndex) in features"
      :key="feature.key"
      class="rounded-lg border border-default bg-elevated/20"
    >
      <div class="flex items-center gap-2 p-2">
        <UButton
          :icon="
            isExpanded(feature.key)
              ? 'tabler:chevron-down'
              : 'tabler:chevron-right'
          "
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="
            isExpanded(feature.key)
              ? SPECIES_FEATURES_EDITOR_LABELS.collapse
              : SPECIES_FEATURES_EDITOR_LABELS.expand
          "
          @click.left.exact.prevent="toggle(feature.key)"
        />

        <button
          class="min-w-0 flex-1 truncate text-left text-sm font-medium text-highlighted"
          @click.left.exact.prevent="toggle(feature.key)"
        >
          {{ feature.name || SPECIES_FEATURES_EDITOR_LABELS.fallbackName }}
        </button>

        <UTooltip
          v-if="feature.choices.length > 0"
          :text="SPECIES_FORM_LABELS.legacyChoicesHint"
        >
          <UBadge
            color="warning"
            variant="subtle"
            size="sm"
          >
            {{ SPECIES_FORM_LABELS.legacyChoicesBadgePrefix
            }}{{ feature.choices.length }}
          </UBadge>
        </UTooltip>

        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
        >
          {{ feature.level }}{{ LEVEL_BADGE_SUFFIX }}
        </UBadge>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="SPECIES_FEATURES_EDITOR_LABELS.remove"
          @click.left.exact.prevent="removeFeature(featureIndex)"
        />
      </div>

      <div
        v-if="isExpanded(feature.key)"
        class="border-t border-default/50 p-3"
      >
        <SpeciesFeatureFields
          v-model="features[featureIndex]"
          :available-spells="availableSpells"
          :socket="socket"
          @open-spell="forwardOpenSpell"
        />
      </div>
    </div>
  </div>
</template>
