<script setup lang="ts">
  import type { AbilityType, ActorArmorClass } from '@vtt/shared';
  import type {
    AttackRollMode,
    DnDActor,
    DnDCustomBonus,
    DnDCustomBonusContext,
    DnDProficiencySettings,
    DnDSavingThrowSettings,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, toRef } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';
  import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
  import {
    BASE_UNARMORED_AC,
    calculateAbilityModifier,
    calculateProficiencyBonus,
    getActorAbilityModifiers,
    getCustomBonusValue,
    getEntityExhaustionLevel,
    getTotalLevel,
    resolveEntityMaxHp,
    withExhaustionLevel,
  } from '@vtt/shared/system/dnd.js';

  import { useProficiencyBonus } from '../../composables/useProficiencyBonus';
  import { useResolvedStats } from '../../composables/useResolvedStats';
  import { useToolVocabulary } from '../../composables/useToolVocabulary';
  import ArmorClassModal from './ArmorClassModal.vue';
  import ArmorProficiencyModal from './ArmorProficiencyModal.vue';
  import {
    ACTOR_LEFT_PANEL_LABELS,
    ARMOR_CALCULATION_LABELS,
    ARMOR_CLASS_SETTINGS_LABELS,
    CUSTOM_BONUS_LABELS,
    DICE_ROLL_DEFAULT_BUTTON,
    GRANT_SECTION_LABELS,
    HIT_POINTS_LABELS,
    PROFICIENCY_MODAL_LABELS,
    PROFICIENCY_SETTINGS_LABELS,
    SAVING_THROW_ABILITIES,
    SAVING_THROW_ROLL_LABELS,
    SAVING_THROW_SETTINGS_LABELS,
    SHEET_TILE_LABELS,
    SHEET_TILE_SHORT_LABELS,
  } from './constants';
  import DiceRollModal from './DiceRollModal.vue';
  import ExhaustionPanel from './ExhaustionPanel.vue';
  import HitPointsModal from './HitPointsModal.vue';
  import LanguageProficiencyModal from './LanguageProficiencyModal.vue';
  import ProficiencyBonusModal from './ProficiencyBonusModal.vue';
  import SavingThrowSettingsModal from './SavingThrowSettingsModal.vue';
  import SheetSettingsGear from './SheetSettingsGear.vue';
  import ToolProficiencyModal from './ToolProficiencyModal.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';
  import { getSheetBlockClass } from './utils/sheetBlockClass';
  import WeaponProficiencyModal from './WeaponProficiencyModal.vue';

  defineOptions({ inheritAttrs: false });

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
  }>();

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
  }

  /**
   * Оформление плитки, которую настраивают только в правке: там она нажимается
   * целиком, а в просмотре лишь показывает число.
   */
  const editableTileClass = computed(() =>
    getSheetBlockClass({
      isEditMode: props.isEditMode,
      isClickable: props.isEditMode,
    }),
  );

  /** Оформление блока здоровья: окно хитов открывают в любом режиме */
  const hitPointsBlockClass = computed(() =>
    getSheetBlockClass({ isEditMode: props.isEditMode, isClickable: true }),
  );

  /**
   * Максимум хитов с учётом эффектов: «Ложная жизнь» и подобные поднимают
   * потолок, и плитка обязана показывать то же число, по которому лечат и
   * ограничивают текущие хиты.
   */
  const maxHitPoints = computed(() => resolveEntityMaxHp(props.actor));

  /** Текущая степень Истощения — её несёт эффект-состояние */
  const exhaustionLevel = computed(() =>
    getEntityExhaustionLevel(props.actor.activeEffects),
  );

  /**
   * Ставит степень Истощения: движок пересобирает эффект со штрафами этой
   * степени, нулевая — снимает состояние.
   *
   * @param level - выбранная степень (0–6)
   */
  function handleExhaustionSelect(level: number): void {
    emit('update:actor', {
      activeEffects: withExhaustionLevel(
        props.actor.activeEffects ?? [],
        level,
      ),
    });
  }

  /** Оформление блока, который целиком не нажимается: настройка — в шестерёнке */
  const blockClass = computed(() =>
    getSheetBlockClass({ isEditMode: props.isEditMode }),
  );

  /**
   * Подпись плитки класса доспеха: в правке рядом встаёт шестерёнка, и полное
   * название перестаёт помещаться — там подпись сокращается. Полное остаётся у
   * скринридера и в подсказке с разбором.
   */
  const armorClassLabel = computed(() =>
    props.isEditMode
      ? SHEET_TILE_SHORT_LABELS.armorClass
      : SHEET_TILE_LABELS.armorClass,
  );

  const systemDataStore = useSystemDataStore();

  /**
   * Карта ключ → русское имя для отображения бэйджей владения бронёй
   */
  const armorProfNameMap = computed(() => {
    const map = new Map<string, string>();

    for (const cat of systemDataStore.armorCategories) {
      map.set(cat.key, cat.name);
    }

    for (const bt of systemDataStore.armorBaseTypes) {
      map.set(bt.key, bt.name);
    }

    return map;
  });

  /** Категории брони для умных бэйджей */
  const ARMOR_BADGE_CATEGORIES = [
    { key: 'light', label: ACTOR_LEFT_PANEL_LABELS.armorAllLight },
    { key: 'medium', label: ACTOR_LEFT_PANEL_LABELS.armorAllMedium },
    { key: 'heavy', label: ACTOR_LEFT_PANEL_LABELS.armorAllHeavy },
    { key: 'shield', label: ACTOR_LEFT_PANEL_LABELS.armorAllShields },
  ];

  /**
   * Умные бэйджи владения бронёй:
   * если вся категория выбрана → один бэйдж, иначе — перечисление
   */
  const armorProfBadges = computed(() => {
    const selected = new Set(props.actor.system.proficiencies.armor);
    const badges: string[] = [];

    for (const cat of ARMOR_BADGE_CATEGORIES) {
      const catKeys = systemDataStore.armorBaseTypes
        .filter((bt) => bt.category === cat.key)
        .map((bt) => bt.key);

      const allSelected =
        catKeys.length > 0
        && catKeys.every((armorKey) => selected.has(armorKey));

      if (allSelected) {
        badges.push(cat.label);
      } else {
        for (const key of catKeys) {
          if (selected.has(key)) {
            badges.push(armorProfNameMap.value.get(key) ?? key);
          }
        }
      }
    }

    // Неизвестные ключи (устаревшие, из старого формата) игнорируются

    return badges;
  });

  /**
   * Карта ключ → русское имя для отображения бэйджей владения оружием
   */
  const weaponProfNameMap = computed(() => {
    const map = new Map<string, string>();

    for (const cat of systemDataStore.weaponCategories) {
      map.set(cat.key, cat.name);
    }

    for (const bt of systemDataStore.weaponBaseTypes) {
      map.set(bt.key, bt.name);
    }

    return map;
  });

  /** Названия владений: системные плюс заведённые в мире инструменты */
  const { labels: toolLabels } = useToolVocabulary();

  const toolProfBadges = computed(() => {
    // Ключ без названия остаётся ключом: предмет мира могли удалить, а владение
    // на листе — нет, и терять его показ из-за этого нельзя.
    return props.actor.system.proficiencies.tools.map(
      (key) => toolLabels.value[key] ?? key,
    );
  });

  /**
   * Умные бэйджи владения оружием:
   * - все simple/martial выбраны + все мастерства → «Все простые 🏅»
   * - все simple/martial выбраны + часть мастерств → «Все простые» + конкретные с 🏅
   * - частичный выбор → перечисление индивидуальных с пометкой мастерства
   */
  const weaponProfBadges = computed(() => {
    const selected = new Set(props.actor.system.proficiencies.weapons);

    const masteries = new Set(
      props.actor.system.proficiencies.weaponMasteries ?? [],
    );

    const badges: Array<{ label: string; hasMastery: boolean }> = [];

    const simpleKeys = systemDataStore.weaponBaseTypes
      .filter((bt) => bt.category === 'simple')
      .map((bt) => bt.key);

    const martialKeys = systemDataStore.weaponBaseTypes
      .filter((bt) => bt.category === 'martial')
      .map((bt) => bt.key);

    const allSimple =
      simpleKeys.length > 0
      && simpleKeys.every((weaponKey) => selected.has(weaponKey));

    const allMartial =
      martialKeys.length > 0
      && martialKeys.every((weaponKey) => selected.has(weaponKey));

    if (allSimple) {
      const simpleMasteries = simpleKeys.filter((weaponKey) =>
        masteries.has(weaponKey),
      );

      const allSimpleMastery = simpleMasteries.length === simpleKeys.length;

      badges.push({
        label: ACTOR_LEFT_PANEL_LABELS.weaponsAllSimple,
        hasMastery: allSimpleMastery,
      });

      // Если мастерство есть, но не на все — добавляем конкретные
      if (!allSimpleMastery && simpleMasteries.length > 0) {
        for (const key of simpleMasteries) {
          badges.push({
            label: weaponProfNameMap.value.get(key) ?? key,
            hasMastery: true,
          });
        }
      }
    } else {
      for (const key of simpleKeys) {
        if (selected.has(key)) {
          badges.push({
            label: weaponProfNameMap.value.get(key) ?? key,
            hasMastery: masteries.has(key),
          });
        }
      }
    }

    if (allMartial) {
      const martialMasteries = martialKeys.filter((weaponKey) =>
        masteries.has(weaponKey),
      );

      const allMartialMastery = martialMasteries.length === martialKeys.length;

      badges.push({
        label: ACTOR_LEFT_PANEL_LABELS.weaponsAllMartial,
        hasMastery: allMartialMastery,
      });

      if (!allMartialMastery && martialMasteries.length > 0) {
        for (const key of martialMasteries) {
          badges.push({
            label: weaponProfNameMap.value.get(key) ?? key,
            hasMastery: true,
          });
        }
      }
    } else {
      for (const key of martialKeys) {
        if (selected.has(key)) {
          badges.push({
            label: weaponProfNameMap.value.get(key) ?? key,
            hasMastery: masteries.has(key),
          });
        }
      }
    }

    // Неизвестные ключи (устаревшие, из старого формата) игнорируются

    return badges;
  });

  const { resolvedStats } = useResolvedStats(toRef(() => props.actor));

  /**
   * Модификаторы характеристик с учётом эффектов — по ним считаются и сами
   * спасброски, и вклад бонусов-характеристик в окнах настройки. Без
   * разрешённых статов модификаторы берутся прямо из значений листа.
   */
  const sheetAbilityMods = computed<Record<AbilityType, number>>(
    () =>
      resolvedStats.value?.abilityMods ?? getActorAbilityModifiers(props.actor),
  );

  /** Бонус мастерства по правилам — расчёт по суммарному уровню */
  const ruleProficiencyBonus = computed(() =>
    calculateProficiencyBonus(getTotalLevel(props.actor.system.classes)),
  );

  /** Подпись основы по правилам: уровень персонажа с его бонусом */
  const proficiencyRuleTitle = computed(
    () =>
      `${PROFICIENCY_SETTINGS_LABELS.levelSource} ${getTotalLevel(
        props.actor.system.classes,
      )}`,
  );

  const {
    settings: proficiencySettings,
    value: proficiencyBonus,
    tooltip: proficiencyTooltip,
  } = useProficiencyBonus({
    settings: () => props.actor.system.proficiencySettings,
    ruleValue: ruleProficiencyBonus,
    ruleTitle: proficiencyRuleTitle,
    abilityMods: sheetAbilityMods,
    resolvedValue: () => resolvedStats.value?.proficiencyBonus,
  });

  /** Числа листа, от которых считается вклад своих бонусов */
  const bonusContext = computed<DnDCustomBonusContext>(() => ({
    abilityMods: sheetAbilityMods.value,
    proficiencyBonus: proficiencyBonus.value,
  }));

  /** Сводка по костям хитов (Hit Dice) для текущего актора */
  const hitDiceSummary = computed(() => {
    const classes = props.actor.system.classes;

    const manualDice = props.actor.system.manualHitDice;

    // Группируем по кости (d10, d8 и т.д.)
    const diceMap = new Map<number, { total: number; used: number }>();

    if (classes) {
      for (const cls of classes) {
        if (!cls.hitDie) {
          continue;
        }

        const entry = diceMap.get(cls.hitDie) ?? { total: 0, used: 0 };

        entry.total += cls.level;
        entry.used += cls.hitDiceUsed ?? 0;
        diceMap.set(cls.hitDie, entry);
      }
    }

    if (manualDice) {
      for (const group of manualDice) {
        const entry = diceMap.get(group.die) ?? { total: 0, used: 0 };

        entry.total += group.total;
        entry.used += group.used;
        diceMap.set(group.die, entry);
      }
    }

    if (diceMap.size === 0) {
      return {
        totalCount: 0,
        availableCount: 0,
        tooltip: ACTOR_LEFT_PANEL_LABELS.hitDiceEmpty,
      };
    }

    let totalCount = 0;
    let availableCount = 0;

    const tooltipParts: string[] = [];

    // Сортируем от большей кости к меньшей (d12 -> d10 -> d8 -> d6)
    for (const [die, stats] of Array.from(diceMap.entries()).sort(
      (entryA, entryB) => entryB[0] - entryA[0],
    )) {
      totalCount += stats.total;
      availableCount += stats.total - stats.used;

      tooltipParts.push(
        `${stats.total - stats.used}${ACTOR_LEFT_PANEL_LABELS.hitDieLetter}${die} / ${stats.total}${ACTOR_LEFT_PANEL_LABELS.hitDieLetter}${die}`,
      );
    }

    return {
      totalCount,
      availableCount,
      tooltip: tooltipParts.join('\n'),
    };
  });

  const effectiveAC = computed(() => {
    return (
      resolvedStats.value?.armorClass ?? props.actor.system.armorClass.value
    );
  });

  /** Модификатор ловкости для превью AC в модалке */
  const dexModifier = computed(() => {
    return (
      resolvedStats.value?.abilityMods.dexterity
      ?? calculateAbilityModifier(props.actor.system.abilities.dexterity ?? 10)
    );
  });

  /**
   * Разбор класса доспеха по правилам расчёта: без своих бонусов — они у всех
   * веток одни и приписываются к готовой строке.
   *
   * @returns строка разбора
   */
  function buildArmorClassText(): string {
    const calculation = props.actor.system.armorClass.calculation;

    const label =
      ARMOR_CALCULATION_LABELS[calculation] ?? ARMOR_CALCULATION_LABELS.default;

    const effective = effectiveAC.value;
    const dexMod = dexModifier.value;

    switch (calculation) {
      case 'default': {
        // Ищем экипированную броню и щит для информативного тултипа
        const equipped = (props.actor.equipment ?? []).filter(
          (item) =>
            item.equipped
            && item.baseArmorAC
            && item.equipmentCategory !== 'shield',
        );

        const shield = (props.actor.equipment ?? []).find(
          (item) =>
            item.equipped
            && item.equipmentCategory === 'shield'
            && item.baseArmorAC,
        );

        const armor =
          equipped.length > 0
            ? equipped.reduce((best, item) =>
                (item.baseArmorAC ?? 0) > (best.baseArmorAC ?? 0) ? item : best,
              )
            : undefined;

        if (armor) {
          const maxDex = armor.maxDexBonus;

          const effectiveDex =
            maxDex === null || maxDex === undefined
              ? dexMod
              : Math.min(dexMod, maxDex);

          const magicBonus = armor.magicBonus ?? 0;

          const shieldVal = shield
            ? (shield.baseArmorAC ?? 0) + (shield.magicBonus ?? 0)
            : 0;

          let text = `${ACTOR_LEFT_PANEL_LABELS.armorClassPrefix}${effective} = ${armor.baseArmorAC} (${armor.name})`;

          if (effectiveDex !== 0) {
            text += ` + ${effectiveDex}${ACTOR_LEFT_PANEL_LABELS.armorClassDexPart}`;
          }

          if (magicBonus > 0) {
            text += ` + ${magicBonus}${ACTOR_LEFT_PANEL_LABELS.armorClassMagicPart}`;
          }

          if (shieldVal > 0) {
            text += ` + ${shieldVal}${ACTOR_LEFT_PANEL_LABELS.armorClassShieldPart}`;
          }

          return text;
        }

        return `${ACTOR_LEFT_PANEL_LABELS.armorClassPrefix}${effective} = ${BASE_UNARMORED_AC} + ${dexMod}${ACTOR_LEFT_PANEL_LABELS.armorClassDexPart} (${label})`;
      }
      case 'natural': {
        const baseNatural = props.actor.system.armorClass.value;

        return `${ACTOR_LEFT_PANEL_LABELS.armorClassPrefix}${effective} = ${baseNatural} + ${dexMod}${ACTOR_LEFT_PANEL_LABELS.armorClassDexPart} (${label})`;
      }
      case 'flat':
        return `${ACTOR_LEFT_PANEL_LABELS.armorClassPrefix}${effective} (${label})`;
      default:
        return `${ACTOR_LEFT_PANEL_LABELS.armorClassPrefix}${effective} (${label})`;
    }
  }

  /** Подсказка плитки КД: разбор расчёта и свои бонусы к нему */
  const armorClassTooltip = computed(() => {
    const parts = [buildArmorClassText()];

    for (const bonus of props.actor.system.armorClassBonuses ?? []) {
      const label = bonus.label.trim() || CUSTOM_BONUS_LABELS.unnamed;

      parts.push(
        `${label} ${formatSignedNumber(
          getCustomBonusValue(bonusContext.value, bonus),
        )}`,
      );
    }

    return parts.join(' · ');
  });

  // Модалки
  const isProficiencyBonusOpen = ref(false);
  const isArmorClassOpen = ref(false);
  const isHitPointsOpen = ref(false);
  const isDiceRollOpen = ref(false);
  const isArmorProfOpen = ref(false);
  const isWeaponProfOpen = ref(false);
  const isToolsProfOpen = ref(false);
  const isLanguagesProfOpen = ref(false);
  const isSavingThrowSettingsOpen = ref(false);

  /** Настройка окна броска: собирается перед каждым открытием */
  interface DiceRollConfig {
    modifier: number;
    title: string;
    rollLabel: string;
    rollButtonText: string;
    initialRollMode: AttackRollMode;
    autoFail: boolean;
  }

  const diceRollConfig = ref<DiceRollConfig>({
    modifier: 0,
    title: '',
    rollLabel: '',
    rollButtonText: DICE_ROLL_DEFAULT_BUTTON,
    initialRollMode: 'normal',
    autoFail: false,
  });

  /** Открывает окно настройки бонуса мастерства */
  function openProficiencyBonus(): void {
    isProficiencyBonusOpen.value = true;
  }

  /**
   * Применяет настройку бонуса мастерства из окна.
   *
   * @param settings - своя основа и свои бонусы
   */
  function onProficiencySettingsApply(settings: DnDProficiencySettings): void {
    emit('update:actor', {
      system: { ...props.actor.system, proficiencySettings: settings },
    });
  }

  function openArmorClass() {
    isArmorClassOpen.value = true;
  }

  function openHitPoints() {
    isHitPointsOpen.value = true;
  }

  /**
   * Открывает универсальную модалку броска кубиков
   * @param config - конфигурация броска
   * @param config.modifier - модификатор броска
   * @param config.title - заголовок модалки
   * @param config.rollLabel - подпись броска
   * @param config.rollButtonText - текст кнопки броска
   */
  function openDiceRoll(
    config: Partial<DiceRollConfig>
      & Pick<DiceRollConfig, 'modifier' | 'title' | 'rollLabel'>,
  ) {
    diceRollConfig.value = {
      ...config,
      rollButtonText: config.rollButtonText ?? DICE_ROLL_DEFAULT_BUTTON,
      initialRollMode: config.initialRollMode ?? 'normal',
      autoFail: config.autoFail ?? false,
    };

    isDiceRollOpen.value = true;
  }

  function handleSavingThrowClick(ability: {
    key: AbilityType;
    label: string;
  }) {
    if (props.isEditMode) {
      return;
    }

    let initialRollMode: AttackRollMode = 'normal';
    let autoFail = false;

    const flags = resolvedStats.value?.activeFlags ?? new Set();

    const hasAdvantage =
      flags.has(`save.advantage.${ability.key}`) || flags.has('save.advantage');

    const hasDisadvantage =
      flags.has(`save.disadvantage.${ability.key}`)
      || flags.has('save.disadvantage');

    if (flags.has(`save.autoFail.${ability.key}`)) {
      autoFail = true;
    }

    if (hasAdvantage && !hasDisadvantage) {
      initialRollMode = 'advantage';
    }

    if (!hasAdvantage && hasDisadvantage) {
      initialRollMode = 'disadvantage';
    }

    openDiceRoll({
      modifier: calculateSavingThrow(ability.key),
      title: `${SAVING_THROW_ROLL_LABELS.titlePrefix}${ability.label}`,
      rollLabel: `${SAVING_THROW_ROLL_LABELS.rollPrefix}${ability.label}`,
      rollButtonText: SAVING_THROW_ROLL_LABELS.button,
      initialRollMode,
      autoFail,
    });
  }

  /**
   * Применяет класс доспеха из окна: расчёт и свои бонусы правятся там вместе.
   *
   * @param payload - настройка из окна
   * @param payload.armorClass - расчёт класса доспеха
   * @param payload.bonuses - свои бонусы к классу доспеха
   */
  function onArmorClassApply(payload: {
    armorClass: ActorArmorClass;
    bonuses: DnDCustomBonus[];
  }) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        armorClass: payload.armorClass,
        armorClassBonuses: payload.bonuses,
      },
    });
  }

  function onHitPointsApply(data: {
    current: number;
    max: number;
    temp: number;
    classes?: typeof props.actor.system.classes;
    manualHitDice?: Array<{
      die: import('@vtt/shared/system/dnd.js').HitDie;
      total: number;
      used: number;
    }>;
  }) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        hitPoints: {
          current: data.current,
          max: data.max,
          temp: data.temp,
        },
        ...(data.classes ? { classes: data.classes } : {}),
        ...(data.manualHitDice ? { manualHitDice: data.manualHitDice } : {}),
      },
    });
  }

  // Методы
  function calculateSavingThrow(abilityKey: AbilityType): number {
    return resolvedStats.value?.saves[abilityKey] ?? 0;
  }

  /** Итоговые спасброски листа: из них окно берёт вклад активных эффектов */
  const savingThrowValues = computed<Partial<Record<AbilityType, number>>>(
    () => resolvedStats.value?.saves ?? {},
  );

  /** Открывает окно настройки спасбросков */
  function openSavingThrowSettings(): void {
    isSavingThrowSettingsOpen.value = true;
  }

  function toggleSavingThrow(ability: AbilityType) {
    if (!props.isEditMode) {
      return;
    }

    const savingThrows = [...props.actor.system.proficiencies.savingThrows];
    const index = savingThrows.indexOf(ability);

    if (index > -1) {
      savingThrows.splice(index, 1);
    } else {
      savingThrows.push(ability);
    }

    emit('update:actor', {
      system: {
        ...props.actor.system,
        proficiencies: {
          ...props.actor.system.proficiencies,
          savingThrows,
        },
      },
    });
  }

  /**
   * Применяет настройку спасбросков: владения и поправки расчёта приходят из
   * окна вместе — их правят там одной таблицей.
   *
   * @param payload - настройка из окна
   * @param payload.savingThrows - характеристики, спасбросками которых владеют
   * @param payload.settings - поправки расчёта спасбросков
   */
  function onSavingThrowSettingsApply(payload: {
    savingThrows: AbilityType[];
    settings: DnDSavingThrowSettings;
  }) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        savingThrowSettings: payload.settings,
        proficiencies: {
          ...props.actor.system.proficiencies,
          savingThrows: payload.savingThrows,
        },
      },
    });
  }

  /**
   * Применяет выбор владения бронёй из модалки
   */
  function onArmorProfApply(selected: string[]) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        proficiencies: {
          ...props.actor.system.proficiencies,
          armor: selected,
        },
      },
    });
  }

  /**
   * Применяет выбор владения и мастерства оружием из модалки
   */
  function onWeaponProfApply(weapons: string[], masteries: string[]) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        proficiencies: {
          ...props.actor.system.proficiencies,
          weapons,
          weaponMasteries: masteries,
        },
      },
    });
  }

  /**
   * Применяет выбор владения инструментами из модалки
   */
  function onToolsProfApply(selected: string[]) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        proficiencies: {
          ...props.actor.system.proficiencies,
          tools: selected,
        },
      },
    });
  }

  /**
   * Применяет выбор языков из модалки
   */
  function onLanguagesProfApply(selected: string[]) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        proficiencies: {
          ...props.actor.system.proficiencies,
          languages: selected,
        },
      },
    });
  }
</script>

<template>
  <div
    v-bind="$attrs"
    class="flex flex-col gap-3 text-toned"
  >
    <!-- Top Stats Grid -->
    <div class="mb-0 grid grid-cols-2 gap-x-3 gap-y-3">
      <!-- Mastery -->
      <FieldsetLabel
        :label="SHEET_TILE_LABELS.proficiency"
        center
        class="h-12 bg-default/20 transition-colors"
        :class="editableTileClass"
        @click.left.exact.prevent="isEditMode && openProficiencyBonus()"
      >
        <!-- Шестерёнка ведёт в то же окно, что и клик по плитке: значок
          называет настройку, а не прячет её за догадкой -->
        <template
          v-if="isEditMode"
          #actions
        >
          <SheetSettingsGear
            :label="PROFICIENCY_SETTINGS_LABELS.open"
            @open="openProficiencyBonus"
          />
        </template>

        <!-- Подсказка на содержимом, а не на всей плитке: вложенная в неё
          подсказка шестерёнки показалась бы вместе с этой -->
        <UTooltip
          :text="proficiencyTooltip"
          :delay-duration="300"
          :ui="{ content: 'h-auto' }"
        >
          <div class="flex items-center justify-center px-2 pb-2">
            <div class="text-xl font-bold text-highlighted tabular-nums">
              {{ formatSignedNumber(proficiencyBonus) }}
            </div>
          </div>
        </UTooltip>
      </FieldsetLabel>

      <!-- AC -->
      <FieldsetLabel
        :label="armorClassLabel"
        :aria-label="SHEET_TILE_LABELS.armorClass"
        center
        class="h-12 bg-default/20 transition-colors"
        :class="editableTileClass"
        @click.left.exact.prevent="isEditMode && openArmorClass()"
      >
        <template
          v-if="isEditMode"
          #actions
        >
          <SheetSettingsGear
            :label="ARMOR_CLASS_SETTINGS_LABELS.open"
            @open="openArmorClass"
          />
        </template>

        <UTooltip
          :text="armorClassTooltip"
          :delay-duration="300"
          :ui="{ content: 'h-auto' }"
        >
          <div class="flex items-center justify-center px-2 pb-2">
            <span class="text-xl font-bold text-highlighted">{{
              effectiveAC
            }}</span>
          </div>
        </UTooltip>
      </FieldsetLabel>
    </div>

    <!-- Здоровье + Кости хитов -->
    <FieldsetLabel
      :label="SHEET_TILE_LABELS.hitPoints"
      class="group bg-default/20 transition-colors"
      :class="hitPointsBlockClass"
      @click.left.exact.prevent="openHitPoints()"
    >
      <template
        v-if="isEditMode"
        #actions
      >
        <SheetSettingsGear
          :label="HIT_POINTS_LABELS.open"
          @open="openHitPoints"
        />
      </template>

      <!-- ХП: цифры + подписи -->
      <div class="p-3 pt-1">
        <div class="flex items-center">
          <span
            class="flex-1 text-center text-xl font-bold text-highlighted tabular-nums"
            >{{ actor.system.hitPoints?.current ?? 0 }}</span
          >

          <span class="w-3 text-center font-light text-dimmed">/</span>

          <span
            class="flex-1 text-center text-xl font-bold text-muted tabular-nums"
            >{{ maxHitPoints }}</span
          >

          <div class="mx-2 h-6 w-px bg-elevated" />

          <span
            class="flex-1 text-center text-xl font-bold tabular-nums"
            :class="
              (actor.system.hitPoints?.temp ?? 0) > 0
                ? 'text-primary/80'
                : 'text-dimmed'
            "
            >{{ actor.system.hitPoints?.temp ?? 0 }}</span
          >
        </div>

        <div class="mt-0.5 flex items-center">
          <span
            class="flex-1 text-center text-[9px] font-medium tracking-wider text-dimmed uppercase"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.hitPointsCurrent }}
          </span>

          <span class="w-3" />

          <span
            class="flex-1 text-center text-[9px] font-medium tracking-wider text-dimmed uppercase"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.hitPointsTotal }}
          </span>

          <div class="mx-2 w-px" />

          <span
            class="flex-1 text-center text-[9px] font-medium tracking-wider text-dimmed uppercase"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.hitPointsTemporary }}
          </span>
        </div>
      </div>

      <!-- Разделитель -->
      <div class="border-t border-muted" />

      <!-- Кости хитов -->
      <UTooltip :delay-duration="300">
        <div class="flex items-center justify-between px-3 py-1.5">
          <span
            class="text-[10px] font-bold tracking-wider text-dimmed uppercase"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.hitDice }}
          </span>

          <span class="text-sm font-bold text-toned tabular-nums">
            {{ hitDiceSummary.availableCount }}
            <span class="font-light text-dimmed"
              >/ {{ hitDiceSummary.totalCount }}</span
            >
          </span>
        </div>

        <template #content>
          <div class="flex flex-col gap-0.5">
            <div
              v-for="line in hitDiceSummary.tooltip.split('\n')"
              :key="line"
            >
              {{ line }}
            </div>
          </div>
        </template>
      </UTooltip>
    </FieldsetLabel>

    <!-- Истощение: сразу под здоровьем — степень штрафует все тесты к20 и
      скорость, и читается она вместе с хитами, а не на отдельной вкладке -->
    <ExhaustionPanel
      :level="exhaustionLevel"
      :is-edit-mode="isEditMode"
      @select="handleExhaustionSelect"
    />

    <!-- Спасброски -->
    <FieldsetLabel
      :label="GRANT_SECTION_LABELS.savingThrows"
      class="bg-default/20 transition-colors"
      :class="blockClass"
    >
      <!-- Шестерёнка ведёт в настройку расчёта: кружки в самом блоке ставят
        только владение, а характеристику спасброска и свои бонусы правят в
        окне. Вне правки листа её нет — настраивать там нечего -->
      <template
        v-if="isEditMode"
        #actions
      >
        <SheetSettingsGear
          :label="SAVING_THROW_SETTINGS_LABELS.open"
          @open="openSavingThrowSettings"
        />
      </template>

      <div class="px-2 pb-1">
        <div class="grid grid-cols-2 gap-x-2 gap-y-1">
          <div
            v-for="ability in SAVING_THROW_ABILITIES"
            :key="ability.key"
            class="flex cursor-pointer items-center gap-2 rounded p-1.5 transition-colors hover:bg-elevated"
            @click.left.exact.prevent="handleSavingThrowClick(ability)"
          >
            <button
              class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
              :class="
                actor.system.proficiencies.savingThrows.includes(ability.key)
                  ? 'border-primary bg-primary'
                  : 'border-accented bg-transparent'
              "
              @click.left.exact.prevent="
                isEditMode && toggleSavingThrow(ability.key)
              "
            />

            <span class="flex-1 truncate text-sm font-medium text-toned">{{
              ability.shortLabel
            }}</span>

            <span
              class="rounded border border-default bg-elevated px-2 py-0.5 text-sm font-bold text-highlighted shadow-sm"
            >
              {{ formatSignedNumber(calculateSavingThrow(ability.key)) }}
            </span>
          </div>
        </div>
      </div>
    </FieldsetLabel>

    <!-- Владения & Прочее (Броня, Оружие, Инструменты, Языки) -->
    <div
      class="space-y-5 rounded-lg border bg-default/20 p-2 transition-colors"
      :class="blockClass"
    >
      <!-- Броня -->
      <div>
        <div
          class="mb-2 flex items-center justify-between rounded-lg bg-elevated/40 px-3 py-2"
        >
          <h4
            class="text-xs font-bold tracking-wider text-highlighted uppercase"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.equipment }}
          </h4>

          <SheetSettingsGear
            v-if="isEditMode"
            :label="PROFICIENCY_MODAL_LABELS.armorOpen"
            @open="isArmorProfOpen = true"
          />
        </div>

        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="badge in armorProfBadges"
            :key="badge"
            :label="badge"
            color="neutral"
            variant="subtle"
          />

          <span
            v-if="armorProfBadges.length === 0"
            class="text-xs text-dimmed italic"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.empty }}
          </span>
        </div>
      </div>

      <!-- Оружие -->
      <div>
        <div
          class="mb-2 flex items-center justify-between rounded-lg bg-elevated/40 px-3 py-2"
        >
          <h4
            class="text-xs font-bold tracking-wider text-highlighted uppercase"
          >
            {{ GRANT_SECTION_LABELS.weapons }}
          </h4>

          <SheetSettingsGear
            v-if="isEditMode"
            :label="PROFICIENCY_MODAL_LABELS.weaponsOpen"
            @open="isWeaponProfOpen = true"
          />
        </div>

        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="badge in weaponProfBadges"
            :key="badge.label"
            :label="badge.label"
            color="neutral"
            variant="subtle"
          >
            <template
              v-if="badge.hasMastery"
              #trailing
            >
              <UIcon
                name="tabler:medal"
                class="h-3.5 w-3.5 text-healing"
              />
            </template>
          </UBadge>

          <span
            v-if="weaponProfBadges.length === 0"
            class="text-xs text-dimmed italic"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.empty }}
          </span>
        </div>
      </div>

      <!-- Инструменты -->
      <div>
        <div
          class="mb-2 flex items-center justify-between rounded-lg bg-elevated/40 px-3 py-2"
        >
          <h4
            class="text-xs font-bold tracking-wider text-highlighted uppercase"
          >
            {{ GRANT_SECTION_LABELS.tools }}
          </h4>

          <SheetSettingsGear
            v-if="isEditMode"
            :label="PROFICIENCY_MODAL_LABELS.toolsOpen"
            @open="isToolsProfOpen = true"
          />
        </div>

        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="tool in toolProfBadges"
            :key="tool"
            :label="tool"
            color="neutral"
            variant="subtle"
          />

          <span
            v-if="actor.system.proficiencies.tools.length === 0"
            class="text-xs text-dimmed italic"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.empty }}
          </span>
        </div>
      </div>

      <!-- Языки -->
      <div>
        <div
          class="mb-2 flex items-center justify-between rounded-lg bg-elevated/40 px-3 py-2"
        >
          <h4
            class="text-xs font-bold tracking-wider text-highlighted uppercase"
          >
            {{ GRANT_SECTION_LABELS.languages }}
          </h4>

          <SheetSettingsGear
            v-if="isEditMode"
            :label="PROFICIENCY_MODAL_LABELS.languagesOpen"
            @open="isLanguagesProfOpen = true"
          />
        </div>

        <div class="flex flex-wrap gap-1.5">
          <UBadge
            v-for="language in actor.system.proficiencies.languages"
            :key="language"
            :label="language"
            color="neutral"
            variant="subtle"
          />

          <span
            v-if="actor.system.proficiencies.languages.length === 0"
            class="text-xs text-dimmed italic"
          >
            {{ ACTOR_LEFT_PANEL_LABELS.empty }}
          </span>
        </div>
      </div>
    </div>
  </div>

  <!-- Модалка класса доспеха -->
  <ArmorClassModal
    v-model:open="isArmorClassOpen"
    :armor-class="actor.system.armorClass"
    :bonuses="actor.system.armorClassBonuses"
    :context="bonusContext"
    :dex-modifier="dexModifier"
    @apply="onArmorClassApply"
  />

  <!-- Модалка очков здоровья -->
  <HitPointsModal
    v-model:open="isHitPointsOpen"
    :current-hit-points="actor.system.hitPoints?.current ?? 0"
    :max-hit-points="maxHitPoints"
    :temp-hit-points="actor.system.hitPoints?.temp ?? 0"
    :classes="actor.system.classes ?? []"
    :manual-hit-dice="actor.system.manualHitDice ?? []"
    @apply="onHitPointsApply"
  />

  <!-- Универсальная модалка броска -->
  <DiceRollModal
    v-model:open="isDiceRollOpen"
    :modifier="diceRollConfig.modifier"
    :title="diceRollConfig.title"
    :roll-label="diceRollConfig.rollLabel"
    :roll-button-text="diceRollConfig.rollButtonText"
    :initial-roll-mode="diceRollConfig.initialRollMode"
    :auto-fail="diceRollConfig.autoFail"
  />

  <!-- Модалка владения бронёй -->
  <ArmorProficiencyModal
    v-model:open="isArmorProfOpen"
    :selected="actor.system.proficiencies.armor"
    @apply="onArmorProfApply"
  />

  <!-- Модалка владения и мастерства оружием -->
  <WeaponProficiencyModal
    v-model:open="isWeaponProfOpen"
    :selected-weapons="actor.system.proficiencies.weapons"
    :selected-masteries="actor.system.proficiencies.weaponMasteries ?? []"
    @apply="onWeaponProfApply"
  />

  <!-- Модалка владения инструментами -->
  <ToolProficiencyModal
    v-model:open="isToolsProfOpen"
    :selected="actor.system.proficiencies.tools"
    @apply="onToolsProfApply"
  />

  <!-- Модалка владения языками -->
  <LanguageProficiencyModal
    v-model:open="isLanguagesProfOpen"
    :selected="actor.system.proficiencies.languages"
    @apply="onLanguagesProfApply"
  />

  <!-- Модалка настройки бонуса мастерства -->
  <ProficiencyBonusModal
    v-model:open="isProficiencyBonusOpen"
    :settings="proficiencySettings"
    :ability-mods="sheetAbilityMods"
    :rule-value="ruleProficiencyBonus"
    :rule-title="proficiencyRuleTitle"
    :sheet-value="proficiencyBonus"
    @apply="onProficiencySettingsApply"
  />

  <!-- Модалка настройки спасбросков -->
  <SavingThrowSettingsModal
    v-model:open="isSavingThrowSettingsOpen"
    :saving-throws="actor.system.proficiencies.savingThrows"
    :settings="actor.system.savingThrowSettings"
    :ability-mods="sheetAbilityMods"
    :proficiency-bonus="proficiencyBonus"
    :saves="savingThrowValues"
    @apply="onSavingThrowSettingsApply"
  />
</template>
