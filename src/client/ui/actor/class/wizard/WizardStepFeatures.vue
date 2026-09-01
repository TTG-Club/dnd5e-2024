<script setup lang="ts">
  /**
   * Шаг мастера: Умения класса.
   *
   * Умения уровня показываются свёрнутыми строками: описание умения занимает
   * экран целиком — у «Магии договора» колдуна это полстраницы, — и за ним не
   * видно ни остальных умений уровня, ни того, что от игрока чего-то ждут.
   * Разворачивают строку, чтобы прочитать подробно.
   *
   * Умение, которому нужен выбор варианта, помечено в самой строке: сам выбор
   * лежит внутри, и без пометки игрок упёрся бы в неактивную кнопку «Далее», не
   * понимая, где его спрашивают.
   */
  import type {
    DnDActor,
    FeatChoice,
    Spell,
    SubclassDefinition,
  } from '@vtt/shared/system/dnd.js';

  import type {
    CompendiumFeat,
    WizardFeatPick,
    WizardFeatureChoicePick,
    WizardFeatureItem,
  } from './useClassWizard';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { useSourceLabels } from '@/systems/dnd5e/composables/useSourceLabel';
  import { resolveFeatChoiceCount } from '@vtt/shared/system/dnd.js';

  import { useExpandedRows } from '../../../../composables/useExpandedRows';
  import { CLASS_WIZARD_LABELS, LEVEL_BADGE_SUFFIX } from '../../constants';
  import FeatChoicesFields from '../../feat/FeatChoicesFields.vue';
  import WizardFeatPicker from './WizardFeatPicker.vue';
  import WizardFeatureChoicePicker from './WizardFeatureChoicePicker.vue';

  /** Цвет пометки строки умения: ждём выбора или он уже сделан. */
  type FeatureBadgeColor = 'warning' | 'success';

  const { getSourceLabel } = useSourceLabels();

  const { isExpanded, toggle } = useExpandedRows();

  const props = defineProps<{
    features: WizardFeatureItem[];
    featureChoices: Record<string, string[]>;
    /** Выборы вариантов умений этого уровня — и доборы прошлых */
    choicePicks: WizardFeatureChoicePick[];
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
    /**
     * Вопросы вариантов по ключу их умения: задаются прямо в карточке умения,
     * под выбором варианта. Спрошенные общим списком ниже, они выглядели бы
     * вопросами ниоткуда — игрок не связал бы их с манёвром, который отметил.
     */
    optionChoices?: Record<string, FeatChoice[]>;
    /** Бонус мастерства: от него зависит количество у части выборов */
    proficiencyBonus: number;
    /** Заклинания каталога — пул выбора заклинания у варианта */
    spells?: ReadonlyArray<Spell>;
  }>();

  const emit = defineEmits<{
    'update:featureChoices': [choices: Record<string, string[]>];
    'update:subclassKey': [key: string];
    'update:featSelection': [key: string, featId: string | null];
    'update:featSelections': [selections: Record<string, string[]>];
  }>();

  /**
   * Выбранная в пикере черта по ключу выбора.
   *
   * @param key - ключ выбора черты
   */
  function selectedFeatId(key: string): string | null {
    return props.featSelections?.[key]?.[0] ?? null;
  }

  /**
   * Доборы: умение получено раньше, а его варианты берут на этом уровне. У них
   * нет карточки умения, поэтому они идут отдельным блоком.
   */
  const reopenedPicks = computed(() =>
    props.choicePicks.filter((pick) => !pick.isGainedNow),
  );

  /**
   * На уровне и правда нечего показать: ни умений, ни выбора подкласса, ни
   * добора вариантов. Добор считается наравне с умением — у колдуна на 5
   * уровне новых умений нет, а воззвания берут, и строка «умений нет» стояла
   * бы прямо над вопросом о них.
   */
  const isLevelEmpty = computed(
    () =>
      props.features.length === 0
      && !props.hasSubclassSelection
      && reopenedPicks.value.length === 0,
  );

  /** Выборы вариантов по ключу умения — их ищет карточка умения. */
  const picksByFeatureKey = computed(() => {
    const byKey: Record<string, WizardFeatureChoicePick> = {};

    for (const pick of props.choicePicks) {
      byKey[pick.featureKey] = pick;
    }

    return byKey;
  });

  /**
   * Выбранные варианты умения.
   *
   * @param featureKey - ключ умения
   */
  function selectedFor(featureKey: string): string[] {
    return props.featureChoices[featureKey] ?? [];
  }

  /**
   * Запоминает выбранные варианты умения.
   *
   * @param featureKey - ключ умения
   * @param choiceKeys - ключи выбранных вариантов
   */
  function selectChoice(featureKey: string, choiceKeys: string[]): void {
    emit('update:featureChoices', {
      ...props.featureChoices,
      [featureKey]: choiceKeys,
    });
  }

  /**
   * Значок свёртки строки умения: показывает, куда уедет описание.
   *
   * @param featureKey - ключ умения
   */
  function toggleIcon(featureKey: string): string {
    return isExpanded(featureKey)
      ? 'tabler:chevron-down'
      : 'tabler:chevron-right';
  }

  /**
   * Подпись строки для скринридера: по нажатию она раскрывается и
   * сворачивается, и текст должен говорить, что случится дальше.
   *
   * @param featureKey - ключ умения
   */
  function toggleLabel(featureKey: string): string {
    return isExpanded(featureKey)
      ? CLASS_WIZARD_LABELS.featureCollapse
      : CLASS_WIZARD_LABELS.featureExpand;
  }

  /**
   * Пометки строк о выборе: пока не набрано — предупреждение, после — спокойная
   * отметка. Считается только то, что и правда есть в предложении: набранное до
   * смены подкласса могло устареть.
   */
  const choiceBadges = computed(() => {
    const byKey: Record<string, { label: string; color: FeatureBadgeColor }> =
      {};

    for (const pick of props.choicePicks) {
      const selected = selectedFor(pick.featureKey);

      const chosen = pick.options.filter((choice) =>
        selected.includes(choice.key),
      ).length;

      // Вопросы взятого варианта считаются наравне с самим выбором: манёвр
      // отмечен, а навык к нему не назван — умение ещё не готово
      const answered = optionChoicesFor(pick.featureKey).every(
        (choice) =>
          (props.featSelections?.[choice.key]?.length ?? 0)
          >= resolveFeatChoiceCount(choice, props.proficiencyBonus),
      );

      byKey[pick.featureKey] =
        chosen >= pick.count && answered
          ? { label: CLASS_WIZARD_LABELS.choiceDoneBadge, color: 'success' }
          : { label: CLASS_WIZARD_LABELS.choiceNeededBadge, color: 'warning' };
    }

    return byKey;
  });

  function selectSubclass(key: string) {
    emit('update:subclassKey', key);
  }

  /**
   * Вопросы вариантов этого умения; пусто — взятые варианты ни о чём не
   * спрашивают.
   *
   * @param featureKey - ключ умения
   */
  function optionChoicesFor(featureKey: string): FeatChoice[] {
    return props.optionChoices?.[featureKey] ?? [];
  }

  /**
   * Записывает ответы на вопросы вариантов. Список ответов общий на весь
   * уровень — карточка правит его целиком, как и поля выбора внизу.
   *
   * @param selections - ответы: ключ выбора → значения
   */
  function updateFeatSelections(selections: Record<string, string[]>): void {
    emit('update:featSelections', selections);
  }
</script>

<template>
  <div class="space-y-3">
    <span class="mb-2 block text-sm font-medium text-toned">
      {{ CLASS_WIZARD_LABELS.featuresTitle }}
    </span>

    <div
      v-if="isLevelEmpty"
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
      class="rounded-lg border border-default/50 bg-elevated/30"
    >
      <!-- Нажимается вся строка целиком: попадать в стрелку незачем -->
      <div
        class="flex min-h-11 cursor-pointer items-center gap-2 p-3 transition-colors hover:bg-elevated/50"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded(feature.key)"
        :aria-label="toggleLabel(feature.key)"
        @click.left.exact.prevent="toggle(feature.key)"
        @keydown.enter.prevent="toggle(feature.key)"
        @keydown.space.prevent="toggle(feature.key)"
      >
        <UIcon
          :name="toggleIcon(feature.key)"
          class="size-4 shrink-0 text-muted"
        />

        <span class="min-w-0 flex-1 truncate text-sm font-medium text-healing">
          {{ feature.name }}
        </span>

        <!-- Пометка выбора идёт первой: ради неё строку и открывают -->
        <UBadge
          v-if="choiceBadges[feature.key]"
          :label="choiceBadges[feature.key].label"
          :color="choiceBadges[feature.key].color"
          size="md"
          variant="subtle"
          class="shrink-0"
        />

        <UBadge
          v-if="feature.sourceName"
          :label="feature.sourceName"
          size="md"
          :color="feature.isSubclass ? 'primary' : 'neutral'"
          variant="subtle"
          class="hidden shrink-0 md:inline-flex"
        />

        <UBadge
          :label="`${feature.level}${LEVEL_BADGE_SUFFIX}`"
          size="md"
          color="neutral"
          variant="subtle"
          class="shrink-0"
        />
      </div>

      <div
        v-if="isExpanded(feature.key)"
        class="border-t border-default/50 p-3"
      >
        <ItemDescriptionRenderer
          :content="feature.description"
          class="text-muted"
        />

        <!-- Варианты умения: боевой стиль, манёвры, воззвания -->
        <div
          v-if="picksByFeatureKey[feature.key]"
          class="mt-3 border-t border-default/50 pt-3"
        >
          <WizardFeatureChoicePicker
            :pick="picksByFeatureKey[feature.key]"
            :selected="selectedFor(feature.key)"
            @update:selected="selectChoice"
          />

          <!-- Вопросы взятого варианта — здесь же, под ним: «Договор Гримуара»
            даёт выбрать навык, и спрашивать его надо там, где вариант отметили -->
          <FeatChoicesFields
            v-if="optionChoicesFor(feature.key).length"
            class="mt-3 border-t border-default/50 pt-3"
            :model-value="featSelections ?? {}"
            :choices="optionChoicesFor(feature.key)"
            :actor="actor"
            :proficiency-bonus="proficiencyBonus"
            :spells="spells"
            @update:model-value="updateFeatSelections"
          />
        </div>
      </div>
    </div>

    <!-- Доборы вариантов у умений прошлых уровней: воззвания колдуна берут на
      2, 5, 7 и дальше, а само умение он получил на первом -->
    <template v-if="reopenedPicks.length">
      <span class="mb-2 block text-sm font-medium text-toned">
        {{ CLASS_WIZARD_LABELS.choicePicksTitle }}
      </span>

      <div
        v-for="pick in reopenedPicks"
        :key="pick.featureKey"
        class="rounded-lg border border-default/50 bg-elevated/30 p-3"
      >
        <span class="mb-1 block text-xs text-dimmed">{{
          pick.sourceName
        }}</span>

        <WizardFeatureChoicePicker
          :pick="pick"
          :selected="selectedFor(pick.featureKey)"
          @update:selected="selectChoice"
        />

        <FeatChoicesFields
          v-if="optionChoicesFor(pick.featureKey).length"
          class="mt-3 border-t border-default/50 pt-3"
          :model-value="featSelections ?? {}"
          :choices="optionChoicesFor(pick.featureKey)"
          :actor="actor"
          :proficiency-bonus="proficiencyBonus"
          :spells="spells"
          @update:model-value="updateFeatSelections"
        />
      </div>
    </template>

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
