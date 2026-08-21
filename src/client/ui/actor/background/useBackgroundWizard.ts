import type { Ref } from 'vue';

import type { AbilityType, Feature, TypedWebSocketClient } from '@vtt/shared';
import type {
  ActorBackgroundEntry,
  AppliedFeatMeta,
  BackgroundDefinition,
  DnDActor,
  DnDActorSystem,
  FeatChoice,
  FeatData,
  ResolvedGrantedSpell,
} from '@vtt/shared/system/dnd.js';

import { computed, ref, watch } from 'vue';

import { generateId, pushUnique, typedObjectEntries } from '@vtt/shared';
import {
  appendGrantedSpells,
  applyFeatChoiceSelections,
  BACKGROUND_ORIGIN_PREFIX,
  buildFeatGrantEffect,
  calculateProficiencyBonus,
  classKeyFromUrl,
  collectFeatChoiceProficiencies,
  getTotalLevel,
  getVisibleFeatChoices,
  normalizeBackgroundDefinition,
  prepareFeatChoices,
  prepareTransferredFeatEffects,
  resolveBackgroundFeatClassKey,
  resolveChosenAbilities,
  resolveChosenResistances,
  resolveFeatChoiceCount,
  resolveFeatChoicePool,
} from '@vtt/shared/system/dnd.js';

import { useFeatChoiceSpells } from '../../../composables/useFeatChoiceSpells';
import {
  rollbackBackgroundEffects,
  rollbackBackgroundFeatures,
  rollbackBackgroundGrantedSpells,
  rollbackBackgroundProficiencies,
} from './backgroundRollback';

export type BackgroundWizardStep =
  'overview' | 'featChoices' | 'tools' | 'abilities' | 'equipment';

/**
 * Имя-источник заклинаний, выданных СОБСТВЕННЫМ `featData` предыстории —
 * отличное от имени черты-происхождения, чтобы откат снимал их раздельно. Тот же
 * формат используется при резолве источников в `BackgroundSetupWizard`.
 *
 * @param backgroundName - название предыстории
 */
export function backgroundSpellSource(backgroundName: string): string {
  return `Предыстория: ${backgroundName}`;
}

/**
 * Поднимает тёмное зрение токена до `darkvision` (не понижает — у тёмного зрения
 * может быть другой источник). Возвращает обновлённый токен или `undefined`,
 * если поднимать нечего. По образцу `featApply.applyFeatDarkvision`.
 *
 * @param token - текущие настройки токена
 * @param darkvision - тёмное зрение предыстории (футы)
 */
function applyBackgroundDarkvision(
  token: DnDActor['token'],
  darkvision: number,
): DnDActor['token'] | undefined {
  if (darkvision <= 0) {
    return undefined;
  }

  const next: NonNullable<DnDActor['token']> = JSON.parse(
    JSON.stringify(token ?? {}),
  );

  if (!next.vision) {
    next.vision = { enabled: true, range: 60, darkvision: 0, angle: 360 };
  }

  if (darkvision <= next.vision.darkvision) {
    return undefined;
  }

  next.vision.darkvision = darkvision;

  return next;
}

export function useBackgroundWizard(
  backgroundDefinitionRef: Ref<BackgroundDefinition | null>,
  actorRef: Ref<DnDActor>,
  isOpenRef: Ref<boolean>,
  socketRef: Ref<TypedWebSocketClient | null>,
) {
  /**
   * Определение с достроенными блоками даров: записи компендиума отдают
   * `toolGrant`/`skillGrant`/`abilityGrant`/`featGrant`/`equipmentOptions`
   * частично (в паках TTG Club `toolGrant` не приходит вовсе), а мастер и его
   * шаги читают их напрямую. Возвращается наружу — шаги должны получать ровно
   * то же определение, с которым работает мастер.
   */
  const definition = computed(() =>
    normalizeBackgroundDefinition(backgroundDefinitionRef.value),
  );

  // --- Состояние ---
  const currentStepInfo = ref<{
    stepGroup: BackgroundWizardStep;
    index: number;
    total: number;
  }>({
    stepGroup: 'overview',
    index: 1,
    total: 3,
  });

  const selectedScheme = ref<'+2/+1' | '+1/+1/+1'>('+2/+1');
  const abilityAllocation = ref<Partial<Record<AbilityType, number>>>({});
  /** Выбранное из собственного списка предыстории (`toolGrant.choices`) */
  const toolSelections = ref<string[]>([]);
  /** Ключи, разобранные из текстового владения компендиума (`toolGrant.items`) */
  const grantedTools = ref<string[]>([]);
  /** Разобрано ли текстовое владение полностью — сообщает шаг инструментов */
  const grantComplete = ref(true);
  const selectedFeatId = ref<string>('');
  /**
   * Выборы внутри черты, которую даёт предыстория («Умелый» просит три навыка).
   * Ключ выбора → выбранные значения; сбрасывается при смене самой черты.
   */
  const selectedFeatChoices = ref<Record<string, string[]>>({});
  /**
   * Дары черты, которую даёт предыстория. Заполняет мастер, когда подгрузит
   * компендиум черт: сама composable компендиума не читает — так же, как ключи
   * инструментов ей приносит шаг владений.
   */
  const grantedFeatData = ref<FeatData | null>(null);

  /**
   * Выборы выданной черты в том виде, в каком их задают игроку: с вопросом про
   * класс у черт, где его в записи нет, и в порядке «класс → заклинания →
   * характеристика».
   */
  const preparedFeatChoices = computed<FeatChoice[]>(() =>
    prepareFeatChoices(grantedFeatData.value?.choices),
  );

  /**
   * Класс, названный самой предысторией: «Мудрец» даёт «Посвящённого в магию
   * (Волшебник)». Пусто — класс называет игрок.
   */
  const namedClassKeys = computed<string[]>(() => {
    const key = resolveBackgroundFeatClassKey(definition.value?.featGrant);

    return key ? [key] : [];
  });

  /**
   * Выборы списка класса, за которые ответила предыстория. Названного класса
   * среди вариантов нет — выбор остаётся за игроком: иначе черта получила бы
   * список, которого в ней не перечислено.
   */
  const namedClassChoices = computed<FeatChoice[]>(() =>
    preparedFeatChoices.value.filter(
      (choice) =>
        choice.type === 'spellList'
        && (choice.options ?? []).some((option) =>
          namedClassKeys.value.includes(classKeyFromUrl(option.value) ?? ''),
        ),
    ),
  );

  /**
   * Выборы, которые мастер вообще спрашивает: без тех, на которые ответила сама
   * предыстория. Спрашивать класс второй раз значит предлагать игроку передумать
   * за неё.
   */
  const askedFeatChoices = computed<FeatChoice[]>(() => {
    const answered = new Set(
      namedClassChoices.value.map((choice) => choice.key),
    );

    return preparedFeatChoices.value.filter(
      (choice) => !answered.has(choice.key),
    );
  });

  /** Выборы, которые спрошены прямо сейчас: остальные ждут ответа про класс. */
  const visibleFeatChoices = computed<FeatChoice[]>(() =>
    getVisibleFeatChoices(askedFeatChoices.value, selectedFeatChoices.value),
  );

  // Ответ за игрока: предыстория назвала класс, пикер его не показывает — но
  // ответ обязан лежать в общем наборе. По нему сужается пул заклинаний, и без
  // него лист потом не сузил бы его до названного предысторией класса.
  //
  // Ответы в источниках потому, что их сбрасывает и смена черты, и закрытие окна:
  // без пересмотра ответ пропал бы, а список выборов при этом не изменился бы.
  // Цикл обрывает `hasNewAnswer`: второй проход находит ответ уже записанным и
  // ничего не пишет.
  watch(
    [namedClassChoices, selectedFeatChoices],
    ([choices]) => {
      const answered = { ...selectedFeatChoices.value };

      let hasNewAnswer = false;

      for (const choice of choices) {
        const named = (choice.options ?? []).find((option) =>
          namedClassKeys.value.includes(classKeyFromUrl(option.value) ?? ''),
        );

        if (
          named
          && selectedFeatChoices.value[choice.key]?.[0] !== named.value
        ) {
          answered[choice.key] = [named.value];
          hasNewAnswer = true;
        }
      }

      if (hasNewAnswer) {
        selectedFeatChoices.value = answered;
      }
    },
    { immediate: true },
  );

  /**
   * Заклинания каталога для выборов черты. Загружаются здесь, а не в окне: пул
   * выбора и проверка «все ли ответы даны» обязаны смотреть на один и тот же
   * список, иначе шаг считался бы завершённым при незаполненном выборе.
   */
  const { spells: featChoiceSpells } = useFeatChoiceSpells(
    socketRef,
    preparedFeatChoices,
  );

  /**
   * Выбранный вариант стартового снаряжения; `null` — не выбран. Выбирать есть
   * что только у вариантов с позициями, поэтому шаг не блокирует переход.
   */
  const selectedEquipmentIndex = ref<number | null>(null);

  const wizardSteps = computed<BackgroundWizardStep[]>(() => {
    const def = definition.value;

    if (!def) {
      return ['overview', 'abilities', 'equipment'];
    }

    const steps: BackgroundWizardStep[] = ['overview'];

    // Выборы внутри выданной черты — сразу за её выбором: пул «Знатока» зависит
    // от того, чем персонаж уже владеет, и спрашивать раньше нечего. Шага нет,
    // когда спрашивать нечего: у «Мудреца» класс называет сама предыстория
    if (askedFeatChoices.value.length > 0) {
      steps.push('featChoices');
    }

    // Шаг инструментов нужен и когда есть выбор из своего списка (homebrew из
    // панели «Предметы»), и когда компендиум прислал владение текстом: его надо
    // сопоставить со словарём, а неузнанное — предложить завести.
    if (
      (def.toolGrant.choices && def.toolGrant.choices.count > 0)
      || def.toolGrant.items.length > 0
    ) {
      steps.push('tools');
    }

    steps.push('abilities', 'equipment');

    return steps;
  });

  function resetState() {
    selectedScheme.value = '+2/+1';
    abilityAllocation.value = {};
    toolSelections.value = [];
    grantedTools.value = [];
    grantComplete.value = true;
    selectedFeatId.value = '';
    selectedFeatChoices.value = {};
    selectedEquipmentIndex.value = null;

    const def = definition.value;

    if (def) {
      // `toolGrant.items` — НЕ готовые ключи: компендиум присылает владение
      // человекочитаемым текстом. Разбирает его шаг инструментов, здесь список
      // остаётся пустым, иначе текст уехал бы на лист персонажа как ключ.
      if (def.featGrant.featId) {
        selectedFeatId.value = def.featGrant.featId;
      } else if (def.featGrant.featChoices?.length) {
        selectedFeatId.value = def.featGrant.featChoices[0];
      }
    }

    currentStepInfo.value = {
      stepGroup: wizardSteps.value[0],
      index: 1,
      total: wizardSteps.value.length,
    };
  }

  // Инициализация при смене предыстории
  watch(
    () => definition.value?.key,
    () => {
      resetState();
    },
    { immediate: true },
  );

  // Сброс при закрытии окна
  watch(
    () => isOpenRef.value,
    (isOpen) => {
      if (!isOpen) {
        resetState();
      }
    },
  );

  // Вычисляемое свойство: можно ли перейти дальше
  const canProceed = computed(() => {
    const def = definition.value;

    if (!def) {
      return false;
    }

    if (currentStepInfo.value.stepGroup === 'overview') {
      if (def.featGrant.featChoices?.length && !selectedFeatId.value) {
        return false;
      }
    }

    if (currentStepInfo.value.stepGroup === 'featChoices') {
      const bonus = calculateProficiencyBonus(
        getTotalLevel(actorRef.value.system.classes),
      );

      // Спрошенные и показанные: выбор заклинания, ждущий ответа про класс, ещё
      // не показан — требовать ответа на него значило бы запереть шаг
      const incomplete = visibleFeatChoices.value.some((choice) => {
        const pool = resolveFeatChoicePool(choice, actorRef.value, {
          spells: featChoiceSpells.value,
          selections: selectedFeatChoices.value,
          namedClassKeys: namedClassKeys.value,
        });

        if (pool.length === 0) {
          return false;
        }

        const max = Math.min(
          resolveFeatChoiceCount(choice, bonus),
          pool.length,
        );

        return (selectedFeatChoices.value[choice.key]?.length ?? 0) < max;
      });

      if (incomplete) {
        return false;
      }
    }

    if (currentStepInfo.value.stepGroup === 'tools') {
      const neededCounts = def.toolGrant.choices?.count ?? 0;

      if (toolSelections.value.length !== neededCounts) {
        return false;
      }

      if (!grantComplete.value) {
        return false;
      }
    }

    if (currentStepInfo.value.stepGroup === 'abilities') {
      const values = Object.values(abilityAllocation.value);

      const totalAllocated = values.reduce(
        (sum, val) => (sum ?? 0) + (val ?? 0),
        0,
      );

      // Для обеих схем в сумме должно быть 3 очка (2+1=3, 1+1+1=3)
      if (totalAllocated !== 3) {
        return false;
      }

      // Проверка структуры: для 2/1 должно быть ровно 2 стата (один 2, другой 1)
      if (selectedScheme.value === '+2/+1') {
        const hasTwo = values.includes(2);
        const hasOne = values.includes(1);

        return hasTwo && hasOne && values.length === 2;
      }

      // Для 1/1/1 должно быть ровно 3 стата по 1
      if (selectedScheme.value === '+1/+1/+1') {
        return values.length === 3 && values.every((value) => value === 1);
      }
    }

    return true;
  });

  // Навигация
  function nextStep() {
    if (!canProceed.value) {
      return;
    }

    const steps = wizardSteps.value;
    const currentIndex = steps.indexOf(currentStepInfo.value.stepGroup);

    if (currentIndex < steps.length - 1) {
      const nextGroup = steps[currentIndex + 1];

      currentStepInfo.value = {
        stepGroup: nextGroup,
        index: currentIndex + 2,
        total: steps.length,
      };
    }
  }

  function previousStep() {
    const steps = wizardSteps.value;
    const currentIndex = steps.indexOf(currentStepInfo.value.stepGroup);

    if (currentIndex > 0) {
      const prevGroup = steps[currentIndex - 1];

      currentStepInfo.value = {
        stepGroup: prevGroup,
        index: currentIndex,
        total: steps.length,
      };
    }
  }

  /**
   * Позиции выбранного варианта снаряжения. Пусто — выбирать было нечего или
   * вариант не выбран; тогда мастер инвентарь не трогает.
   */
  const selectedEquipmentItems = computed(() => {
    const index = selectedEquipmentIndex.value;

    if (index === null) {
      return [];
    }

    return definition.value?.equipmentOptions?.[index]?.items ?? [];
  });

  /**
   * Применяет выбранные данные и формирует updates для актора.
   * Если у актора уже есть предыстория — откатывает все её бонусы
   * (характеристики, навыки, инструменты, черту, granted-заклинания черты)
   * перед применением новой.
   *
   * @param srdFeats Полный список черт из SRD feats.json
   * @param resolvedGrantedSpells granted-заклинания выбранной черты,
   * сопоставленные с данными компендиума
   */
  function buildUpdates(
    srdFeats: Feature[],
    resolvedGrantedSpells: ResolvedGrantedSpell[] = [],
  ) {
    const def = definition.value;

    if (!def) {
      return { systemUpdates: {}, rootUpdates: {} };
    }

    const system: DnDActorSystem = actorRef.value.system;

    const previousBackground = system.background;

    // --- Откат предыдущей предыстории ---
    const rolledBackProficiencies = rollbackBackgroundProficiencies(
      system.proficiencies,
      previousBackground,
    );

    const baseSkills = rolledBackProficiencies.skills;
    const baseTools = rolledBackProficiencies.tools;
    const baseSavingThrows = rolledBackProficiencies.savingThrows;
    const baseArmor = rolledBackProficiencies.armor;
    const baseWeapons = rolledBackProficiencies.weapons;
    const baseLanguages = rolledBackProficiencies.languages;

    const baseFeatures = rollbackBackgroundFeatures(
      actorRef.value.features ?? [],
      previousBackground,
    );

    // Снимаем эффекты прежней предыстории: и её собственные (бонус
    // характеристик, дары), и эффекты выданной ею черты.
    const baseEffects = rollbackBackgroundEffects(
      actorRef.value.activeEffects ?? [],
      previousBackground,
    );

    // --- Применение новой предыстории ---

    // 1. Добавляем навыки
    for (const skill of def.skillGrant.skills) {
      if (!baseSkills[skill]) {
        baseSkills[skill] = 'proficient';
      }
    }

    // 2. Добавляем инструменты: выбранное из своего списка и разобранное из
    // текстового владения компендиума.
    for (const tool of [...toolSelections.value, ...grantedTools.value]) {
      if (!baseTools.includes(tool)) {
        baseTools.push(tool);
      }
    }

    // 3. Добавляем черту
    const grantedFeatId = generateId('feat');

    const srdFeat = srdFeats.find((feat) => feat.id === selectedFeatId.value);

    let grantedFeatName = def.featGrant.featName;

    if (srdFeat) {
      grantedFeatName = srdFeat.name;

      // Уровень взятия и сделанные выборы живут на самой особенности: по первому
      // считается прибавка к хитам, по вторым видно, что игрок выбрал. Метка
      // предыстории говорит, откуда черта взялась, — сама она остаётся обычной
      // чертой со своим провенансом
      const applied: Feature & AppliedFeatMeta = {
        ...srdFeat,
        id: grantedFeatId,
        featureType: 'feat',
        acquisitionLevel: getTotalLevel(actorRef.value.system.classes),
        grantedByBackgroundKey: def.key,
        ...(Object.keys(selectedFeatChoices.value).length > 0
          ? { choices: { ...selectedFeatChoices.value } }
          : {}),
      };

      baseFeatures.push(applied);
    } else {
      const fallbackFeat: Feature & AppliedFeatMeta = {
        id: grantedFeatId,
        name: def.featGrant.featName,
        nameEn: def.featGrant.featNameEn || '',
        description: '', // Больше не храним fallback описание
        featureType: 'feat',
        isSRD: !!def.isSRD,
        grantedByBackgroundKey: def.key,
      };

      baseFeatures.push(fallbackFeat);
    }

    // 4. Создаём Active Effect для бонусов характеристик от предыстории
    const abilityChanges: import('@vtt/shared/system/dnd.js').EffectChange[] =
      [];

    for (const [abilityKey, bonus] of typedObjectEntries<AbilityType, number>(
      abilityAllocation.value,
    )) {
      if (bonus && bonus > 0) {
        abilityChanges.push({
          key: `ability.${abilityKey}`,
          mode: 'add',
          value: String(bonus),
          priority: 10,
        });
      }
    }

    if (abilityChanges.length > 0) {
      baseEffects.push({
        id: generateId('eff'),
        name: `Предыстория: ${def.name}`,
        description: `Бонусы характеристик от предыстории «${def.name}»`,
        icon: 'tabler:book',
        disabled: false,
        origin: 'feature',
        originId: `background:${def.key}`,
        transfer: false,
        duration: { type: 'permanent' },
        changes: abilityChanges,
        flags: [],
      });
    }

    // 4.5. Применяем СОБСТВЕННЫЕ расширенные дары предыстории (featData):
    // владения, защиты/иммунитеты, тёмное зрение, авторские эффекты — по образцу
    // черты, но с провенансом background:<key> (характеристики и навыки идут
    // каноническими полями, поэтому featData ASI/навыков у фона пуст).
    const featData = def.featData ?? null;

    // Безусловные дары ВЫДАННОЙ ЧЕРТЫ идут в те же списки, что и дары самой
    // предыстории: их снимает замена предыстории по записи в `entry`.
    const grantedFeat = grantedFeatData.value;

    const extraSkills = [
      ...(featData?.skillProficiencies ?? []),
      ...(grantedFeat?.skillProficiencies ?? []),
    ];

    const extraSaves = [
      ...(featData?.savingThrowProficiencies ?? []),
      ...(grantedFeat?.savingThrowProficiencies ?? []),
    ];

    const extraArmor = [
      ...(featData?.armorProficiencies ?? []),
      ...(grantedFeat?.armorProficiencies ?? []),
    ];

    const extraWeapons = [
      ...(featData?.weaponProficiencies ?? []),
      ...(grantedFeat?.weaponProficiencies ?? []),
    ];

    const extraTools = [
      ...(featData?.toolProficiencies ?? []),
      ...(grantedFeat?.toolProficiencies ?? []),
    ];

    const extraLanguages = [
      ...(featData?.languages ?? []),
      ...(grantedFeat?.languages ?? []),
    ];

    for (const skill of extraSkills) {
      baseSkills[skill] = 'proficient';
    }

    pushUnique(baseSavingThrows, extraSaves);
    pushUnique(baseArmor, extraArmor);
    pushUnique(baseWeapons, extraWeapons);
    pushUnique(baseTools, extraTools);
    pushUnique(baseLanguages, extraLanguages);

    // Выбранное игроком проставляет движок выборов: уровень владения знает
    // только он (обычное владение или компетентность — по данным самой черты).
    applyFeatChoiceSelections(
      {
        skills: baseSkills,
        savingThrows: baseSavingThrows,
        tools: baseTools,
        languages: baseLanguages,
        weapons: baseWeapons,
        armor: baseArmor,
        weaponMasteries: [],
      },
      grantedFeat,
      selectedFeatChoices.value,
      actorRef.value,
    );

    // ...а в запись предыстории они попадают списком — по нему замена снимет
    // выданное, не разбирая, что именно было выбрано
    const chosen = collectFeatChoiceProficiencies(
      grantedFeat,
      selectedFeatChoices.value,
    );

    extraSkills.push(...chosen.skills);
    extraSaves.push(...chosen.savingThrows);
    extraWeapons.push(...chosen.weapons);
    extraTools.push(...chosen.tools);
    extraLanguages.push(...chosen.languages);

    const grantEffect = buildFeatGrantEffect(def.key, def.name, featData, {
      originPrefix: BACKGROUND_ORIGIN_PREFIX,
      namePrefix: 'Предыстория',
      noun: 'предыстории',
      icon: 'tabler:book',
    });

    if (grantEffect) {
      baseEffects.push(grantEffect);
    }

    // Эффект даров выданной черты — с ЕЁ СОБСТВЕННЫМ провенансом (`feat:<id>`):
    // черта остаётся чертой, а связь с предысторией держит метка
    // `grantedByBackgroundKey` на самой особенности. По ней замена предыстории
    // снимает и черту, и её эффекты (см. откат выше).
    const featGrantEffect = buildFeatGrantEffect(
      grantedFeatId,
      grantedFeatName,
      grantedFeat,
      {},
      {
        acquisitionLevel: getTotalLevel(actorRef.value.system.classes),
        walkSpeed: actorRef.value.system.movement?.walk,
        chosenResistances: resolveChosenResistances(
          grantedFeat,
          selectedFeatChoices.value,
        ),
        chosenAbilities: resolveChosenAbilities(
          grantedFeat,
          selectedFeatChoices.value,
        ),
      },
    );

    if (featGrantEffect) {
      baseEffects.push(featGrantEffect);
    }

    baseEffects.push(
      ...prepareTransferredFeatEffects(
        def.key,
        def.activeEffects,
        BACKGROUND_ORIGIN_PREFIX,
      ),
    );

    // Тёмное зрение: берём наибольшее из своего и того, что даёт выданная черта
    const darkvision = Math.max(
      featData?.darkvision ?? 0,
      grantedFeat?.darkvision ?? 0,
    );

    const updatedToken = applyBackgroundDarkvision(
      actorRef.value.token,
      darkvision,
    );

    const ownGrantedSpellSource =
      featData?.grantedSpells && featData.grantedSpells.length > 0
        ? backgroundSpellSource(def.name)
        : undefined;

    // 5. Формируем запись предыстории (с применёнными расширенными дарами —
    // для точного отката при замене/удалении).
    const entry: ActorBackgroundEntry = {
      backgroundKey: def.key,
      backgroundName: def.name,
      abilityChoices: { ...abilityAllocation.value },
      skillChoices: [...def.skillGrant.skills],
      toolChoices: [...toolSelections.value, ...grantedTools.value],
      grantedFeatId,
      grantedFeatName,
    };

    if (extraSkills.length > 0) {
      entry.extraSkillProficiencies = [...extraSkills];
    }

    if (extraSaves.length > 0) {
      entry.savingThrowProficiencies = [...extraSaves];
    }

    if (extraArmor.length > 0) {
      entry.armorProficiencies = [...extraArmor];
    }

    if (extraWeapons.length > 0) {
      entry.weaponProficiencies = [...extraWeapons];
    }

    if (extraTools.length > 0) {
      entry.extraToolProficiencies = [...extraTools];
    }

    if (extraLanguages.length > 0) {
      entry.languages = [...extraLanguages];
    }

    if (ownGrantedSpellSource) {
      entry.ownGrantedSpellSource = ownGrantedSpellSource;
    }

    if (updatedToken && darkvision > 0) {
      entry.darkvisionApplied = darkvision;
    }

    // 6. Granted-заклинания: откатываем заклинания предыдущей предыстории
    // (и черты-происхождения, и собственного featData) и добавляем новые.
    const originalSpells = actorRef.value.spells ?? [];

    let updatedSpells = [...originalSpells];

    updatedSpells = rollbackBackgroundGrantedSpells(
      updatedSpells,
      previousBackground,
    );

    updatedSpells = appendGrantedSpells(updatedSpells, resolvedGrantedSpells);

    // Сравнение по длине недостаточно: удаление и добавление могут совпасть
    // по количеству, поэтому дополнительно сверяем ссылки поэлементно
    const spellsChanged =
      updatedSpells.length !== originalSpells.length
      || updatedSpells.some((spell, index) => spell !== originalSpells[index]);

    // 7. Формируем финальный объект updates
    const systemUpdates: Partial<DnDActor['system']> = {
      background: entry,
      proficiencies: {
        ...system.proficiencies,
        skills: baseSkills,
        tools: baseTools,
        savingThrows: baseSavingThrows,
        armor: baseArmor,
        weapons: baseWeapons,
        languages: baseLanguages,
      },
    };

    const rootUpdates: Partial<DnDActor> = {
      features: baseFeatures,
      activeEffects: baseEffects,
    };

    if (spellsChanged) {
      rootUpdates.spells = updatedSpells;
    }

    if (updatedToken) {
      rootUpdates.token = updatedToken;
    }

    return {
      systemUpdates,
      rootUpdates,
    };
  }

  return {
    definition,
    currentStepInfo,
    selectedScheme,
    abilityAllocation,
    toolSelections,
    grantedTools,
    grantComplete,
    selectedFeatId,
    selectedFeatChoices,
    grantedFeatData,
    askedFeatChoices,
    namedClassKeys,
    featChoiceSpells,
    selectedEquipmentIndex,
    selectedEquipmentItems,
    wizardSteps,
    canProceed,
    nextStep,
    previousStep,
    buildUpdates,
  };
}
