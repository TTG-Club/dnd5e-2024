<script setup lang="ts">
  import type {
    AbilityType,
    ActorMovement,
    ProficiencyLevel,
    SkillType,
  } from '@vtt/shared';
  import type {
    AttackRollMode,
    ClassCounterDefinition,
    DnDActor,
    DnDCustomSkill,
    DnDSkillSettings,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, toRef } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';
  import { DISTANCE_UNIT_SHORT } from '@vtt/shared';
  import {
    ABILITY_LABELS,
    calculateAbilityModifier,
    calculateProficiencyBonus,
    getCustomBonusesValue,
    getCustomBonusValue,
    getCustomSkillValue,
    getDisplayMovement,
    getMovementList,
    getProficiencyContribution,
    getSkillAbility,
    getSkillRowGroups,
    getSkillSetting,
    getSkillSettingAbility,
    getTotalLevel,
    isChangedSkill,
    isProficiencyLevel,
    SKILL_PROFICIENCY_NEXT,
    SKILLS_LIST,
  } from '@vtt/shared/system/dnd.js';

  import { useResolvedStats } from '../../composables/useResolvedStats';
  import ClassCounters from './ClassCounters.vue';
  import {
    CUSTOM_BONUS_LABELS,
    SKILL_GROUP_LABEL_CLASS,
    SKILL_SETTINGS_LABELS,
  } from './constants';
  import DiceRollModal from './DiceRollModal.vue';
  import InitiativeModal from './InitiativeModal.vue';
  import MovementModal from './MovementModal.vue';
  import SkillItem from './SkillItem.vue';
  import SkillSettingsModal from './SkillSettingsModal.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
    /** Определения счётчиков из компендиума */
    counterDefinitions: ClassCounterDefinition[];
    /**
     * Характеристика под курсором: её навыки подсвечиваются в списке. `null` —
     * подсвечивать нечего.
     */
    highlightedAbility?: AbilityType | null;
  }

  defineOptions({ inheritAttrs: false });

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
  }>();

  const { resolvedStats, combinedEffects } = useResolvedStats(
    toRef(() => props.actor),
  );

  // --- Ходьба ---

  /** Конечные скорости передвижения (база + бонусы от эффектов) */
  const resolvedMovement = computed<ActorMovement>(() => {
    const resolved = resolvedStats.value?.movement;
    const base = props.actor.system.movement;

    if (!resolved) {
      return base;
    }

    return {
      ...base,
      walk: resolved.walk ?? base.walk,
      swim: resolved.swim ?? base.swim,
      fly: resolved.fly ?? base.fly,
      climb: resolved.climb ?? base.climb,
      burrow: resolved.burrow ?? base.burrow,
    };
  });

  const displayMovement = computed(() =>
    getDisplayMovement(resolvedMovement.value),
  );

  const movementList = computed(() => getMovementList(resolvedMovement.value));

  const isMovementOpen = ref(false);

  function openMovement() {
    isMovementOpen.value = true;
  }

  function onMovementApply(movement: ActorMovement) {
    emit('update:actor', {
      system: { ...props.actor.system, movement },
    });
  }

  // --- Инициатива ---

  const abilities: Array<{
    key: AbilityType;
    label: string;
  }> = [
    { key: 'strength', label: 'Сила' },
    { key: 'intelligence', label: 'Интеллект' },
    { key: 'dexterity', label: 'Ловкость' },
    { key: 'wisdom', label: 'Мудрость' },
    { key: 'constitution', label: 'Телосложение' },
    { key: 'charisma', label: 'Харизма' },
  ];

  const initiative = computed(() => {
    return resolvedStats.value?.initiative ?? 0;
  });

  const formattedInitiative = computed(() => {
    return initiative.value >= 0
      ? `+${initiative.value}`
      : `${initiative.value}`;
  });

  const initiativeTooltip = computed(() => {
    const ability = props.actor.system.initiativeAbility ?? 'dexterity';

    const abilityLabel =
      abilities.find((abilityDef) => abilityDef.key === ability)?.label
      ?? 'Ловкость';

    const abilityScore = props.actor.system.abilities[ability];
    const abilityMod = calculateAbilityModifier(abilityScore);
    const bonus = props.actor.system.initiativeBonus ?? 0;

    let text = `${abilityLabel}: ${abilityMod >= 0 ? '+' : ''}${abilityMod}`;

    if (bonus !== 0) {
      text += ` | Бонус: ${bonus >= 0 ? '+' : ''}${bonus}`;
    }

    return text;
  });

  const isInitiativeOpen = ref(false);

  const isDiceRollOpen = ref(false);

  const diceRollConfig = ref({
    modifier: 0,
    title: '',
    rollLabel: '',
    rollButtonText: 'Бросить',
    initialRollMode: 'normal' as AttackRollMode,
  });

  /**
   * Открывает универсальную модалку броска кубиков
   * @param config - конфигурация броска
   */
  function openDiceRoll(config: {
    modifier: number;
    title: string;
    rollLabel: string;
    rollButtonText?: string;
    initialRollMode?: AttackRollMode;
  }) {
    diceRollConfig.value = {
      ...config,
      rollButtonText: config.rollButtonText ?? 'Бросить',
      initialRollMode: config.initialRollMode ?? 'normal',
    };

    isDiceRollOpen.value = true;
  }

  function openInitiativeRoll() {
    let initialRollMode: AttackRollMode = 'normal';

    const flags = resolvedStats.value?.activeFlags ?? new Set();

    const hasAdvantage =
      flags.has('initiative.advantage')
      || flags.has('abilityCheck.advantage.dexterity')
      || flags.has('abilityCheck.advantage');

    const hasDisadvantage =
      flags.has('initiative.disadvantage')
      || flags.has('abilityCheck.disadvantage.dexterity')
      || flags.has('abilityCheck.disadvantage');

    if (hasAdvantage && !hasDisadvantage) {
      initialRollMode = 'advantage';
    }

    if (!hasAdvantage && hasDisadvantage) {
      initialRollMode = 'disadvantage';
    }

    openDiceRoll({
      modifier: initiative.value,
      title: 'Бросок инициативы',
      rollLabel: 'Инициатива',
      rollButtonText: 'Бросить инициативу',
      initialRollMode,
    });
  }

  /**
   * Обработчик клика по блоку инициативы:
   * - edit mode → модалка настройки
   * - view mode → модалка броска
   */
  function handleInitiativeClick() {
    if (props.isEditMode) {
      isInitiativeOpen.value = true;
    } else {
      openInitiativeRoll();
    }
  }

  function onInitiativeApply(data: {
    initiativeBonus: number;
    initiativeAbility: AbilityType;
  }) {
    emit('update:actor', {
      system: { ...props.actor.system, ...data },
    });
  }

  // --- Навыки ---

  /**
   * Модификаторы характеристик с учётом эффектов — по ним считаются свои
   * навыки и разбор значений. Без разрешённых статов модификаторы берутся
   * прямо из значений характеристик листа.
   */
  const skillAbilityMods = computed<Record<AbilityType, number>>(() => {
    const resolvedMods = resolvedStats.value?.abilityMods;

    if (resolvedMods) {
      return resolvedMods;
    }

    const scores = props.actor.system.abilities;

    return {
      strength: calculateAbilityModifier(scores.strength ?? 10),
      dexterity: calculateAbilityModifier(scores.dexterity ?? 10),
      constitution: calculateAbilityModifier(scores.constitution ?? 10),
      intelligence: calculateAbilityModifier(scores.intelligence ?? 10),
      wisdom: calculateAbilityModifier(scores.wisdom ?? 10),
      charisma: calculateAbilityModifier(scores.charisma ?? 10),
    };
  });

  /**
   * Бонус мастерства с учётом эффектов; без разрешённых статов — расчёт по
   * суммарному уровню, как по правилам.
   */
  const skillProficiencyBonus = computed(
    () =>
      resolvedStats.value?.proficiencyBonus
      ?? calculateProficiencyBonus(getTotalLevel(props.actor.system.classes)),
  );

  /** Строка списка навыков: навык правил либо заведённый игроком */
  interface SkillRow {
    /** Ключ строки списка */
    id: string;
    /** Ключ навыка правил; не задан — свой навык */
    key?: SkillType;
    label: string;
    /** Характеристика расчёта: в настройке её подменяют */
    ability: AbilityType;
    proficiencyLevel: ProficiencyLevel;
    modifier: number;
    isCustom: boolean;
    /** Разбор значения; пусто — навык считается по правилам */
    valueHint: string;
    /**
     * Характеристики своих бонусов навыка: наведение на любую из них тоже
     * связывает её с навыком, хоть навык и не её.
     */
    bonusAbilities: AbilityType[];
  }

  /**
   * Характеристики, от модификаторов которых зависят свои бонусы навыка.
   *
   * @param bonuses - свои бонусы навыка
   * @returns характеристики бонусов без повторов
   */
  function getBonusAbilities(
    bonuses: DnDCustomSkill['bonuses'],
  ): AbilityType[] {
    return [
      ...new Set(
        bonuses
          .filter((bonus) => bonus.kind === 'ability')
          .map((bonus) => bonus.ability),
      ),
    ];
  }

  /**
   * Разбор значения навыка: из чего оно сложилось. Показывается только у
   * навыков не по правилам — у остальных сокращение характеристики в строке и
   * так всё объясняет.
   *
   * Вклад активных эффектов идёт отдельной частью: без него слагаемые в
   * подсказке не сходились бы с числом в строке, и разбор вводил бы в
   * заблуждение как раз там, где он нужнее всего.
   *
   * @param ability - характеристика расчёта
   * @param proficiencyLevel - уровень владения
   * @param bonuses - свои бонусы навыка
   * @param effectsBonus - вклад активных эффектов
   * @returns строка разбора
   */
  function buildSkillHint(
    ability: AbilityType,
    proficiencyLevel: ProficiencyLevel,
    bonuses: DnDCustomSkill['bonuses'],
    effectsBonus: number,
  ): string {
    const mods = skillAbilityMods.value;

    const parts = [
      `${ABILITY_LABELS[ability]} ${formatSignedNumber(mods[ability] ?? 0)}`,
    ];

    const proficiencyPart = getProficiencyContribution(
      skillProficiencyBonus.value,
      proficiencyLevel,
    );

    if (proficiencyPart !== 0) {
      parts.push(`Мастерство ${formatSignedNumber(proficiencyPart)}`);
    }

    for (const bonus of bonuses) {
      const label = bonus.label.trim() || CUSTOM_BONUS_LABELS.unnamed;

      parts.push(
        `${label} ${formatSignedNumber(getCustomBonusValue(mods, bonus))}`,
      );
    }

    if (effectsBonus !== 0) {
      parts.push(
        `${SKILL_SETTINGS_LABELS.effects} ${formatSignedNumber(effectsBonus)}`,
      );
    }

    return parts.join(' · ');
  }

  /**
   * Список навыков листа: навыки правил и свои одним списком по алфавиту —
   * свой навык ищут по названию наравне с остальными.
   */
  const skillRows = computed<SkillRow[]>(() => {
    const settings = props.actor.system.skillSettings;
    const proficiencies = props.actor.system.proficiencies.skills;
    const mods = skillAbilityMods.value;

    const ruleRows = SKILLS_LIST.map<SkillRow>((skill) => {
      const setting = getSkillSetting(settings, skill.key);
      const ability = getSkillSettingAbility(setting, skill.key);
      const rawLevel = proficiencies[skill.key];

      const proficiencyLevel: ProficiencyLevel = isProficiencyLevel(rawLevel)
        ? rawLevel
        : 'none';

      // Итог берётся из разрешённых статов: там уже учтены активные эффекты.
      // Запасной расчёт нужен, пока статы не сошлись, — иначе строка мигает
      // нулём
      const fallbackModifier =
        mods[ability]
        + getProficiencyContribution(
          skillProficiencyBonus.value,
          proficiencyLevel,
        )
        + getCustomBonusesValue(mods, setting.bonuses);

      const modifier =
        resolvedStats.value?.skills[skill.key] ?? fallbackModifier;

      return {
        id: skill.key,
        key: skill.key,
        label: skill.label,
        ability,
        proficiencyLevel,
        modifier,
        isCustom: false,
        valueHint: isChangedSkill(setting, skill.key)
          ? buildSkillHint(
              ability,
              proficiencyLevel,
              setting.bonuses,
              modifier - fallbackModifier,
            )
          : '',
        bonusAbilities: getBonusAbilities(setting.bonuses),
      };
    });

    const customRows = (settings?.custom ?? []).map<SkillRow>((skill) => ({
      id: skill.id,
      label: skill.name,
      ability: skill.ability,
      proficiencyLevel: skill.proficiency,
      modifier: getCustomSkillValue(mods, skillProficiencyBonus.value, skill),
      isCustom: true,
      // Свой навык активные эффекты не задевают: ключа под него в системе нет
      valueHint: buildSkillHint(
        skill.ability,
        skill.proficiency,
        skill.bonuses,
        0,
      ),
      bonusAbilities: getBonusAbilities(skill.bonuses),
    }));

    return [...ruleRows, ...customRows].sort((left, right) =>
      left.label.localeCompare(right.label, 'ru'),
    );
  });

  /**
   * Группы списка: с группировкой — по характеристикам, иначе одним списком.
   * Здесь же строки получают подсветку наведённой характеристики.
   */
  const skillGroups = computed(() => {
    const highlightedAbility = props.highlightedAbility ?? null;

    const groups = getSkillRowGroups(
      skillRows.value,
      props.actor.system.skillSettings?.groupByAbility ?? false,
    );

    return groups.map((group) => ({
      key: group.key,
      title: group.title,

      // С группировкой характеристику называет разделитель, поэтому в строках
      // она не повторяется — иначе под «Ловкостью» каждая строка твердила бы
      // «ЛОВ»
      hideAbility: group.ability !== null,

      titleClass: `${SKILL_GROUP_LABEL_CLASS} ${
        group.ability !== null && group.ability === highlightedAbility
          ? 'text-primary'
          : 'text-muted'
      }`,

      rows: group.rows.map((row) => {
        // Характеристика строки, а не правило навыка: в настройке её можно
        // подменить, и подсвечивается то, от чего навык считается на самом деле
        const isMainAbility = row.ability === highlightedAbility;

        return {
          ...row,
          isMainAbility,

          // Свой бонус от другой характеристики тоже связывает её с навыком:
          // строка подсвечивается, но сокращение остаётся приглушённым —
          // навык всё-таки не её
          isHighlighted:
            isMainAbility
            || (highlightedAbility !== null
              && row.bonusAbilities.includes(highlightedAbility)),
        };
      }),
    }));
  });

  /**
   * Переключает уровень владения навыком по кругу:
   * none → half → proficient → expertise → none
   *
   * @param row - строка списка навыков
   */
  function cycleSkillProficiency(row: SkillRow) {
    if (!props.isEditMode) {
      return;
    }

    const nextLevel = SKILL_PROFICIENCY_NEXT[row.proficiencyLevel];

    // Владение своим навыком лежит в самой его записи: ключа под такой навык
    // в списке владений нет
    if (row.key === undefined) {
      const settings = props.actor.system.skillSettings;

      if (!settings) {
        return;
      }

      emit('update:actor', {
        system: {
          ...props.actor.system,
          skillSettings: {
            ...settings,
            custom: settings.custom.map((skill) =>
              skill.id === row.id
                ? { ...skill, proficiency: nextLevel }
                : skill,
            ),
          },
        },
      });

      return;
    }

    const updatedSkills = { ...props.actor.system.proficiencies.skills };

    if (nextLevel === 'none') {
      delete updatedSkills[row.key];
    } else {
      updatedSkills[row.key] = nextLevel;
    }

    emit('update:actor', {
      system: {
        ...props.actor.system,
        proficiencies: {
          ...props.actor.system.proficiencies,
          skills: updatedSkills,
        },
      },
    });
  }

  /**
   * Поля, чей итог задан активным эффектом целиком. Окно настройки берёт
   * отсюда навыки под перезаписью: их число задаёт эффект, а не расчёт.
   */
  const overriddenSkillKeys = computed(
    () => resolvedStats.value?.overriddenKeys ?? new Set<string>(),
  );

  const isSkillSettingsOpen = ref(false);

  /** Открывает окно настройки навыков */
  function openSkillSettings(): void {
    isSkillSettingsOpen.value = true;
  }

  /**
   * Применяет настройку навыков: владения и поправки расчёта приходят из окна
   * вместе — их правят там одной таблицей.
   *
   * @param payload - настройка из окна
   * @param payload.skills - уровни владения навыками правил
   * @param payload.settings - поправки расчёта и свои навыки
   */
  function onSkillSettingsApply(payload: {
    skills: Partial<Record<SkillType, ProficiencyLevel>>;
    settings: DnDSkillSettings;
  }) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        skillSettings: payload.settings,
        proficiencies: {
          ...props.actor.system.proficiencies,
          skills: payload.skills,
        },
      },
    });
  }

  /**
   * Обработчик броска навыка
   * @param modifier - модификатор навыка
   * @param label - название навыка
   * @param key - ключ навыка
   */
  function handleSkillRoll(modifier: number, label: string, key?: SkillType) {
    let initialRollMode: AttackRollMode = 'normal';

    if (key) {
      const ability = getSkillAbility(key);
      const flags = resolvedStats.value?.activeFlags ?? new Set();

      const hasAdvantage =
        flags.has('abilityCheck.advantage')
        || flags.has(`abilityCheck.advantage.${ability}`);

      const hasDisadvantage =
        flags.has('abilityCheck.disadvantage')
        || flags.has(`abilityCheck.disadvantage.${ability}`)
        // Помеха конкретного навыка (напр. Скрытность от брони)
        || (key === 'stealth' && flags.has('skill.stealth.disadvantage'));

      if (hasAdvantage && !hasDisadvantage) {
        initialRollMode = 'advantage';
      }

      if (!hasAdvantage && hasDisadvantage) {
        initialRollMode = 'disadvantage';
      }
    }

    openDiceRoll({
      modifier,
      title: `Проверка: ${label}`,
      rollLabel: `Проверка ${label}`,
      rollButtonText: 'Бросить проверку',
      initialRollMode,
    });
  }
</script>

<template>
  <div
    v-bind="$attrs"
    class="flex h-full flex-col gap-3"
  >
    <!-- Ходьба + Инициатива -->
    <div class="grid grid-cols-2 gap-3">
      <!-- Ходьба -->
      <UTooltip
        :delay-duration="300"
        :ui="{ content: 'h-auto' }"
      >
        <FieldsetLabel
          :label="displayMovement.label"
          center
          class="h-12 bg-default/20 transition-colors"
          :class="[
            isEditMode
              ? 'cursor-pointer border-primary/30 hover:border-primary/50'
              : 'border-muted',
          ]"
          @click.left.exact.prevent="isEditMode && openMovement()"
        >
          <div class="flex items-center justify-center px-2 pb-2">
            <div class="flex items-baseline gap-1">
              <span class="text-xl font-bold text-highlighted">{{
                displayMovement.value
              }}</span>

              <span class="text-[10px] font-medium text-dimmed">{{
                DISTANCE_UNIT_SHORT[actor.system.movement.units ?? 'ft']
              }}</span>
            </div>
          </div>
        </FieldsetLabel>

        <template #content>
          <div class="flex flex-col gap-1">
            <div
              v-for="item in movementList"
              :key="item.type"
              class="flex items-center gap-2"
            >
              <span class="tabular-nums opacity-70"
                >{{ item.value }}
                {{
                  DISTANCE_UNIT_SHORT[actor.system.movement.units ?? 'ft']
                }}</span
              >

              <span>{{ item.label }}</span>
            </div>
          </div>
        </template>
      </UTooltip>

      <!-- Инициатива -->
      <UTooltip :delay-duration="300">
        <FieldsetLabel
          label="Инициатива"
          center
          class="h-12 bg-default/20 transition-colors"
          :class="
            props.isEditMode
              ? 'cursor-pointer border-primary/30 hover:border-primary/50'
              : 'cursor-pointer border-muted hover:border-primary/50'
          "
          @click.left.exact.prevent="handleInitiativeClick"
        >
          <div class="flex items-center justify-center px-2 pb-2">
            <div
              class="text-xl font-bold"
              :class="initiative >= 0 ? 'text-highlighted' : 'text-danger'"
            >
              {{ formattedInitiative }}
            </div>
          </div>
        </FieldsetLabel>

        <template #content>
          <span>{{ initiativeTooltip }}</span>
        </template>
      </UTooltip>
    </div>

    <!-- Счётчики классовых ресурсов -->
    <ClassCounters
      :actor="actor"
      :counter-definitions="counterDefinitions"
      :is-edit-mode="isEditMode"
      @update:actor="emit('update:actor', $event)"
    />

    <!-- Навыки -->
    <FieldsetLabel
      label="Навыки"
      class="flex flex-col overflow-hidden border-muted"
    >
      <!-- Шестерёнка ведёт в настройку расчёта: значок в самом списке ставит
        только владение, а характеристику навыка, свои бонусы и свои навыки
        правят в окне. Вне правки листа её нет — настраивать там нечего -->
      <template
        v-if="isEditMode"
        #actions
      >
        <UTooltip :text="SKILL_SETTINGS_LABELS.open">
          <UIcon
            name="tabler:settings-filled"
            class="h-3.5 w-3.5 cursor-pointer text-primary transition-colors hover:text-primary/80"
            role="button"
            tabindex="0"
            :aria-label="SKILL_SETTINGS_LABELS.open"
            @click.left.exact.prevent="openSkillSettings"
            @keydown.enter.prevent="openSkillSettings"
            @keydown.space.prevent="openSkillSettings"
          />
        </UTooltip>
      </template>

      <div class="custom-scrollbar flex-1 overflow-y-auto p-1.5">
        <div class="flex flex-col">
          <template
            v-for="group in skillGroups"
            :key="group.key"
          >
            <!-- Разделитель группы: подпись слева, линия до края строки. Без
              группировки группа одна и подписи у неё нет -->
            <USeparator
              v-if="group.title"
              :label="group.title"
              position="start"
              class="px-2 pt-2 first:pt-0"
              :ui="{ label: group.titleClass }"
            />

            <SkillItem
              v-for="row in group.rows"
              :key="row.id"
              :label="row.label"
              :skill-key="row.key"
              :ability="row.ability"
              :proficiency-level="row.proficiencyLevel"
              :modifier="row.modifier"
              :is-custom="row.isCustom"
              :value-hint="row.valueHint"
              :hide-ability="group.hideAbility"
              :is-highlighted="row.isHighlighted"
              :is-ability-highlighted="row.isMainAbility"
              :is-edit-mode="isEditMode"
              @cycle-proficiency="cycleSkillProficiency(row)"
              @roll="handleSkillRoll"
            />
          </template>
        </div>
      </div>
    </FieldsetLabel>
  </div>

  <!-- Модалка броска -->
  <DiceRollModal
    v-model:open="isDiceRollOpen"
    :modifier="diceRollConfig.modifier"
    :title="diceRollConfig.title"
    :roll-label="diceRollConfig.rollLabel"
    :roll-button-text="diceRollConfig.rollButtonText"
    :initial-roll-mode="diceRollConfig.initialRollMode"
  />

  <!-- Модалка движения -->
  <MovementModal
    v-model:open="isMovementOpen"
    :movement="actor.system.movement"
    :active-effects="combinedEffects"
    @apply="onMovementApply"
  />

  <!-- Модалка инициативы -->
  <InitiativeModal
    v-model:open="isInitiativeOpen"
    :initiative-bonus="actor.system.initiativeBonus ?? 0"
    :initiative-ability="actor.system.initiativeAbility ?? 'dexterity'"
    :ability-scores="{
      strength: actor.system.abilities.strength,
      dexterity: actor.system.abilities.dexterity,
      constitution: actor.system.abilities.constitution,
      intelligence: actor.system.abilities.intelligence,
      wisdom: actor.system.abilities.wisdom,
      charisma: actor.system.abilities.charisma,
    }"
    @apply="onInitiativeApply"
  />

  <!-- Модалка настройки навыков -->
  <SkillSettingsModal
    v-model:open="isSkillSettingsOpen"
    :proficiencies="actor.system.proficiencies.skills"
    :settings="actor.system.skillSettings"
    :ability-mods="skillAbilityMods"
    :proficiency-bonus="skillProficiencyBonus"
    :skills="resolvedStats?.skills ?? {}"
    :overridden-keys="overriddenSkillKeys"
    @apply="onSkillSettingsApply"
  />
</template>

<!-- Полоса прокрутки описана один раз в system.css: здесь ширина по умолчанию -->
