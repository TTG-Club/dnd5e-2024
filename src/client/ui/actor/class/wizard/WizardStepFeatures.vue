<script setup lang="ts">
  /**
   * Шаг мастера: Особенности класса.
   *
   * Отображает список особенностей текущего уровня.
   * Для особенностей с вариантами выбора (Fighting Style и т.д.)
   * предоставляет UI выбора.
   */
  import type { DnDActor, SubclassDefinition } from '@vtt/shared/system/dnd.js';

  import type {
    CompendiumFeat,
    WizardFeatPick,
    WizardFeatureItem,
  } from './useClassWizard';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { useSourceLabels } from '@/systems/dnd5e/composables/useSourceLabel';

  import { CLASS_WIZARD_LABELS, LEVEL_BADGE_SUFFIX } from '../../constants';
  import WizardFeatPicker from './WizardFeatPicker.vue';

  const { getSourceLabel } = useSourceLabels();

  const props = defineProps<{
    features: WizardFeatureItem[];
    featureChoices: Record<string, string>;
    hasSubclassSelection?: boolean;
    subclasses?: SubclassDefinition[];
    subclassKey?: string | null;
    subclassLabel?: string;
    /** Выборы черты умений уровня: боевой стиль и подобные */
    featPicks?: WizardFeatPick[];
    /** Черты компендиума — пул пикеров черт */
    feats?: ReadonlyArray<CompendiumFeat>;
    /** Лист персонажа: по нему из пула уходят уже взятые черты */
    actor: DnDActor;
    /** Ответы на выборы даров уровня: ключ выбора → значения */
    featSelections?: Record<string, string[]>;
  }>();

  const emit = defineEmits<{
    'update:featureChoices': [choices: Record<string, string>];
    'update:subclassKey': [key: string];
    'update:featSelection': [key: string, featId: string | null];
  }>();

  /**
   * Выбранная в пикере черта по ключу выбора.
   *
   * @param key - ключ выбора черты
   */
  function selectedFeatId(key: string): string | null {
    return props.featSelections?.[key]?.[0] ?? null;
  }

  /** Выбирает вариант для особенности */
  function selectChoice(featureKey: string, choiceKey: string) {
    emit('update:featureChoices', {
      ...props.featureChoices,
      [featureKey]: choiceKey,
    });
  }

  function selectSubclass(key: string) {
    emit('update:subclassKey', key);
  }
</script>

<template>
  <div class="space-y-3">
    <span class="mb-2 block text-sm font-medium text-toned">
      {{ CLASS_WIZARD_LABELS.featuresTitle }}
    </span>

    <div
      v-if="features.length === 0 && !hasSubclassSelection"
      class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5"
    >
      <span class="text-sm text-muted">
        {{ CLASS_WIZARD_LABELS.featuresEmpty }}
      </span>
    </div>

    <!-- Выбор подкласса -->
    <div
      v-if="hasSubclassSelection"
      class="rounded-lg border border-primary/50 bg-primary/10 p-3"
    >
      <div class="mb-3 flex items-center gap-2">
        <UIcon
          name="tabler:git-branch"
          class="h-5 w-5 text-primary"
        />

        <span class="font-medium text-primary">
          {{ subclassLabel || CLASS_WIZARD_LABELS.subclassFallback }}
        </span>
      </div>

      <div class="flex flex-col gap-2">
        <button
          v-for="sc in subclasses"
          :key="sc.key"
          class="rounded-md border p-2 text-left transition-colors"
          :class="
            subclassKey === sc.key
              ? 'border-primary/50 bg-primary/10'
              : 'border-default/50 bg-default/30 hover:border-accented/50'
          "
          @click.left.exact.prevent="selectSubclass(sc.key)"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-highlighted">{{
              sc.name
            }}</span>

            <span class="text-xs text-dimmed">{{
              getSourceLabel(sc.sourceKey, sc.source)
            }}</span>
          </div>

          <ItemDescriptionRenderer
            :content="sc.description"
            class="mt-0.5 text-muted"
          />
        </button>
      </div>
    </div>

    <div
      v-for="feature in features"
      :key="feature.key"
      class="rounded-lg border border-default/50 bg-elevated/30 p-3"
    >
      <!-- Заголовок особенности -->
      <div class="mb-1.5 flex items-center gap-2">
        <span class="text-sm font-medium text-healing">{{ feature.name }}</span>

        <UBadge
          v-if="feature.sourceName"
          :label="feature.sourceName"
          size="xs"
          :color="feature.isSubclass ? 'primary' : 'neutral'"
          variant="subtle"
        />

        <UBadge
          :label="`${feature.level}${LEVEL_BADGE_SUFFIX}`"
          size="xs"
          color="neutral"
          variant="subtle"
        />
      </div>

      <!-- Описание -->
      <ItemDescriptionRenderer
        :content="feature.description"
        class="text-muted"
      />

      <!-- Варианты выбора (например Боевой стиль) -->
      <div
        v-if="feature.choices && feature.choices.length > 0"
        class="mt-3 border-t border-default/50 pt-3"
      >
        <span class="mb-2 block text-sm font-medium text-toned">
          {{ CLASS_WIZARD_LABELS.chooseFeatureChoice }}
        </span>

        <div class="flex flex-col gap-2">
          <button
            v-for="choice in feature.choices"
            :key="choice.key"
            class="rounded-md border p-2 text-left transition-colors"
            :class="
              featureChoices[feature.key] === choice.key
                ? 'border-primary/50 bg-primary/10'
                : 'border-default/50 bg-default/30 hover:border-accented/50'
            "
            @click.left.exact.prevent="selectChoice(feature.key, choice.key)"
          >
            <span class="text-sm font-semibold text-highlighted">{{
              choice.name
            }}</span>

            <ItemDescriptionRenderer
              :content="choice.description"
              class="mt-0.5 text-muted"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Выборы черты умений уровня — боевой стиль и подобные: пул берётся из
      компендиума черт, поэтому у них свой пикер, а не общие поля выбора -->
    <template v-if="featPicks?.length">
      <span class="mb-2 block text-sm font-medium text-toned">
        {{ CLASS_WIZARD_LABELS.featPicksTitle }}
      </span>

      <div
        v-for="pick in featPicks"
        :key="pick.choice.key"
        class="flex flex-col gap-1"
      >
        <span class="text-xs text-dimmed">{{ pick.sourceName }}</span>

        <WizardFeatPicker
          :choice="pick.choice"
          :feats="feats ?? []"
          :actor="actor"
          :model-value="selectedFeatId(pick.choice.key)"
          @update:model-value="
            emit('update:featSelection', pick.choice.key, $event)
          "
        />
      </div>
    </template>
  </div>
</template>
