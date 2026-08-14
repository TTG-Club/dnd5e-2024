<script setup lang="ts">
  /**
   * Настройка заклинательства листа: характеристика, сложность спасброска и
   * бонус атаки заклинанием.
   *
   * По правилам оба числа выводятся из характеристики и бонуса мастерства.
   * Здесь этот расчёт правится: своё число вместо него целиком либо свои бонусы
   * сверху — от характеристики, от мастерства или числом.
   *
   * Правки копятся в черновике до «Применить»: числа в окне пересчитываются
   * сразу, а лист узнаёт о них только по кнопке.
   */
  import type { AbilityType } from '@vtt/shared';
  import type {
    DnDActor,
    DnDActorSpellcastingParams,
    DnDCustomBonus,
    DnDCustomBonusContext,
    DnDSpellcastingSettings,
    DnDSpellcastingValueSettings,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, toRef, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    ABILITY_OPTIONS,
    getSpellAttackBreakdown,
    getSpellSaveDCBreakdown,
    parseSpellcastingSettings,
    SPELL_ATTACK_BASE_MAX,
    SPELL_ATTACK_BASE_MIN,
    SPELL_SAVE_DC_BASE,
    SPELL_SAVE_DC_MAX,
    SPELL_SAVE_DC_MIN,
    toStoredSpellcastingSettings,
  } from '@vtt/shared/system/dnd.js';

  import {
    BONUS_INPUT_FORMAT_OPTIONS,
    FORM_FIELD_LABELS,
    MODAL_BUTTON_LABELS,
    SPELLCASTING_SETTINGS_LABELS,
  } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    actor: DnDActor;
    /** Модификаторы характеристик с учётом эффектов — для предпросмотра */
    abilityMods: Record<AbilityType, number>;
    /** {{ SPELLCASTING_SETTINGS_LABELS.proficiency }} актёра */
    proficiencyBonus: number;
    /** Прибавка к Сл спасброска от активных эффектов */
    saveDcEffectBonus: number;
    /** Прибавка к бонусу атаки заклинанием от активных эффектов */
    attackEffectBonus: number;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'update:actor': [updates: Partial<DnDActor>];
  }>();

  /** Значение варианта «по классу» в выборе характеристики */
  const ABILITY_AUTO = 'auto';

  /** Выбор характеристики: своя либо «по классу» */
  type AbilityChoice = AbilityType | typeof ABILITY_AUTO;

  /** Черновик одного числа: своя основа и свои бонусы */
  interface ValueDraft {
    /** Основа задана числом, а не выведена по правилам */
    isCustomBase: boolean;

    /** Своё число основы; работает только при поднятой галке */
    base: number;

    /** Свои бонусы сверх основы */
    bonuses: DnDCustomBonus[];
  }

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const actorRef = toRef(props, 'actor');

  /**
   * Правка идёт по копии: до «Применить» запись листа не меняется — окно
   * закрывают и «Отменой».
   */
  const form = reactive<{
    ability: AbilityChoice;
    saveDC: ValueDraft;
    attack: ValueDraft;
  }>({
    ability: ABILITY_AUTO,
    saveDC: { isCustomBase: false, base: 0, bonuses: [] },
    attack: { isCustomBase: false, base: 0, bonuses: [] },
  });

  /**
   * Настройка листа; поля нет у листов старых миров. Читается разбором, а не
   * типом: запись могла приехать в мир и правкой руками.
   */
  const storedSettings = computed<DnDSpellcastingSettings | undefined>(() =>
    parseSpellcastingSettings(actorRef.value.system?.spellcastingSettings),
  );

  /**
   * Заводит черновик одного числа по записи листа. Своё число подставляется из
   * расчёта по правилам: его чаще правят на пару единиц, чем набирают с нуля.
   *
   * @param draft - черновик числа
   * @param settings - настройка числа из записи листа
   * @param ruleValue - число по правилам
   */
  function fillDraft(
    draft: ValueDraft,
    settings: DnDSpellcastingValueSettings | undefined,
    ruleValue: number,
  ): void {
    const base = settings?.base ?? null;

    draft.isCustomBase = base !== null;
    draft.base = base ?? ruleValue;

    // Копии, а не сами бонусы листа: окно живёт до «Применить», и его правки
    // не должны менять лист раньше времени
    draft.bonuses = (settings?.bonuses ?? []).map((bonus) => ({ ...bonus }));
  }

  /** Характеристика из первого заклинательного класса (режим «по классу») */
  const classAbility = computed<AbilityType | null>(() => {
    const casterClass = actorRef.value.system?.classes?.find(
      (entry) => entry.spellcastingAbility != null,
    );

    return casterClass?.spellcastingAbility ?? null;
  });

  /**
   * Подсказка «характеристику задаёт класс»: «Определяется по классу: ХАР.».
   * Название стоит между приставкой и точкой, поэтому строка собирается здесь, а
   * не в шаблоне: подстановки подряд форматтер вправе разорвать переносом, и Vue
   * отодвинул бы точку от названия пробелом.
   */
  const classAbilityHint = computed(() =>
    classAbility.value
      ? SPELLCASTING_SETTINGS_LABELS.byClassHintPrefix
        + abilityLabel(classAbility.value)
        + SPELLCASTING_SETTINGS_LABELS.byClassHintSuffix
      : '',
  );

  /** Характеристика, по которой считается предпросмотр */
  const effectiveAbility = computed<AbilityType | null>(() =>
    form.ability === ABILITY_AUTO ? classAbility.value : form.ability,
  );

  /** Название характеристики для строки разбора */
  function abilityLabel(ability: AbilityType): string {
    return (
      ABILITY_OPTIONS.find((option) => option.value === ability)?.label
      ?? ability
    );
  }

  const options = computed<Array<{ value: AbilityChoice; label: string }>>(
    () => [
      {
        value: ABILITY_AUTO,
        label: classAbility.value
          ? `${SPELLCASTING_SETTINGS_LABELS.autoByClassPrefix}${abilityLabel(classAbility.value)}${SPELLCASTING_SETTINGS_LABELS.autoByClassSuffix}`
          : SPELLCASTING_SETTINGS_LABELS.autoByClass,
      },
      ...ABILITY_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ],
  );

  /** Модификатор выбранной характеристики; null — заклинательства нет */
  const abilityModifier = computed(() =>
    effectiveAbility.value
      ? (props.abilityMods[effectiveAbility.value] ?? 0)
      : null,
  );

  /**
   * Черновик заводится при открытии: окно живёт во вкладке постоянно, и без
   * этого «Отмена» не отличалась бы от «Применить».
   *
   * Своё число подставляется из расчёта по правилам для той характеристики,
   * что записана в листе: её же и покажет только что открытое окно.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      form.ability = actorRef.value.system?.spellcastingAbility ?? ABILITY_AUTO;

      const stored =
        form.ability === ABILITY_AUTO ? classAbility.value : form.ability;

      const ruleBase =
        props.proficiencyBonus
        + (stored ? (props.abilityMods[stored] ?? 0) : 0);

      fillDraft(
        form.saveDC,
        storedSettings.value?.saveDC,
        SPELL_SAVE_DC_BASE + ruleBase,
      );

      fillDraft(form.attack, storedSettings.value?.attack, ruleBase);
    },
    { immediate: true },
  );

  /** Числа листа, от которых считается вклад своих бонусов */
  const bonusContext = computed<DnDCustomBonusContext>(() => ({
    abilityMods: props.abilityMods,
    proficiencyBonus: props.proficiencyBonus,
  }));

  /**
   * Черновик одного числа в том же виде, в каком он ляжет в запись листа.
   *
   * @param draft - черновик числа
   * @returns настройка числа
   */
  function toValueSettings(draft: ValueDraft): DnDSpellcastingValueSettings {
    return {
      base: draft.isCustomBase ? toFieldValue(draft.base) : null,
      bonuses: draft.bonuses,
    };
  }

  /**
   * Число из поля для предпросмотра: очищенное поле отдаёт NaN, и без
   * подстраховки он расползся бы по всему разбору. В лист значение уходит через
   * `toStoredSpellcastingSettings` — он его и клампит.
   *
   * @param value - значение поля ввода
   * @returns число основы
   */
  function toFieldValue(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  /** Настройка из черновика — и для предпросмотра, и для сохранения */
  const draftSettings = computed<DnDSpellcastingSettings>(() => ({
    saveDC: toValueSettings(form.saveDC),
    attack: toValueSettings(form.attack),
  }));

  /** Исходные данные разбора: у обоих чисел они одни и те же */
  const breakdownParams = computed<
    Omit<DnDActorSpellcastingParams, 'settings'>
  >(() => ({
    ability: effectiveAbility.value,
    context: bonusContext.value,
  }));

  /** Разбор сложности спасброска — той же функцией, что считает и лист */
  const saveDcBreakdown = computed(() =>
    getSpellSaveDCBreakdown({
      ...breakdownParams.value,
      settings: draftSettings.value.saveDC,
    }),
  );

  /** Разбор бонуса атаки заклинанием */
  const attackBreakdown = computed(() =>
    getSpellAttackBreakdown({
      ...breakdownParams.value,
      settings: draftSettings.value.attack,
    }),
  );

  /**
   * Предпросмотр итоговых чисел. Прибавки от эффектов входят в оба, иначе окно
   * расходилось бы с числами вкладки.
   */
  const preview = computed(() => ({
    saveDc:
      saveDcBreakdown.value === null
        ? SPELLCASTING_SETTINGS_LABELS.none
        : String(saveDcBreakdown.value.value + props.saveDcEffectBonus),
    attack:
      attackBreakdown.value === null
        ? SPELLCASTING_SETTINGS_LABELS.none
        : formatSignedNumber(
            attackBreakdown.value.value + props.attackEffectBonus,
          ),
  }));

  /** Раздел настройки одного числа: заголовок, черновик и пределы поля */
  interface ValueSection {
    /** Ключ раздела — только для списка разметки */
    key: string;

    /** Заголовок раздела */
    title: string;

    /** Черновик числа: галка своей основы, само число и свои бонусы */
    draft: ValueDraft;

    /** Подпись расчёта по правилам под галкой */
    ruleHint: string;

    /** Пределы своего числа */
    minimum: number;
    maximum: number;

    /**
     * Формат поля своего числа. У сложности спасброска знака нет — там стоит
     * готовое число; бонус атаки прибавляется к броску, и знак у него виден
     * всегда.
     */
    formatOptions?: Intl.NumberFormatOptions;
  }

  /**
   * Разделы настройки: у сложности спасброска и у атаки устройство одно, и
   * разметка у них общая — расходиться этим двум блокам не с чего.
   */
  const sections = computed<ValueSection[]>(() => [
    {
      key: 'saveDC',
      title: SPELLCASTING_SETTINGS_LABELS.saveDC,
      draft: form.saveDC,
      ruleHint: ruleHint(SPELL_SAVE_DC_BASE),
      minimum: SPELL_SAVE_DC_MIN,
      maximum: SPELL_SAVE_DC_MAX,
    },
    {
      key: 'attack',
      title: SPELLCASTING_SETTINGS_LABELS.attack,
      draft: form.attack,
      ruleHint: ruleHint(0),
      minimum: SPELL_ATTACK_BASE_MIN,
      maximum: SPELL_ATTACK_BASE_MAX,
      formatOptions: BONUS_INPUT_FORMAT_OPTIONS,
    },
  ]);

  /**
   * Подпись расчёта по правилам под галкой своей основы: при поднятой галке
   * число листа считается уже не по ним, и напомнить о правилах больше негде.
   *
   * @param ruleBase - прибавка правил: 8 у сложности спасброска, 0 у атаки
   * @returns подпись вида «По правилам: 13»
   */
  function ruleHint(ruleBase: number): string {
    if (abilityModifier.value === null) {
      return (
        SPELLCASTING_SETTINGS_LABELS.ruleValuePrefix
        + SPELLCASTING_SETTINGS_LABELS.none
      );
    }

    const value = ruleBase + props.proficiencyBonus + abilityModifier.value;

    return (
      SPELLCASTING_SETTINGS_LABELS.ruleValuePrefix
      + (ruleBase === 0 ? formatSignedNumber(value) : String(value))
    );
  }

  /** Сохраняет настройку заклинательства и закрывает окно */
  function applySettings(): void {
    emit('update:actor', {
      system: {
        ...actorRef.value.system,
        spellcastingAbility:
          form.ability === ABILITY_AUTO ? undefined : form.ability,
        spellcastingSettings: toStoredSpellcastingSettings(draftSettings.value),
      },
    });

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="480"
    :min-height="420"
    :title="SPELLCASTING_SETTINGS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-toned">
            {{ FORM_FIELD_LABELS.ability }}
          </span>

          <USelect
            v-model="form.ability"
            :items="options"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-56 shrink-0"
          />
        </div>

        <p class="text-xs text-dimmed">
          <template v-if="classAbility">
            {{ classAbilityHint }}
          </template>

          <template v-else>
            {{ SPELLCASTING_SETTINGS_LABELS.noClassHint }}
          </template>
        </p>

        <!-- Сложность спасброска и атака: устройство у них одно -->
        <div
          v-for="section in sections"
          :key="section.key"
          class="space-y-3 border-t border-muted pt-3"
        >
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ section.title }}
          </span>

          <UCheckbox
            v-model="section.draft.isCustomBase"
            :label="SPELLCASTING_SETTINGS_LABELS.customBase"
            :description="section.ruleHint"
          />

          <div
            v-if="section.draft.isCustomBase"
            class="flex items-center justify-between gap-4"
          >
            <span class="text-sm text-toned">
              {{ SPELLCASTING_SETTINGS_LABELS.baseValue }}
            </span>

            <UInputNumber
              v-model="section.draft.base"
              :min="section.minimum"
              :max="section.maximum"
              :format-options="section.formatOptions"
              size="sm"
              class="w-40 shrink-0"
              :aria-label="SPELLCASTING_SETTINGS_LABELS.baseValue"
            />
          </div>

          <CustomBonusRows
            v-model="section.draft.bonuses"
            :context="bonusContext"
          />
        </div>

        <div class="border-t border-muted" />

        <div class="flex items-center justify-between gap-4 text-sm">
          <span class="text-toned">{{
            SPELLCASTING_SETTINGS_LABELS.abilityMod
          }}</span>

          <span class="text-toned tabular-nums">
            <template v-if="effectiveAbility && abilityModifier !== null">
              {{ abilityLabel(effectiveAbility) }} ·
              {{ formatSignedNumber(abilityModifier) }}
            </template>

            <template v-else>
              {{ SPELLCASTING_SETTINGS_LABELS.none }}
            </template>
          </span>
        </div>

        <div class="flex items-center justify-between gap-4 text-sm">
          <span class="text-toned">{{
            SPELLCASTING_SETTINGS_LABELS.proficiency
          }}</span>

          <span class="text-toned tabular-nums">
            {{ formatSignedNumber(proficiencyBonus) }}
          </span>
        </div>

        <!-- Итоговые числа: то же, что показывает шапка вкладки -->
        <div class="grid grid-cols-2 gap-3">
          <div
            class="flex flex-col items-center gap-1 rounded-lg border border-default/50 bg-elevated/20 px-3 py-2"
          >
            <span
              class="text-center text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ SPELLCASTING_SETTINGS_LABELS.saveDC }}
            </span>

            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ preview.saveDc }}
            </span>
          </div>

          <div
            class="flex flex-col items-center gap-1 rounded-lg border border-default/50 bg-elevated/20 px-3 py-2"
          >
            <span
              class="text-center text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ SPELLCASTING_SETTINGS_LABELS.attack }}
            </span>

            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ preview.attack }}
            </span>
          </div>
        </div>

        <p class="text-xs leading-relaxed text-dimmed">
          {{ SPELLCASTING_SETTINGS_LABELS.formula }}
        </p>

        <p class="text-xs leading-relaxed text-dimmed">
          {{ SPELLCASTING_SETTINGS_LABELS.bonusesHint }}
        </p>

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
            @click.left.exact.prevent="applySettings"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
