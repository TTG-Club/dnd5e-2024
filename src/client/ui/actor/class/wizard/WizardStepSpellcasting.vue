<script setup lang="ts">
  /**
   * Шаг мастера: Заклинания.
   *
   * Показывает количество заговоров, подготовленных заклинаний
   * и таблицу ячеек для текущего уровня.
   * Позволяет открыть компендиум заклинаний с предустановленными фильтрами
   * по классу и доступным кругам, а также выбрать нужное количество заклинаний.
   */
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    CasterType,
    ClassDefinition,
    DnDActor,
    GrantedSpellSource,
    ResolvedGrantedSpell,
    Spell,
    SubclassDefinition,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import CompendiumDataModal from '@/systems/dnd5e/ui/compendium/CompendiumDataModal.vue';
  import {
    canonicalClassKey,
    computeSpellSlots,
    getPactSlotInfo,
  } from '@vtt/shared/system/dnd.js';

  import { useEntityDetailModals } from '../../../../composables/useEntityDetailModals';
  import { WIZARD_SPELLCASTING_LABELS } from '../../constants';
  import FormSection from '../../FormSection.vue';
  import { ABILITY_LABELS } from './constants';
  import WizardSpellChip from './WizardSpellChip.vue';
  import WizardSpellSourceList from './WizardSpellSourceList.vue';

  /** Плитка сводки уровня: подпись, значение и пояснение по наведению. */
  interface SpellcastingTile {
    key: string;
    caption: string;
    value: string;
    hint: string;
    /** Ведущая плитка — заклинательная характеристика */
    isAccent?: boolean;
  }

  const props = defineProps<{
    classDefinition: ClassDefinition;
    nextLevel: number;
    /** Сокет для загрузки данных компендиума */
    socket: TypedWebSocketClient | null;
    /** Уже выбранные заклинания (из состояния мастера) */
    selectedSpells: Spell[];
    /** Активный подкласс (для подклассов-заклинателей: Мистический рыцарь и т.д.) */
    activeSubclass: SubclassDefinition | null;
    /** Лимит заговоров на текущем уровне */
    cantripsLimit: number;
    /** Лимит заклинаний 1+ круга на текущем уровне */
    spellsLimit: number;
    /** Покруговые лимиты на текущем уровне (если заданы) */
    spellsByLevel: Record<string, number> | null;
    /**
     * Заклинания, автоматически предоставляемые умениями текущего уровня.
     * Отображаются заблокированными и не тратят лимит ручного выбора.
     */
    grantedSpells: ResolvedGrantedSpell[];
    /**
     * Заклинания сверх списка класса — расширение от умений, черт и вида с
     * данными компендиума. Персонаж их не знает: они показываются подсказкой и
     * первыми в компендиуме, а выбирает их игрок сам, в счёт лимита.
     */
    expandedSpells?: ResolvedGrantedSpell[];
    /** Персонаж */
    actor: DnDActor;
  }>();

  const emit = defineEmits<{
    /** Обновление списка выбранных заклинаний */
    'update:selected-spells': [spells: Spell[]];
  }>();

  const isSpellBrowserOpen = ref(false);
  const spellBrowserKey = ref(0);

  /** Карточка заклинания: её открывает нажатие на любую плашку шага */
  const { openSpellDetail } = useEntityDetailModals();

  /**
   * Строка таблицы уровней для текущего уровня.
   *
   * Для подклассов-заклинателей (Мистический рыцарь, Таинственный стрелок)
   * используется их собственная таблица прогрессии, если она задана.
   */
  const levelEntry = computed(() => {
    const subclassTable = props.activeSubclass?.levelTable;

    const table = subclassTable ?? props.classDefinition.levelTable;

    return table.find((row) => row.level === props.nextLevel) ?? null;
  });

  /** Количество заговоров (если обозначено в levelTable) */
  const cantripsKnown = computed(() => {
    const entry = levelEntry.value;

    if (!entry) {
      return null;
    }

    // Поддерживаем оба варианта имени поля в SRD-данных
    const value = entry.cantripsKnown ?? entry.knownCantrips;

    return typeof value === 'number' ? value : null;
  });

  /** Количество подготовленных заклинаний */
  const preparedSpells = computed(() => {
    const entry = levelEntry.value;

    if (!entry) {
      return null;
    }

    const value = entry.preparedSpells;

    return typeof value === 'number' ? value : null;
  });

  /** Временный массив классов с учетом текущего повышения уровня */
  const temporaryClasses = computed(() => {
    const classes = [...(props.actor.system.classes || [])];

    const existingIndex = classes.findIndex(
      (entry) => entry.classKey === props.classDefinition.key,
    );

    const effectiveSpellcasting =
      props.classDefinition.spellcasting
      ?? props.activeSubclass?.spellcasting
      ?? null;

    const classEntry = {
      classKey: props.classDefinition.key,
      className: props.classDefinition.name,
      level: props.nextLevel,
      subclassKey: props.activeSubclass?.key ?? null,
      hitDie: props.classDefinition.hitDie,
      hitDiceUsed: 0,
      hitPointsGained: [],
      chosenSkills: [],
      featureChoices: {},
      ...(effectiveSpellcasting
        ? {
            spellcastingAbility: effectiveSpellcasting.ability,
            casterType: effectiveSpellcasting.type,
          }
        : {}),
    };

    if (existingIndex !== -1) {
      classes[existingIndex] = {
        ...classes[existingIndex],
        level: props.nextLevel,
        subclassKey:
          props.activeSubclass?.key ?? classes[existingIndex].subclassKey,
        ...(effectiveSpellcasting && !classes[existingIndex].spellcastingAbility
          ? {
              spellcastingAbility: effectiveSpellcasting.ability,
              casterType: effectiveSpellcasting.type,
            }
          : {}),
      };
    } else {
      classes.push(classEntry);
    }

    return classes;
  });

  const casterTypeMap = computed(() => {
    const typeMap = new Map<string, CasterType>();

    for (const entry of temporaryClasses.value) {
      if (entry.casterType) {
        typeMap.set(entry.classKey, entry.casterType);
      }
    }

    return typeMap;
  });

  /** Ячейки заклинаний по кругам для отображения */
  const spellSlots = computed(() => {
    const slots: Array<{ level: number; count: number; isPact?: boolean }> = [];

    // 1. Проверяем Pact Magic (Warlock)
    const pactInfo = getPactSlotInfo(temporaryClasses.value);

    if (pactInfo.max > 0) {
      slots.push({ level: pactInfo.level, count: pactInfo.max, isPact: true });
    }

    // 2. Проверяем обычные ячейки заклинаний
    if (temporaryClasses.value.length > 1) {
      // Мультикласс — считаем ячейки по общему caster level
      const maxSlots = computeSpellSlots(
        temporaryClasses.value,
        casterTypeMap.value,
      );

      maxSlots.forEach((count, index) => {
        if (count > 0) {
          slots.push({ level: index + 1, count });
        }
      });
    } else {
      // Одноклассовый — берем ячейки из levelTable прокачиваемого класса (или подкласса)
      const entry = levelEntry.value;

      if (entry) {
        for (let circle = 1; circle <= 9; circle++) {
          const slotKey = `spellSlots${circle}`;
          const count = entry[slotKey];

          if (typeof count === 'number' && count > 0) {
            slots.push({ level: circle, count });
          }
        }
      }
    }

    return slots;
  });

  /**
   * Эффективная заклинательная конфигурация.
   * Берётся из класса, а если нет — из подкласса.
   */
  const effectiveSpellcasting = computed(() => {
    return (
      props.classDefinition.spellcasting
      ?? props.activeSubclass?.spellcasting
      ?? null
    );
  });

  /** Название заклинательной характеристики */
  const spellcastingAbilityLabel = computed(() => {
    const ability = effectiveSpellcasting.value?.ability;

    if (!ability) {
      return '';
    }

    return ABILITY_LABELS[ability] ?? ability;
  });

  /**
   * Сводка уровня одной строкой: характеристика, заговоры, подготовленные и
   * ячейки по кругам.
   *
   * Раньше характеристика стояла отдельной полосой над плитками, а плитка ячеек
   * подписывалась «1 кр. (Пакт)» — по такой подписи не понять ни что это за
   * число, ни чем пактовая ячейка отличается от обычной. Теперь всё это плитки
   * одного вида, и каждая объясняет себя по наведению.
   */
  const spellcastingTiles = computed<SpellcastingTile[]>(() => {
    const tiles: SpellcastingTile[] = [];

    if (spellcastingAbilityLabel.value) {
      tiles.push({
        key: 'ability',
        caption: WIZARD_SPELLCASTING_LABELS.ability,
        value: spellcastingAbilityLabel.value,
        hint: WIZARD_SPELLCASTING_LABELS.abilityHint,
        isAccent: true,
      });
    }

    if (cantripsKnown.value !== null) {
      tiles.push({
        key: 'cantrips',
        caption: WIZARD_SPELLCASTING_LABELS.cantrips,
        value: String(cantripsKnown.value),
        hint: WIZARD_SPELLCASTING_LABELS.cantripsHint,
      });
    }

    if (preparedSpells.value !== null) {
      tiles.push({
        key: 'prepared',
        caption: WIZARD_SPELLCASTING_LABELS.prepared,
        value: String(preparedSpells.value),
        hint: WIZARD_SPELLCASTING_LABELS.preparedHint,
      });
    }

    for (const slot of spellSlots.value) {
      const pactSuffix = slot.isPact
        ? WIZARD_SPELLCASTING_LABELS.pactSuffix
        : '';

      const pactHint = slot.isPact
        ? ` ${WIZARD_SPELLCASTING_LABELS.pactHint}`
        : '';

      tiles.push({
        key: `slot-${slot.level}`,
        caption: `${slot.level}${WIZARD_SPELLCASTING_LABELS.slotLevelSuffix}${pactSuffix}`,
        value: String(slot.count),
        hint:
          `${WIZARD_SPELLCASTING_LABELS.slotHintPrefix}${slot.level}`
          + `${WIZARD_SPELLCASTING_LABELS.slotHintSuffix}${pactHint}`,
      });
    }

    return tiles;
  });

  /**
   * Оформление плитки: заклинательная характеристика ведущая — она называет
   * механику, от которой считается весь остальной ряд.
   *
   * @param tile - плитка сводки
   */
  function tileClass(tile: SpellcastingTile): string {
    return tile.isAccent
      ? 'border-magic-border/40 bg-magic-subtle/10'
      : 'border-default/50 bg-elevated/30';
  }

  /**
   * Оформление подписи плитки; см. {@link tileClass}.
   *
   * @param tile - плитка сводки
   */
  function tileCaptionClass(tile: SpellcastingTile): string {
    return tile.isAccent ? 'text-magic/80' : 'text-dimmed';
  }

  /**
   * Оформление значения плитки; см. {@link tileClass}.
   *
   * @param tile - плитка сводки
   */
  function tileValueClass(tile: SpellcastingTile): string {
    return tile.isAccent ? 'text-magic-muted' : 'text-highlighted';
  }

  /**
   * Ключ класса для фильтра компендиума.
   *
   * Для подклассов-заклинателей (Мистический рыцарь, Таинственный стрелок)
   * фильтр не устанавливается, т.к. их списки заклинаний специфичны
   * и не привязаны к ключу базового класса в компендиуме.
   */
  const classKeyFilter = computed((): string | undefined => {
    // Если магия от класса — фильтруем по КАНОНИЧЕСКОМУ ключу: у класса,
    // созданного или скопированного в мире, ключ свой, а заклинания
    // компендиума помечены ключом правил — по своему не нашлось бы ни одного
    if (props.classDefinition.spellcasting) {
      return canonicalClassKey(props.classDefinition) ?? undefined;
    }

    // Для подклассов-заклинателей не устанавливаем фильтр по классу
    return undefined;
  });

  /**
   * Доступные круги заклинаний для выбора.
   * Ограничены тем, какие круги ячеек доступны ИМЕННО прокачиваемому классу на новом уровне.
   * Включает 0 (заговоры), если cantripsLimit > 0.
   */
  const availableLevelFilter = computed((): number[] => {
    const levels: number[] = [];

    if (props.cantripsLimit > 0) {
      levels.push(0);
    }

    if (props.spellsByLevel) {
      for (const levelStr of Object.keys(props.spellsByLevel)) {
        levels.push(Number(levelStr));
      }
    } else if (props.spellsLimit > 0) {
      const entry = levelEntry.value;

      if (entry) {
        if (
          typeof entry.pactSlots === 'number'
          && entry.pactSlots > 0
          && typeof entry.pactSlotLevel === 'number'
        ) {
          for (
            let spellLevel = 1;
            spellLevel <= entry.pactSlotLevel;
            spellLevel++
          ) {
            levels.push(spellLevel);
          }
        }

        for (let circle = 1; circle <= 9; circle++) {
          const slotKey = `spellSlots${circle}`;
          const count = entry[slotKey];

          if (typeof count === 'number' && count > 0) {
            levels.push(circle);
          }
        }
      }
    }

    return Array.from(new Set(levels)).sort(
      (levelA, levelB) => levelA - levelB,
    );
  });

  /** Доступные круги заклинаний >= 1 для отображения */
  const availableSpellCircles = computed((): number[] => {
    return availableLevelFilter.value.filter((level) => level >= 1);
  });

  /** Текстовое представление диапазона кругов заклинаний */
  const availableSpellCirclesText = computed((): string => {
    const circles = availableSpellCircles.value;

    if (circles.length === 0) {
      return '1+';
    }

    if (circles.length === 1) {
      return String(circles[0]);
    }

    const minLevel = circles[0];
    const maxLevel = circles[circles.length - 1];

    return `${minLevel}-${maxLevel}`;
  });

  /** Лимит для передачи в selection-limit компендиума */
  const compendiumSelectionLimit = computed(() => {
    if (props.spellsByLevel) {
      return Object.values(props.spellsByLevel).reduce(
        (sum, count) => sum + count,
        0,
      );
    }

    return props.spellsLimit > 0 ? props.spellsLimit : undefined;
  });

  /** Идентификаторы уже выбранных заклинаний — для предзаполнения компендиума */
  const selectedSpellIds = computed(() =>
    props.selectedSpells.map((spell) => spell.id),
  );

  /**
   * Названия заклинаний, которые уже есть у персонажа.
   * Компендиум помечает их «Изучено» и не даёт выбрать повторно.
   */
  const knownSpellNames = computed(() =>
    (props.actor.spells ?? []).map((spell) => spell.name),
  );

  /**
   * Связи «ID заклинания → умение» для компендиума.
   * Компендиум помечает такие заклинания авто-выбранными и заблокированными.
   */
  const grantedSpellSourcesForCompendium = computed((): GrantedSpellSource[] =>
    props.grantedSpells.map((granted) => ({
      spellId: granted.spell.id,
      featureName: granted.featureName,
    })),
  );

  /** Заклинания сверх списка класса — расширение от умений, черт и вида. */
  const expandedSpellRows = computed(() => props.expandedSpells ?? []);

  /**
   * Связи «ID заклинания → источник» для компендиума: такие заклинания он
   * показывает первыми и сверх фильтра по классу.
   */
  const pinnedSpellSourcesForCompendium = computed((): GrantedSpellSource[] =>
    expandedSpellRows.value.map((expanded) => ({
      spellId: expanded.spell.id,
      featureName: expanded.featureName,
    })),
  );

  /**
   * Что и сколько берут на этом уровне — строками «что: сколько».
   *
   * Числом после двоеточия, а не внутри фразы: «Выберите 2 новых заговоров» —
   * и число, и падеж в одной строке не сходятся ни при каком количестве.
   */
  const spellChoiceRows = computed(() => {
    const rows: { key: string; label: string; value: number }[] = [];

    if (props.cantripsLimit > 0) {
      rows.push({
        key: 'cantrips',
        label: WIZARD_SPELLCASTING_LABELS.chooseCantrips,
        value: props.cantripsLimit,
      });
    }

    if (props.spellsLimit > 0) {
      rows.push({
        key: 'spells',
        label: `${WIZARD_SPELLCASTING_LABELS.chooseSpellsPrefix}${availableSpellCirclesText.value}${WIZARD_SPELLCASTING_LABELS.circleSuffix}`,
        value: props.spellsLimit,
      });
    }

    for (const [level, count] of Object.entries(props.spellsByLevel ?? {})) {
      rows.push({
        key: `level-${level}`,
        label: `${WIZARD_SPELLCASTING_LABELS.chooseByLevelPrefix}${level}${WIZARD_SPELLCASTING_LABELS.circleSuffix}`,
        value: count,
      });
    }

    return rows;
  });

  /**
   * Откуда берутся заклинания и почему их выбирают здесь. Без этой строки шаг
   * просто требовал «выберите два» — из чего и почему именно сейчас, игроку
   * приходилось догадываться.
   */
  const spellSourceHint = computed(() => {
    const expandedNote =
      expandedSpellRows.value.length > 0
        ? WIZARD_SPELLCASTING_LABELS.sourceHintExpanded
        : '';

    return (
      WIZARD_SPELLCASTING_LABELS.sourceHintPrefix
      + props.classDefinition.name
      + WIZARD_SPELLCASTING_LABELS.sourceHintSuffix
      + expandedNote
    );
  });

  /**
   * Обрабатывает выбор заклинаний из компендиума.
   *
   * Компендиум получает уже выбранные заклинания через `preselectedSpellIds`,
   * поэтому возвращает полный итоговый список (с учётом снятых галочек).
   * Заменяем список целиком, а не дописываем — иначе снятие выбора не учтётся.
   *
   * @param newSpells - полный набор заклинаний, отмеченных в компендиуме
   */
  function handleSpellsSelected(newSpells: Spell[]): void {
    emit('update:selected-spells', newSpells);
  }

  /**
   * Удаляет заклинание из списка выбранных.
   *
   * @param spellId - идентификатор заклинания
   */
  function removeSpell(spellId: string): void {
    emit(
      'update:selected-spells',
      props.selectedSpells.filter((spell) => spell.id !== spellId),
    );
  }

  /**
   * Открывает компендиум заклинаний.
   * При повторном нажатии перемонтирует модалку, чтобы она поднялась поверх остальных.
   */
  function openSpellBrowser(): void {
    if (isSpellBrowserOpen.value) {
      // Модалка уже открыта — перемонтируем для получения нового z-index
      spellBrowserKey.value++;

      return;
    }

    isSpellBrowserOpen.value = true;
  }

  defineExpose({ openSpellBrowser });
</script>

<template>
  <div class="flex flex-col gap-3">
    <span class="block text-sm font-medium text-toned">
      {{ WIZARD_SPELLCASTING_LABELS.title }}
    </span>

    <!-- Заклинания, автоматически предоставленные умениями -->
    <FormSection
      v-if="grantedSpells.length > 0"
      :title="WIZARD_SPELLCASTING_LABELS.grantedTitle"
      icon="tabler:sparkles"
      :hint="WIZARD_SPELLCASTING_LABELS.grantedHint"
    >
      <template #actions>
        <UBadge
          color="primary"
          variant="subtle"
          size="sm"
          class="tabular-nums"
        >
          {{ grantedSpells.length }}
        </UBadge>
      </template>

      <WizardSpellSourceList
        :spells="grantedSpells"
        tone="granted"
        locked
        @open="openSpellDetail"
      />
    </FormSection>

    <!-- Заклинания сверх списка класса: расширение от умений, черт и вида.
      Не выдача — подсказка, что их можно выбрать в компендиуме -->
    <FormSection
      v-if="expandedSpellRows.length > 0"
      :title="WIZARD_SPELLCASTING_LABELS.expandedTitle"
      icon="tabler:books"
      :hint="WIZARD_SPELLCASTING_LABELS.expandedHint"
    >
      <template #actions>
        <UBadge
          color="info"
          variant="subtle"
          size="sm"
          class="tabular-nums"
        >
          {{ expandedSpellRows.length }}
        </UBadge>
      </template>

      <WizardSpellSourceList
        :spells="expandedSpellRows"
        tone="expanded"
        @open="openSpellDetail"
      />
    </FormSection>

    <template v-if="classDefinition.spellcasting">
      <!-- Сводка уровня: характеристика, заговоры, подготовленные и ячейки.
        Плитки одного вида — это одна мысль, и разбивать её на полосы незачем;
        что значит каждая, объясняет подсказка по наведению -->
      <FormSection
        v-if="spellcastingTiles.length > 0"
        :title="WIZARD_SPELLCASTING_LABELS.summaryTitle"
        icon="tabler:wand"
      >
        <div class="flex flex-wrap gap-2">
          <UTooltip
            v-for="tile in spellcastingTiles"
            :key="tile.key"
            :ui="{ content: 'h-auto max-w-72 py-1.5' }"
          >
            <div
              class="flex min-w-20 cursor-help flex-col items-center gap-0.5 rounded-lg border px-3 py-2"
              :class="tileClass(tile)"
            >
              <span
                class="text-xs font-medium"
                :class="tileCaptionClass(tile)"
              >
                {{ tile.caption }}
              </span>

              <span
                class="text-base font-bold"
                :class="tileValueClass(tile)"
              >
                {{ tile.value }}
              </span>
            </div>

            <!-- Текст через слот, а не пропом `text`: штатная подпись тултипа
              режется в одну строку классом `truncate` -->
            <template #content>
              <span class="whitespace-normal">{{ tile.hint }}</span>
            </template>
          </UTooltip>
        </div>
      </FormSection>

      <!-- Что и сколько берут на этом уровне -->
      <FormSection
        v-if="spellsLimit > 0 || cantripsLimit > 0 || spellsByLevel !== null"
        :title="WIZARD_SPELLCASTING_LABELS.chooseTitle"
        icon="tabler:hand-click"
      >
        <div class="flex flex-col gap-2">
          <!-- Сколько чего берут — плитками «что: сколько»: числом после
            двоеточия падеж не спорит с количеством -->
          <div class="flex flex-wrap gap-2">
            <div
              v-for="row in spellChoiceRows"
              :key="row.key"
              class="flex items-center gap-2 rounded-lg border border-default/60 bg-elevated/30 px-3 py-1.5"
            >
              <span class="text-sm text-muted">{{ row.label }}</span>

              <span class="text-base font-bold text-highlighted">
                {{ row.value }}
              </span>
            </div>
          </div>

          <!-- Откуда заклинания и почему их выбирают именно здесь -->
          <p class="text-sm text-muted">
            {{ spellSourceHint }}
          </p>

          <UButton
            variant="soft"
            color="primary"
            size="lg"
            icon="tabler:book-2"
            block
            @click.left.exact.prevent="openSpellBrowser"
          >
            {{ WIZARD_SPELLCASTING_LABELS.viewSpells }}
          </UButton>
        </div>
      </FormSection>

      <!-- Взятое на этом уровне -->
      <FormSection
        v-if="selectedSpells.length > 0"
        :title="WIZARD_SPELLCASTING_LABELS.selectedTitle"
        icon="tabler:list-details"
        :hint="WIZARD_SPELLCASTING_LABELS.selectedHint"
      >
        <template #actions>
          <UBadge
            color="primary"
            variant="subtle"
            size="sm"
            class="tabular-nums"
          >
            {{ selectedSpells.length }}
          </UBadge>
        </template>

        <div class="flex flex-wrap gap-1.5">
          <WizardSpellChip
            v-for="spell in selectedSpells"
            :key="spell.id"
            :spell="spell"
            removable
            @open="openSpellDetail(spell)"
            @remove="removeSpell(spell.id)"
          />
        </div>
      </FormSection>

      <!-- Нет заклинаний для выбора — информационное сообщение -->
      <p
        v-if="
          spellsLimit === 0 && cantripsLimit === 0 && spellsByLevel === null
        "
        class="text-sm text-dimmed italic"
      >
        {{ WIZARD_SPELLCASTING_LABELS.manualHint }}
      </p>
    </template>

    <!-- Компендиум заклинаний -->
    <CompendiumDataModal
      v-if="isSpellBrowserOpen"
      :key="spellBrowserKey"
      :open="isSpellBrowserOpen"
      :socket="socket"
      data-kind="spell"
      :title="WIZARD_SPELLCASTING_LABELS.title"
      :initial-class-filter="classKeyFilter"
      :initial-level-filter="availableLevelFilter"
      :selection-limit="compendiumSelectionLimit"
      :cantrips-limit="cantripsLimit > 0 ? cantripsLimit : undefined"
      :preselected-spell-ids="selectedSpellIds"
      :known-spell-names="knownSpellNames"
      :granted-spells="grantedSpellSourcesForCompendium"
      :pinned-spells="pinnedSpellSourcesForCompendium"
      @update:open="isSpellBrowserOpen = $event"
      @select-spells="handleSpellsSelected"
    />
  </div>
</template>
