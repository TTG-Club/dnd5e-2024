<script setup lang="ts">
  /**
   * Шаг мастера класса «Заклинания списка класса»: умение выдаёт список класса
   * целиком («Использование заклинаний» чародея), и игрок решает, класть ли на
   * лист весь список сразу или выбрать из него самому. Так же сделано в листе
   * персонажа на сайте: по умолчанию — выбор, выбранное ложится
   * неподготовленным, а подготовку игрок отмечает сам.
   */

  import type {
    ClassSpellListOffer,
    ResolvedGrantedSpell,
  } from '@vtt/shared/system/dnd.js';

  import type { ChoicePickerOption } from '../../ChoicePickerModal.vue';
  import type { ClassSpellListMode } from './useClassWizard';

  import { computed } from 'vue';

  import ChoicePickerField from '../../ChoicePickerField.vue';
  import { CLASS_SPELL_LIST_LABELS } from '../../constants';
  import { spellCircleLabel } from '../../utils/spellCircleLabel';
  import { CLASS_SPELL_LIST_DEFAULT_MODE } from './useClassWizard';

  const props = defineProps<{
    /** Что уровень открывает в списках класса — по умениям */
    offers: ReadonlyArray<ClassSpellListOffer>;
    /** Заклинания списков, которых ещё нет на листе, с умением-источником */
    pool: ReadonlyArray<ResolvedGrantedSpell>;
    /** Пул ещё грузится из компендиума */
    loading: boolean;
    /** Ответы игрока: ключ умения → как класть список */
    modes: Record<string, ClassSpellListMode>;
    /** Выбранные заклинания: ключ умения → id компендиума */
    picks: Record<string, string[]>;
    /** Сколько готовят по таблице класса на этом уровне; null — колонки нет */
    preparedValue: number | null;
  }>();

  const emit = defineEmits<{
    'update:mode': [featureKey: string, mode: ClassSpellListMode];
    'update:picks': [featureKey: string, spellIds: string[]];
  }>();

  /**
   * Сужает значение переключателя до режима списка: `URadioGroup` отдаёт
   * значение любого своего пункта.
   *
   * @param value - значение переключателя
   * @returns true — это режим списка
   */
  function isClassSpellListMode(value: unknown): value is ClassSpellListMode {
    return value === 'all' || value === 'chosen';
  }

  /** Сравнение вариантов окна: по кругу, затем по названию */
  function compareOptions(
    first: ChoicePickerOption,
    second: ChoicePickerOption,
  ): number {
    const levelDifference =
      (first.spell?.level ?? 0) - (second.spell?.level ?? 0);

    return levelDifference || first.name.localeCompare(second.name, 'ru');
  }

  /** Предложения с пулом, вариантами и подписями — один раз, а не в шаблоне */
  const entries = computed(() =>
    props.offers.map((offer) => {
      const spells = props.pool.filter(
        (granted) => granted.featureKey === offer.featureKey,
      );

      const options = spells
        .map<ChoicePickerOption>((granted) => ({
          value: granted.spell.id,
          name: granted.spell.name,
          nameEn: granted.spell.nameEn,
          badge: spellCircleLabel(granted.spell.level),
          sourceKey: granted.spell.sourceKey,
          source: granted.spell.source,
          spell: granted.spell,
        }))
        .sort(compareOptions);

      const mode =
        props.modes[offer.featureKey] ?? CLASS_SPELL_LIST_DEFAULT_MODE;

      return {
        offer,
        mode,
        options,
        selected: props.picks[offer.featureKey] ?? [],
        // Подсказка, а не запрет: книгу пополняют и сверх нормы подготовки
        max:
          props.preparedValue === null
            ? options.length
            : Math.min(options.length, props.preparedValue),
        modeItems: [
          {
            value: 'chosen',
            label: CLASS_SPELL_LIST_LABELS.chosenLabel,
            description: CLASS_SPELL_LIST_LABELS.chosenDescription,
          },
          {
            value: 'all',
            label: CLASS_SPELL_LIST_LABELS.allLabel,
            description: `${CLASS_SPELL_LIST_LABELS.allDescriptionPrefix}${options.length}`,
          },
        ],
      };
    }),
  );

  /** Пояснение к выбору: как ложатся выбранные и сколько готовят по таблице */
  const pickerHint = computed(() =>
    props.preparedValue === null
      ? CLASS_SPELL_LIST_LABELS.pickerExplanation
      : `${CLASS_SPELL_LIST_LABELS.pickerExplanation} ${CLASS_SPELL_LIST_LABELS.preparedHintPrefix}${props.preparedValue}.`,
  );

  /**
   * Записывает режим умения.
   *
   * @param featureKey - ключ умения
   * @param value - значение переключателя
   */
  function handleModeUpdate(featureKey: string, value: unknown): void {
    if (isClassSpellListMode(value)) {
      emit('update:mode', featureKey, value);
    }
  }

  /**
   * Записывает выбранные заклинания умения.
   *
   * @param featureKey - ключ умения
   * @param spellIds - id выбранных заклинаний
   */
  function handlePicksUpdate(featureKey: string, spellIds: string[]): void {
    emit('update:picks', featureKey, spellIds);
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-for="entry in entries"
      :key="entry.offer.featureKey"
      class="flex flex-col gap-3 rounded-xl border border-default/50 bg-elevated/30 p-3"
    >
      <div class="flex flex-col">
        <span class="font-medium text-highlighted">
          {{ CLASS_SPELL_LIST_LABELS.title }}
        </span>

        <span class="text-xs text-dimmed">
          {{ entry.offer.featureName }}
        </span>
      </div>

      <p
        v-if="loading"
        class="text-xs text-dimmed italic"
      >
        {{ CLASS_SPELL_LIST_LABELS.loadingPool }}
      </p>

      <p
        v-else-if="entry.options.length === 0"
        class="text-xs text-dimmed italic"
      >
        {{ CLASS_SPELL_LIST_LABELS.emptyPool }}
      </p>

      <template v-else>
        <URadioGroup
          :model-value="entry.mode"
          :items="entry.modeItems"
          variant="list"
          @update:model-value="handleModeUpdate(entry.offer.featureKey, $event)"
        />

        <ChoicePickerField
          v-if="entry.mode === 'chosen'"
          :label="CLASS_SPELL_LIST_LABELS.pickerTitle"
          :subtitle="entry.offer.featureName"
          :options="entry.options"
          :selected="entry.selected"
          :max="entry.max"
          @update:selected="handlePicksUpdate(entry.offer.featureKey, $event)"
        >
          <template #hint>
            <p class="text-xs text-dimmed">
              {{ pickerHint }}
            </p>
          </template>
        </ChoicePickerField>
      </template>
    </div>
  </div>
</template>
