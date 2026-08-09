<script setup lang="ts">
  /**
   * Настройка навыков листа.
   *
   * По правилам навык — модификатор своей характеристики плюс бонус мастерства
   * по уровню владения. Здесь этот расчёт правится: проверка катится от другой
   * характеристики, к навыку добавляются свои бонусы, а навык, которого в
   * правилах нет, заводится прямо здесь же.
   *
   * Правки копятся в черновике до «Применить»: числа в окне пересчитываются
   * сразу, а лист узнаёт о них только по кнопке.
   */
  import type { AbilityType, ProficiencyLevel, SkillType } from '@vtt/shared';
  import type {
    DnDActor,
    DnDCustomBonus,
    DnDSkillSettings,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import { generateEntityId } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    ABILITY_OPTIONS,
    CUSTOM_SKILL_NAME_MAX_LENGTH,
    CUSTOM_SKILLS_MAX,
    DEFAULT_CUSTOM_SKILL_ABILITY,
    getCustomBonusesValue,
    getProficiencyContribution,
    getSkillEffectKey,
    getSkillRowGroups,
    getSkillSetting,
    getSkillSettingAbility,
    hasSkillName,
    isProficiencyLevel,
    NEW_CUSTOM_BONUS,
    PASSIVE_SKILL_BASE,
    SKILL_ABILITY_MAP,
    SKILL_PROFICIENCY_NEXT,
    SKILLS_LIST,
    toCustomSkill,
    toStoredSkillSettings,
  } from '@vtt/shared/system/dnd.js';

  import { SKILL_GROUP_LABEL_CLASS, SKILL_SETTINGS_LABELS } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import ProficiencyIndicator from './ProficiencyIndicator.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Актёр листа: из него берутся владения и настройка навыков */
    actor: DnDActor;
    /** Модификаторы характеристик с учётом эффектов */
    abilityMods: Record<AbilityType, number>;
    /** Бонус мастерства с учётом эффектов */
    proficiencyBonus: number;
    /** Итоговые навыки листа — из них берётся вклад активных эффектов */
    skills: Partial<Record<SkillType, number>>;
    /**
     * Ключи навыков, чей итог задан активным эффектом целиком. Такой навык
     * настройке не подчиняется, и окно не должно обещать другое число.
     */
    overriddenKeys: Set<string>;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [
      payload: {
        skills: Partial<Record<SkillType, ProficiencyLevel>>;
        settings: DnDSkillSettings;
      },
    ];
  }>();

  /**
   * Строка черновика: настройка одного навыка до «Применить». Навыки правил и
   * свои лежат одним списком — они правятся одинаково, а в общем списке свой
   * навык стоит по алфавиту среди прочих.
   */
  interface SkillDraft {
    /** Ключ навыка правил; null — навык заведён игроком */
    key: SkillType | null;
    /** Ключ строки: ключ навыка правил либо идентификатор своего */
    id: string;
    name: string;
    /** Характеристика расчёта: по правилам — своя у каждого навыка */
    ability: AbilityType;
    proficiency: ProficiencyLevel;
    /** Свои бонусы этого навыка */
    bonuses: DnDCustomBonus[];
  }

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftSkills = ref<SkillDraft[]>([]);

  // Группировка правится тем же черновиком, что и навыки: список в окне
  // перестраивается сразу, и до «Применить» видно, каким он станет в листе.
  const isGroupedByAbility = ref(false);

  /**
   * Вклад активных эффектов в каждый навык правил: разница между итогом листа
   * и тем, что даёт расчёт по записанной настройке. Без него числа в окне
   * расходились бы со списком навыков у всех, на ком висит хоть один эффект.
   */
  const effectBonuses = ref<Partial<Record<SkillType, number>>>({});

  /**
   * Навыки по алфавиту: свой навык встаёт среди навыков правил, а не в хвост
   * списка — в панели листа его ищут по названию.
   *
   * @param drafts - строки черновика
   * @returns строки, отсортированные по названию
   */
  function sortByName(drafts: SkillDraft[]): SkillDraft[] {
    return [...drafts].sort((left, right) =>
      left.name.localeCompare(right.name, 'ru'),
    );
  }

  /**
   * Заводит черновик по данным листа. Окно живёт в листе постоянно, поэтому
   * черновик собирается на каждом открытии — иначе оно показывало бы того
   * актёра, с которым его открыли впервые.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      const settings = props.actor.system.skillSettings;
      const proficiencies = props.actor.system.proficiencies.skills;
      const deltas: Partial<Record<SkillType, number>> = {};

      const ruleSkills = SKILLS_LIST.map<SkillDraft>((skill) => {
        const setting = getSkillSetting(settings, skill.key);
        const rawLevel = proficiencies[skill.key];

        const proficiency: ProficiencyLevel = isProficiencyLevel(rawLevel)
          ? rawLevel
          : 'none';

        // Расчёт по записанной настройке: всё, что итог даёт сверх него, —
        // вклад эффектов, и он переносится в предпросмотр как есть
        const stored =
          props.abilityMods[getSkillSettingAbility(setting, skill.key)]
          + getProficiencyContribution(props.proficiencyBonus, proficiency)
          + getCustomBonusesValue(props.abilityMods, setting.bonuses);

        deltas[skill.key] = (props.skills[skill.key] ?? stored) - stored;

        return {
          key: skill.key,
          id: skill.key,
          name: skill.label,
          ability: getSkillSettingAbility(setting, skill.key),
          proficiency,
          bonuses: setting.bonuses.map((bonus) => ({ ...bonus })),
        };
      });

      const customSkills = (settings?.custom ?? []).map<SkillDraft>(
        (skill) => ({
          key: null,
          id: skill.id,
          name: skill.name,
          ability: skill.ability,
          proficiency: skill.proficiency,
          bonuses: skill.bonuses.map((bonus) => ({ ...bonus })),
        }),
      );

      draftSkills.value = sortByName([...ruleSkills, ...customSkills]);
      isGroupedByAbility.value = settings?.groupByAbility ?? false;
      effectBonuses.value = deltas;
    },
  );

  /** Строки окна: черновик плюс всё, что рисуется рядом с ним */
  const displayRows = computed(() =>
    draftSkills.value.map((draft) => {
      const isCustom = draft.key === null;

      const ruleAbility =
        draft.key === null ? null : SKILL_ABILITY_MAP[draft.key];

      // Свой навык «изменённым» не считается: сравнивать его не с чем, к
      // правилам его не возвращают — его удаляют
      const isChanged =
        ruleAbility !== null
        && (draft.ability !== ruleAbility || draft.bonuses.length > 0);

      // Перезаписанный эффектом навык считает не лист: настройку у него правят
      // на будущее (когда эффект спадёт), а число берётся то, что в листе
      const isOverridden =
        draft.key !== null
        && props.overriddenKeys.has(getSkillEffectKey(draft.key));

      const value =
        draft.key !== null && isOverridden
          ? (props.skills[draft.key] ?? 0)
          : props.abilityMods[draft.ability]
            + getProficiencyContribution(
              props.proficiencyBonus,
              draft.proficiency,
            )
            + getCustomBonusesValue(props.abilityMods, draft.bonuses)
            + (draft.key === null ? 0 : (effectBonuses.value[draft.key] ?? 0));

      return {
        draft,
        ability: draft.ability,
        isCustom,
        isChanged,
        isOverridden,
        formattedValue: formatSignedNumber(value),
        passiveValue: PASSIVE_SKILL_BASE + value,
        // Значок владения повторяет список навыков листа: без владения он
        // приглушён
        proficiencyClass:
          draft.proficiency === 'none' ? 'text-muted' : 'text-primary',
        // Изменённая строка обведена тёплым: видно, где расчёт отошёл от правил
        frameClass:
          isCustom || isChanged ? 'border-primary/40' : 'border-default/50',
      };
    }),
  );

  /** Группы строк: с группировкой — по характеристикам, иначе одним списком */
  const displayGroups = computed(() =>
    getSkillRowGroups(displayRows.value, isGroupedByAbility.value),
  );

  const customName = ref('');

  const customAbility = ref<AbilityType>(DEFAULT_CUSTOM_SKILL_ABILITY);

  const customSkillsCount = computed(
    () => draftSkills.value.filter((draft) => draft.key === null).length,
  );

  const isCustomLimitReached = computed(
    () => customSkillsCount.value >= CUSTOM_SKILLS_MAX,
  );

  const isCustomDuplicate = computed(
    () =>
      customName.value.trim().length > 0
      && hasSkillName(
        draftSkills.value.map((draft) => draft.name),
        customName.value,
      ),
  );

  const isCustomAddDisabled = computed(
    () =>
      !customName.value.trim()
      || isCustomDuplicate.value
      || isCustomLimitReached.value,
  );

  /** Подсказка под полем: почему добавить нельзя, иначе — что вообще делает */
  const customHint = computed(() => {
    if (isCustomDuplicate.value) {
      return SKILL_SETTINGS_LABELS.customDuplicate;
    }

    if (isCustomLimitReached.value) {
      return SKILL_SETTINGS_LABELS.customLimit;
    }

    return SKILL_SETTINGS_LABELS.customHint;
  });

  const customHintClass = computed(() =>
    isCustomDuplicate.value || isCustomLimitReached.value
      ? 'text-warning'
      : 'text-dimmed',
  );

  /**
   * Переключает уровень владения по кругу — как значком в списке навыков.
   *
   * @param draft - строка черновика
   */
  function cycleProficiency(draft: SkillDraft): void {
    draft.proficiency = SKILL_PROFICIENCY_NEXT[draft.proficiency];
  }

  /**
   * Возврат навыка к правилам: своя характеристика и без своих бонусов.
   * Владение остаётся — его даёт класс, а не подсчёт.
   *
   * @param draft - строка черновика
   */
  function resetSkill(draft: SkillDraft): void {
    if (draft.key === null) {
      return;
    }

    draft.ability = SKILL_ABILITY_MAP[draft.key];
    draft.bonuses = [];
  }

  /**
   * Заводит навыку пустой бонус: заготовка «+1» правится тут же в строке.
   *
   * @param draft - строка черновика
   */
  function addBonus(draft: SkillDraft): void {
    draft.bonuses = [
      ...draft.bonuses,
      { ...NEW_CUSTOM_BONUS, id: generateEntityId('bonus') },
    ];
  }

  /**
   * Добавляет свой навык: он встаёт в общий список по алфавиту, а поле
   * очищается — следующий навык вписывается сразу, без лишнего клика.
   */
  function addCustomSkill(): void {
    if (isCustomAddDisabled.value) {
      return;
    }

    const skill = toCustomSkill(
      generateEntityId('skill'),
      customName.value,
      customAbility.value,
    );

    draftSkills.value = sortByName([
      ...draftSkills.value,
      { key: null, ...skill },
    ]);

    customName.value = '';
  }

  /**
   * Убирает свой навык из черновика.
   *
   * @param draft - строка черновика
   */
  function removeCustomSkill(draft: SkillDraft): void {
    draftSkills.value = draftSkills.value.filter((row) => row.id !== draft.id);
  }

  /** Отдаёт настройку наверх и закрывает окно */
  function applySettings(): void {
    const skills: Partial<Record<SkillType, ProficiencyLevel>> = {};
    const settingsSkills: DnDSkillSettings['skills'] = {};
    const custom: DnDSkillSettings['custom'] = [];

    for (const draft of draftSkills.value) {
      if (draft.key === null) {
        custom.push({
          id: draft.id,
          name: draft.name,
          ability: draft.ability,
          proficiency: draft.proficiency,
          bonuses: draft.bonuses,
        });

        continue;
      }

      // Владение навыком правил остаётся там же, где его ставят мастера
      // классов и черт; уровень «нет владения» в записи не хранится
      if (draft.proficiency !== 'none') {
        skills[draft.key] = draft.proficiency;
      }

      settingsSkills[draft.key] = {
        ability: draft.ability,
        bonuses: draft.bonuses,
      };
    }

    emit('apply', {
      skills,
      settings: toStoredSkillSettings({
        skills: settingsSkills,
        custom,
        groupByAbility: isGroupedByAbility.value,
      }),
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
    :min-width="640"
    :min-height="480"
    :title="SKILL_SETTINGS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="flex flex-col gap-2">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ SKILL_SETTINGS_LABELS.hint }}
        </p>

        <!-- Порядок вывода — такая же настройка списка, как своя строка ниже,
          поэтому и рамка у них общая -->
        <UCheckbox
          v-model="isGroupedByAbility"
          :label="SKILL_SETTINGS_LABELS.groupTitle"
          :description="SKILL_SETTINGS_LABELS.groupHint"
          class="rounded-lg border border-dashed border-default/70 p-2"
        />

        <!-- Своя строка над списком: с восемнадцатью навыками добавление в
          хвосте пришлось бы искать прокруткой -->
        <div
          class="flex flex-col gap-2 rounded-lg border border-dashed border-default/70 p-2"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ SKILL_SETTINGS_LABELS.customTitle }}
            </span>

            <div class="flex w-full items-center gap-2 sm:w-auto sm:grow">
              <UInput
                v-model="customName"
                size="sm"
                class="min-w-0 grow"
                :maxlength="CUSTOM_SKILL_NAME_MAX_LENGTH"
                :disabled="isCustomLimitReached"
                :placeholder="SKILL_SETTINGS_LABELS.customNamePlaceholder"
                @keydown.enter.prevent="addCustomSkill"
              />

              <USelect
                v-model="customAbility"
                :items="ABILITY_OPTIONS"
                value-key="value"
                label-key="label"
                size="sm"
                class="w-40 shrink-0"
                :disabled="isCustomLimitReached"
                :aria-label="SKILL_SETTINGS_LABELS.ability"
              />

              <UTooltip :text="SKILL_SETTINGS_LABELS.customAdd">
                <UButton
                  icon="tabler:plus"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                  square
                  class="shrink-0"
                  :disabled="isCustomAddDisabled"
                  :aria-label="SKILL_SETTINGS_LABELS.customAdd"
                  @click.left.exact.prevent="addCustomSkill"
                />
              </UTooltip>
            </div>
          </div>

          <p
            class="text-xs leading-relaxed"
            :class="customHintClass"
          >
            {{ customHint }}
          </p>
        </div>

        <template
          v-for="group in displayGroups"
          :key="group.key"
        >
          <!-- Разделитель группы — как в самом листе; без группировки группа
            одна и подписи у неё нет -->
          <USeparator
            v-if="group.title"
            :label="group.title"
            position="start"
            class="pt-1"
            :ui="{ label: SKILL_GROUP_LABEL_CLASS }"
          />

          <div
            v-for="row in group.rows"
            :key="row.draft.id"
            class="flex flex-col gap-2 rounded-lg border bg-elevated/20 p-2 transition-colors"
            :class="row.frameClass"
          >
            <div class="flex flex-wrap items-center gap-2">
              <ProficiencyIndicator
                :level="row.draft.proficiency"
                :class="row.proficiencyClass"
                @cycle="cycleProficiency(row.draft)"
              />

              <span class="min-w-0 grow truncate text-sm text-toned">
                {{ row.draft.name }}
              </span>

              <span
                v-if="row.isCustom"
                class="shrink-0 rounded border border-primary/40 px-1.5 text-[10px] font-bold tracking-wider text-primary uppercase"
              >
                {{ SKILL_SETTINGS_LABELS.customBadge }}
              </span>

              <!-- Навык под перезаписью: число в строке не от настройки, и
                пометка объясняет, почему оно не двигается -->
              <UTooltip
                v-if="row.isOverridden"
                :text="SKILL_SETTINGS_LABELS.overriddenHint"
              >
                <span
                  class="shrink-0 rounded border border-warning/50 px-1.5 text-[10px] font-bold tracking-wider text-warning uppercase"
                >
                  {{ SKILL_SETTINGS_LABELS.overriddenBadge }}
                </span>
              </UTooltip>

              <span
                class="w-8 shrink-0 text-right text-sm font-bold text-highlighted tabular-nums"
              >
                {{ row.formattedValue }}
              </span>

              <UTooltip :text="SKILL_SETTINGS_LABELS.passive">
                <span class="w-6 text-right text-xs text-dimmed tabular-nums">
                  {{ row.passiveValue }}
                </span>
              </UTooltip>

              <!-- Характеристика, сброс и плюс держатся одной группой: на узком
                окне она переносится под название целой строкой, а не
                рассыпается по краям -->
              <div class="flex items-center gap-2">
                <USelect
                  v-model="row.draft.ability"
                  :items="ABILITY_OPTIONS"
                  value-key="value"
                  label-key="label"
                  size="sm"
                  class="w-40 shrink-0"
                  :aria-label="`${SKILL_SETTINGS_LABELS.ability}: ${row.draft.name}`"
                />

                <!-- У своего навыка на месте возврата к правилам стоит
                  удаление: возвращать его не к чему -->
                <UTooltip
                  v-if="row.isCustom"
                  :text="SKILL_SETTINGS_LABELS.customRemove"
                >
                  <UButton
                    icon="tabler:trash"
                    color="error"
                    variant="ghost"
                    size="xs"
                    square
                    :aria-label="`${SKILL_SETTINGS_LABELS.customRemove}: ${row.draft.name}`"
                    @click.left.exact.prevent="removeCustomSkill(row.draft)"
                  />
                </UTooltip>

                <UTooltip
                  v-else
                  :text="SKILL_SETTINGS_LABELS.reset"
                >
                  <UButton
                    icon="tabler:rotate"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    :disabled="!row.isChanged"
                    :aria-label="`${SKILL_SETTINGS_LABELS.reset}: ${row.draft.name}`"
                    @click.left.exact.prevent="resetSkill(row.draft)"
                  />
                </UTooltip>

                <UTooltip :text="SKILL_SETTINGS_LABELS.addBonus">
                  <UButton
                    icon="tabler:plus"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                    square
                    :aria-label="`${SKILL_SETTINGS_LABELS.addBonus}: ${row.draft.name}`"
                    @click.left.exact.prevent="addBonus(row.draft)"
                  />
                </UTooltip>
              </div>
            </div>

            <!-- У навыка без своих бонусов строк нет вовсе, а первый бонус
              заводит плюс в шапке: своя кнопка «Добавить» в каждой из
              восемнадцати строк только шумела бы -->
            <CustomBonusRows
              v-if="row.draft.bonuses.length > 0"
              v-model="row.draft.bonuses"
              :ability-mods="abilityMods"
              :with-add="false"
              class="border-l-2 border-primary/40 pl-2"
            />
          </div>
        </template>

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
            @click.left.exact.prevent="applySettings"
          >
            Применить
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
