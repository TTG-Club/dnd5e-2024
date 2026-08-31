/**
 * Локальные типы и конвертеры редактора «Создать/Редактировать класс»
 * (панель «Предметы»). Вся логика разворота `ClassDefinition` в редактируемую
 * модель и обратной сборки живёт здесь, в типизируемом `.ts` (шаблоны `.vue`
 * не проверяются type-check'ом), чтобы поймать ошибки конвертации статически.
 *
 * Ключевые решения модели:
 * - `featureKeys` строки таблицы прогрессии НЕ редактируются вручную — они
 *   выводятся из `level` каждого умения при сборке ({@link buildLevelTable}).
 * - ASI на уровне — это чекбокс строки; на сборке вставляется синтетический
 *   ключ `asi-<level>` + синтетическое умение с флагом
 *   `abilityImprovement`. Ключ сохраняет прежний вид ради записей, где флага
 *   нет: мастер класса падает на эвристику по ключу (`isAsiFeature`).
 * - Динамические колонки таблицы (ячейки заклинаний, приёмы и т.п.) — значения
 *   `string | number`, разрежённые (пустая ячейка не пишется → рендер «—»).
 */

import type { AbilityType, SourceDefinition } from '@vtt/shared';
import type {
  ActiveEffect,
  CasterType,
  ClassCounterDefinition,
  ClassDefinition,
  ClassFeature,
  ClassFeatureChoice,
  ClassFeatureChoiceConfig,
  ClassFeatureSkillChoice,
  ClassLevelEntry,
  FeatData,
  GrantedSpellRef,
  HitDie,
  SubclassDefinition,
} from '@vtt/shared/system/dnd.js';

import type { EditableResourceCounter } from '../counterEditorTypes';
import type {
  EditableChoiceScaling,
  EditableFeatGrants,
} from '../feat/featEditorTypes';

import { generateId } from '@vtt/shared';
import {
  calculateProficiencyBonus,
  findScalingParentFeature,
  isAsiFeatureKey,
  scalingFeatureKey,
} from '@vtt/shared/system/dnd.js';

import { CHOICE_CONFIG_DEFAULT_COUNT, CHOICE_COUNT_MIN } from '../constants';
import {
  entriesToProgression,
  progressionToEntries,
} from '../counterEditorTypes';
import {
  buildFeatData,
  createEmptyFeatGrants,
  featDataToGrants,
} from '../feat/featEditorTypes';

// ── Колонки таблицы прогрессии ───────────────────────────────

/** Дочерняя (листовая) колонка внутри группы. */
export interface EditableTableColumnChild {
  uid: string;
  key: string;
  label: string;
}

/**
 * Колонка таблицы: либо лист (`key` задан, `children` пуст), либо группа
 * (`children` непуст, собственного `key` нет — только подзаголовки).
 */
export interface EditableTableColumn {
  uid: string;
  key: string;
  label: string;
  children: EditableTableColumnChild[];
  /**
   * Стандартная DND-колонка, добавленная пресет-кнопкой: название и ключ
   * «вшиты», в редакторе не меняются (показываются только для справки). Свои
   * колонки («Колонка»/«Группа») имеют `locked: false` и редактируются.
   */
  locked: boolean;
}

// ── Строка таблицы прогрессии (1 уровень) ────────────────────

export interface EditableLevelRow {
  level: number;
  proficiencyBonus: number;
  /** Повышение характеристик (ASI) на этом уровне. */
  hasAsi: boolean;
  /** Сколько НОВЫХ заговоров выбрать (для заклинателей). */
  newCantrips: number;
  /** Сколько НОВЫХ заклинаний выбрать (для заклинателей). */
  newSpells: number;
  /** Значения динамических колонок: ключ листа → введённый текст. */
  columns: Record<string, string>;
  /**
   * Поля строки, которые форма не редактирует, но обязана сохранить при
   * round-trip (напр. `newSpellsByLevel` и любые неизвестные ключи).
   */
  preserved: Record<string, ClassLevelEntryValue>;
}

/** Тип значения произвольного поля строки таблицы уровней. */
type ClassLevelEntryValue =
  string | number | boolean | string[] | Record<string, number> | undefined;

// ── Заклинания умения ────────────────────────────────────────

/** Поуровневая выдача заклинаний умением (домены/клятвы). */
export interface EditableGrantedSpellLevel {
  uid: string;
  level: number;
  spells: GrantedSpellRef[];
}

// ── Умение класса/подкласса ──────────────────────────────────

/** Вариант умения (боевой стиль, манёвры). */
export interface EditableClassFeatureChoice {
  uid: string;
  key: string;
  name: string;
  /** Английское название — по нему вариант ищут в книге. */
  nameEn: string;
  description: string;
  /** Короткая подпись рядом с названием в свёрнутой строке. */
  additional: string;
  /** Требования к варианту живой фразой. */
  prerequisite: string;
  /** Вариант не показывается на странице подкласса. */
  hideInSubclasses: boolean;
  /**
   * Уровень класса, с которого вариант доступен; пусто — сразу. Мастер уровня
   * по нему и отбирает, что предложить: воззвание «для колдуна 5 уровня» на
   * первом уровне игрок не увидит.
   */
  requiredLevel?: number;
  /** Вариант берут повторно на следующей ступени выбора. */
  repeatable: boolean;
}

/**
 * Настройка выбора из вариантов умения: сколько их берут и как это число
 * растёт по уровням.
 *
 * Есть она только у выбираемого списка — по её наличию потребитель и отличает
 * выбираемый список от справочного, который лишь показывается описанием. Так
 * же устроена мастерская сайта.
 */
export interface EditableClassFeatureChoiceConfig {
  /** Подпись выбора («Таинственные воззвания»); пусто — название умения. */
  label: string;
  /** Сколько вариантов берут на уровне получения умения. */
  count: number;
  /** Рост количества по уровням — тот же ряд, что у выбора в дарах. */
  scaling: EditableChoiceScaling[];
}

/**
 * Ступень роста умения по уровням: уровень, на котором умение повторяется или
 * усиливается («Дополнительная атака» на 11-м, ASI на 8, 12, 16).
 */
export interface EditableClassFeatureScaling {
  uid: string;
  level: number;
  /** Название ступени; пусто — берётся название самого умения. */
  name: string;
  description: string;
}

export interface EditableClassFeature {
  key: string;
  name: string;
  description: string;
  level: number;
  isInformationalOnly: boolean;
  /** Заклинания, выдаваемые умением (всегда подготовлены). */
  grantedSpells: GrantedSpellRef[];
  /** Поуровневая выдача заклинаний (домены/клятвы/покровители). */
  grantedSpellsByLevel: EditableGrantedSpellLevel[];
  /** Варианты-выборы внутри умения. */
  choices: EditableClassFeatureChoice[];
  /**
   * Рост умения по уровням. В самой записи класса ступени лежат НЕ здесь, а
   * отдельными умениями с ключом `<ключ умения>-<уровень>`: по ключу их
   * адресует таблица прогрессии, и ровно так же разворачивает их выгрузка
   * сайта (`VttgClassMapper.appendScaling`). Форма сворачивает их обратно к
   * своему умению при открытии записи — автор правит рост там же, где само
   * умение, а потребитель видит привычный плоский список.
   */
  scaling: EditableClassFeatureScaling[];
  /**
   * Настройка выбора из вариантов; нет — список справочный, его варианты
   * только показываются описанием умения.
   */
  choiceConfig?: EditableClassFeatureChoiceConfig;
  /**
   * Владение навыками на выбор от самого умения (round-trip; форма его не
   * редактирует). Своего блока у него нет: то же самое задаётся строкой даров
   * «Навык → дать выбрать», и два поля об одном расходились бы. У записей,
   * пришедших с сайта, поле бывает заполнено — сохраняем как есть, иначе
   * открытие и сохранение класса молча снимало бы выбор навыка с уровня.
   */
  preservedSkillChoice?: ClassFeatureSkillChoice;
  /** Активные эффекты умения; переносятся на персонажа вместе с ним. */
  activeEffects: ActiveEffect[];
  /**
   * Дары умения: владения, выборы, правки листа и ресурсы — тем же блоком, что
   * у черты. Форма правит их на своей вкладке «Дары», как на сайте, поэтому
   * ресурс умения заводится прямо у него, а не привязкой к нему из счётчиков
   * класса.
   */
  grants: EditableFeatGrants;

  /**
   * Заклинания, которые умение даёт знать; правятся отдельным полем формы.
   */
  grantedSpellRefs: GrantedSpellRef[];
}

// ── Заклинательство ──────────────────────────────────────────

export interface EditableSpellcasting {
  enabled: boolean;
  type: CasterType;
  ability: AbilityType;
  startLevel: number;
}

// ── Подкласс ─────────────────────────────────────────────────

export interface EditableSubclass {
  key: string;
  name: string;
  nameEn: string;
  description: string;
  unlockLevel: number;
  sourceKey?: string;
  source?: SourceDefinition;
  features: EditableClassFeature[];
  counters: EditableResourceCounter[];
  spellcasting: EditableSpellcasting;
  /** Есть ли у подкласса своя таблица прогрессии (Мистический рыцарь). */
  hasOwnTable: boolean;
  tableColumns: EditableTableColumn[];
  levelTable: EditableLevelRow[];
  /** Бонус-заклинания подкласса (round-trip; форма их не редактирует). */
  preservedBonusSpells?: SubclassDefinition['bonusSpells'];
  /** Дары подкласса блоком `featData` (round-trip; форма их не редактирует). */
  preservedFeatData?: FeatData;
}

// ============================================================
// Хелперы
// ============================================================

/** Канонические названия обычного повышения характеристик (генерик ASI). */
const PLAIN_ASI_NAMES = new Set<string>([
  'Улучшение характеристик',
  'Увеличение характеристик',
]);

/**
 * «Обычное» ли это повышение характеристик — то есть ASI-умение без своего
 * содержания, которую безопасно представить чекбоксом строки и пересобрать
 * синтетически. Эпические дары (свои название/описание/механика) сюда НЕ входят
 * — их надо сохранять как настоящие умения.
 */
export function isPlainAsiFeature(feature: {
  key: string;
  name: string;
  abilityImprovement?: boolean;
}): boolean {
  const isAsi = feature.abilityImprovement ?? isAsiFeatureKey(feature.key);

  return isAsi && PLAIN_ASI_NAMES.has(feature.name.trim());
}

/**
 * Ключи умений записи, которые форма показывает чекбоксом ASI строки уровня, а
 * не отдельным умением.
 *
 * Ступени роста повышения характеристик считаются здесь вместе с самим
 * умением: из компендиума они приезжают голыми записями без флага, и без
 * такого разбора бард показывал бы «Улучшение характеристик» умением на 8, 12
 * и 16 уровнях, а сохранение записи оставляло бы эти уровни без повышения.
 *
 * @param features - умения класса или подкласса
 * @returns ключи умений-повышений и их ступеней
 */
export function collectPlainAsiKeys(
  features: ReadonlyArray<ClassFeature>,
): Set<string> {
  const keys = new Set<string>();

  for (const feature of features) {
    const parent = findScalingParentFeature(feature, features);
    const source = isPlainAsiFeature(feature) ? feature : parent;

    if (source && isPlainAsiFeature(source)) {
      keys.add(feature.key);
    }
  }

  return keys;
}

/** Стандартное название/текст синтетического умения повышения характеристик. */
const ASI_NAME = 'Улучшение характеристик';

const ASI_DESCRIPTION =
  'Вы можете повысить значение одной из ваших характеристик на 2 или двух '
  + 'характеристик на 1 (не выше 20). Вместо этого вы можете взять черту.';

/**
 * Зарезервированные ключи колонок: они обслуживаются встроенными колонками/
 * полями таблицы (уровень, бонус мастерства, умения, выбор новых заговоров/
 * заклинаний) и НЕ должны задаваться кастомной колонкой — иначе перезапишут
 * встроенное значение. Дизайнер их игнорирует и предупреждает.
 */
export const RESERVED_COLUMN_KEYS = new Set<string>([
  'level',
  'proficiencyBonus',
  'featureKeys',
  'newCantrips',
  'newSpells',
  'newSpellsByLevel',
]);

/** Является ли ключ колонки зарезервированным под встроенное поле таблицы. */
export function isReservedColumnKey(key: string): boolean {
  return RESERVED_COLUMN_KEYS.has(key.trim());
}

/**
 * Все листовые ключи колонок (раскрытые группы) — для захвата значений строк.
 * Зарезервированные ключи пропускаются, чтобы кастомная колонка не конфликтовала
 * со встроенным полем.
 */
export function collectLeafColumnKeys(
  columns: EditableTableColumn[],
): string[] {
  const keys: string[] = [];

  for (const column of columns) {
    if (column.children.length > 0) {
      for (const child of column.children) {
        const key = child.key.trim();

        if (key && !isReservedColumnKey(key)) {
          keys.push(key);
        }
      }
    } else {
      const key = column.key.trim();

      if (key && !isReservedColumnKey(key)) {
        keys.push(key);
      }
    }
  }

  return keys;
}

/** Создаёт пустую заклинательную конфигурацию (выключенную). */
export function createEmptySpellcasting(): EditableSpellcasting {
  return {
    enabled: false,
    type: 'full',
    ability: 'intelligence',
    startLevel: 1,
  };
}

/** Создаёт пустое умение класса/подкласса. */
export function createEmptyFeature(name: string): EditableClassFeature {
  return {
    key: generateId('cf'),
    name,
    description: '',
    level: 1,
    isInformationalOnly: false,
    grantedSpells: [],
    grantedSpellsByLevel: [],
    choices: [],
    scaling: [],
    activeEffects: [],
    grants: createEmptyFeatGrants(),
    grantedSpellRefs: [],
  };
}

/**
 * Сколько блоков механики у умения заполнено. Считаются именно блоки, а не
 * записи: и в шапке умения, и в шапке свёрнутого блока автору важно, где
 * что-то есть, а длину списка он увидит, раскрыв блок.
 *
 * @param feature - умение формы
 * @returns число непустых блоков механики
 */
export function countFilledMechanicsBlocks(
  feature: EditableClassFeature,
): number {
  return [
    feature.grants.grantRows.length,
    feature.grants.modifiers.length,
    feature.grants.counters.length,
    feature.grantedSpells.length,
    feature.grantedSpellsByLevel.length,
    feature.activeEffects.length,
  ].filter(Boolean).length;
}

/** Создаёт пустую строку таблицы для уровня. */
export function createEmptyLevelRow(level: number): EditableLevelRow {
  return {
    level,
    proficiencyBonus: calculateProficiencyBonus(level),
    hasAsi: false,
    newCantrips: 0,
    newSpells: 0,
    columns: {},
    preserved: {},
  };
}

/** Создаёт пустую таблицу прогрессии (20 уровней). */
export function createEmptyLevelTable(): EditableLevelRow[] {
  return Array.from({ length: 20 }, (_unused, index) =>
    createEmptyLevelRow(index + 1),
  );
}

// ── Разворот: ClassDefinition → редактируемая модель ─────────

function toGrantedRefs(ids: string[] | undefined): GrantedSpellRef[] {
  return (ids ?? []).map((id) => ({ name: id, spellId: id }));
}

/**
 * Разворачивает настройку выбора из вариантов в редактируемые поля.
 *
 * @param config - настройка выбора из записи класса
 * @returns редактируемая настройка; `undefined` — список справочный
 */
function toEditableChoiceConfig(
  config: ClassFeatureChoiceConfig | undefined,
): EditableClassFeatureChoiceConfig | undefined {
  if (!config) {
    return undefined;
  }

  const scaling = Object.entries(config.progression ?? {})
    .map(([levelKey, count]) => ({
      uid: generateId('choice-step'),
      level: Number(levelKey) || 1,
      count,
    }))
    .sort((stepA, stepB) => stepA.level - stepB.level);

  return {
    label: config.label ?? '',
    count: config.count ?? CHOICE_CONFIG_DEFAULT_COUNT,
    scaling,
  };
}

/** Разворачивает умение класса в редактируемые поля. */
export function toEditableFeature(feature: ClassFeature): EditableClassFeature {
  const byLevel: EditableGrantedSpellLevel[] = Object.entries(
    feature.grantedSpellsByLevel ?? {},
  )
    .map(([levelKey, ids]) => ({
      uid: generateId('gsl'),
      level: Number(levelKey) || 1,
      spells: toGrantedRefs(ids),
    }))
    .sort((entryA, entryB) => entryA.level - entryB.level);

  return {
    key: feature.key || generateId('cf'),
    name: feature.name || '',
    description: feature.description || '',
    level: feature.level ?? 1,
    isInformationalOnly: feature.isInformationalOnly ?? false,
    grantedSpells: toGrantedRefs(feature.grantedSpells),
    grantedSpellsByLevel: byLevel,
    choices: (feature.choices ?? []).map((choice) => ({
      uid: generateId('cfc'),
      key: choice.key || generateId('cfc'),
      name: choice.name || '',
      nameEn: choice.nameEn || '',
      description: choice.description || '',
      additional: choice.additional || '',
      prerequisite: choice.prerequisite || '',
      hideInSubclasses: choice.hideInSubclasses ?? false,
      requiredLevel: choice.requiredLevel,
      repeatable: choice.repeatable ?? false,
    })),
    // Ступени роста собирает toEditableFeatures: по одному умению их не
    // видно — ступень лежит отдельной записью рядом со своим умением
    scaling: [],
    choiceConfig: toEditableChoiceConfig(feature.choiceConfig),
    preservedSkillChoice: feature.skillChoice,
    activeEffects: (feature.activeEffects ?? []).map((effect) => ({
      ...effect,
    })),
    grants: featDataToGrants(feature.featData),
    grantedSpellRefs: [...(feature.featData?.grantedSpells ?? [])],
  };
}

/**
 * Умение, ступенью роста которого форма считает запись.
 *
 * Ключ разбирает движок ({@link findScalingParentFeature}) — формат ключа задан
 * компендиумом, и знать о нём двум слоям незачем. Здесь остаётся правило самой
 * формы: своего содержания у ступени нет — только название, описание и уровень.
 * Запись с механикой ступенью не считается: она умение сама по себе, и свернуть
 * её внутрь соседа значило бы потерять её дары. Пометка «только информационная»
 * содержанием не считается, когда она стоит и у родителя: ступень строки
 * таблицы — такая же строка таблицы.
 *
 * @param feature - умение записи
 * @param features - умения класса или подкласса
 * @returns умение-родитель; `undefined` — это обычное умение
 */
function findScalingParentInForm(
  feature: ClassFeature,
  features: ReadonlyArray<ClassFeature>,
): ClassFeature | undefined {
  const parent = findScalingParentFeature(feature, features);

  if (!parent) {
    return undefined;
  }

  const hasOwnContent =
    Boolean(feature.choices?.length)
    || Boolean(feature.choiceConfig)
    || Boolean(feature.abilityImprovement)
    || Boolean(feature.skillChoice)
    || Boolean(feature.grantedSpells?.length)
    || Boolean(feature.grantedSpellsByLevel)
    || Boolean(feature.activeEffects?.length)
    || Boolean(feature.featData)
    || (Boolean(feature.isInformationalOnly) && !parent.isInformationalOnly);

  return hasOwnContent ? undefined : parent;
}

/**
 * Разворачивает умения записи в редактируемые, сворачивая ступени роста внутрь
 * их умений: в записи ступень лежит отдельным умением, а правится строкой
 * внутри родителя.
 *
 * Ресурс, привязанный к ступени, при этом остаётся счётчиком самой записи —
 * его вернёт `distributeFeatureCounters` в общий список: у ступени полей для
 * ресурса нет, а молча терять счётчик нельзя.
 *
 * @param features - умения класса или подкласса
 * @returns редактируемые умения в порядке записи
 */
export function toEditableFeatures(
  features: ReadonlyArray<ClassFeature>,
): EditableClassFeature[] {
  const editableByKey = new Map<string, EditableClassFeature>();
  const result: EditableClassFeature[] = [];

  // Родители заводятся первым проходом: ступень стоит в записи и раньше своего
  // умения — список отсортирован по уровню
  for (const feature of features) {
    if (findScalingParentInForm(feature, features)) {
      continue;
    }

    const editable = toEditableFeature(feature);

    editableByKey.set(feature.key, editable);
    result.push(editable);
  }

  for (const feature of features) {
    const parentFeature = findScalingParentInForm(feature, features);
    const parent = parentFeature && editableByKey.get(parentFeature.key);

    if (!parentFeature || !parent) {
      continue;
    }

    parent.scaling.push({
      uid: generateId('cfs'),
      level: feature.level,
      // Название, повторяющее умение, ступени не принадлежит: так его пишет
      // выгрузка сайта, когда своего названия у ступени нет
      name: feature.name === parentFeature.name ? '' : feature.name || '',
      description: feature.description || '',
    });
  }

  for (const feature of result) {
    feature.scaling.sort((stepA, stepB) => stepA.level - stepB.level);
  }

  return result;
}

/** Разворачивает счётчик ресурса в редактируемые поля. */
export function toEditableCounter(
  counter: ClassCounterDefinition,
): EditableResourceCounter {
  return {
    uid: generateId('counter'),
    key: counter.key || generateId('cnt'),
    name: counter.name || '',
    shortName: counter.shortName || '',
    // Формула счётчика класса пишется в диалекте листа теми же словами, что и
    // у ресурса записи, — поле максимума у них общее
    max: counter.formula || '',
    min: counter.min ?? 0,
    recovery: counter.recovery ?? 'long',
    progression: progressionToEntries(counter.progression),
    startLevel: counter.startLevel ?? 1,
    showInTable: counter.showInTable ?? false,
  };
}

/** Разворачивает заклинательную конфигурацию. */
export function toEditableSpellcasting(
  spellcasting: ClassDefinition['spellcasting'] | undefined,
): EditableSpellcasting {
  if (!spellcasting) {
    return createEmptySpellcasting();
  }

  return {
    enabled: true,
    type: spellcasting.type,
    ability: spellcasting.ability,
    startLevel: spellcasting.startLevel,
  };
}

/**
 * Разворачивает колонки таблицы прогрессии. Зарезервированные ключи (напр.
 * `proficiencyBonus`, который некоторые SRD-классы дублируют в tableColumns)
 * отбрасываются — для них есть встроенная колонка «Мас.».
 */
export function toEditableColumns(
  columns: ClassDefinition['tableColumns'] | undefined,
): EditableTableColumn[] {
  const result: EditableTableColumn[] = [];

  for (const column of columns ?? []) {
    const children = (column.children ?? [])
      .filter((child) => !isReservedColumnKey(child.key))
      .map((child) => ({
        uid: generateId('tcc'),
        key: child.key,
        label: child.label,
      }));

    const leafKey = column.key ?? '';

    if (children.length === 0 && (!leafKey || isReservedColumnKey(leafKey))) {
      continue;
    }

    result.push({
      uid: generateId('tc'),
      key: children.length > 0 ? '' : leafKey,
      label: column.label || '',
      children,
      locked: isStandardColumnDefinition(column),
    });
  }

  return result;
}

/** Строковое представление значения ячейки для поля ввода. */
function cellToText(value: ClassLevelEntryValue): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (value === '—') {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return '';
}

const KNOWN_ROW_KEYS = new Set<string>([
  'type',
  'level',
  'proficiencyBonus',
  'featureKeys',
  'newCantrips',
  'newSpells',
]);

/**
 * Разворачивает таблицу прогрессии в редактируемые строки. Гарантирует ровно
 * 20 строк (недостающие — пустые). Значения динамических колонок берутся по
 * листовым ключам объявленных колонок; всё прочее (`newSpellsByLevel` и др.)
 * складывается в `preserved` для round-trip.
 *
 * `plainAsiKeys` — ключи умений «обычного» ASI (генерик), которые форма
 * исключает из списка и представляет чекбоксом `hasAsi`. Эпические дары туда не
 * входят (остаются настоящими умениями), поэтому их строки `hasAsi` не
 * получают — иначе синтезировался бы дубль.
 */
export function toEditableLevelTable(
  levelTable: ClassLevelEntry[] | undefined,
  columns: EditableTableColumn[],
  plainAsiKeys: Set<string> = new Set(),
): EditableLevelRow[] {
  const leafKeys = new Set(collectLeafColumnKeys(columns));
  const rows = createEmptyLevelTable();

  for (const sourceRow of levelTable ?? []) {
    const index = (sourceRow.level ?? 0) - 1;

    if (index < 0 || index > 19) {
      continue;
    }

    const featureKeys = sourceRow.featureKeys ?? [];
    const columnValues: Record<string, string> = {};
    const preserved: Record<string, ClassLevelEntryValue> = {};

    for (const [key, value] of Object.entries(sourceRow)) {
      if (KNOWN_ROW_KEYS.has(key)) {
        continue;
      }

      if (leafKeys.has(key)) {
        columnValues[key] = cellToText(value);
      } else {
        preserved[key] = value;
      }
    }

    rows[index] = {
      level: sourceRow.level,
      proficiencyBonus:
        sourceRow.proficiencyBonus
        ?? calculateProficiencyBonus(sourceRow.level),
      hasAsi: featureKeys.some((key) => plainAsiKeys.has(key)),
      newCantrips:
        typeof sourceRow.newCantrips === 'number' ? sourceRow.newCantrips : 0,
      newSpells:
        typeof sourceRow.newSpells === 'number' ? sourceRow.newSpells : 0,
      columns: columnValues,
      preserved,
    };
  }

  return rows;
}

/** Разворачивает подкласс в редактируемые поля. */
export function toEditableSubclass(
  subclass: SubclassDefinition,
): EditableSubclass {
  const tableColumns = toEditableColumns(subclass.tableColumns);
  const features = toEditableFeatures(subclass.features ?? []);

  return {
    key: subclass.key || generateId('sub'),
    name: subclass.name || '',
    nameEn: subclass.nameEn || '',
    description: subclass.description || '',
    unlockLevel: subclass.unlockLevel ?? 3,
    sourceKey: subclass.sourceKey,
    source: subclass.source,
    features,
    counters: distributeFeatureCounters(subclass.counters, features),
    spellcasting: toEditableSpellcasting(subclass.spellcasting),
    hasOwnTable: Boolean(subclass.levelTable?.length),
    tableColumns,
    levelTable: toEditableLevelTable(subclass.levelTable, tableColumns),
    preservedBonusSpells: subclass.bonusSpells,
    preservedFeatData: subclass.featData,
  };
}

// ── Сборка: редактируемая модель → ClassDefinition ───────────

/** Сводит выдаваемые заклинания к списку id компендиума. */
function buildGrantedIds(refs: GrantedSpellRef[]): string[] {
  const ids: string[] = [];

  for (const ref of refs) {
    if (ref.spellId && !ids.includes(ref.spellId)) {
      ids.push(ref.spellId);
    }
  }

  return ids;
}

/**
 * Собирает настройку выбора из вариантов обратно в запись класса.
 *
 * Пустая подпись и пустой рост не пишутся: у настройки, пришедшей с сайта, их
 * тоже нет, а пустая строка читалась бы заданной подписью.
 *
 * @param config - редактируемая настройка выбора
 * @returns настройка записи; `undefined` — список справочный
 */
function buildChoiceConfig(
  config: EditableClassFeatureChoiceConfig | undefined,
): ClassFeatureChoiceConfig | undefined {
  if (!config) {
    return undefined;
  }

  const built: ClassFeatureChoiceConfig = {
    count: Math.max(
      CHOICE_COUNT_MIN,
      Math.round(config.count || CHOICE_CONFIG_DEFAULT_COUNT),
    ),
  };

  const label = config.label.trim();

  if (label) {
    built.label = label;
  }

  const progression: Record<string, number> = {};

  for (const step of [...config.scaling].sort(
    (stepA, stepB) => stepA.level - stepB.level,
  )) {
    progression[String(step.level)] = step.count;
  }

  if (Object.keys(progression).length > 0) {
    built.progression = progression;
  }

  return built;
}

/** Собирает умение класса/подкласса из редактируемых полей. */
export function buildFeature(
  feature: EditableClassFeature,
  subclassKey?: string,
): ClassFeature {
  const built: ClassFeature = {
    key: feature.key,
    name: feature.name.trim(),
    description: feature.description.trim(),
    level: Math.max(1, Math.round(feature.level || 1)),
  };

  if (subclassKey) {
    built.subclassKey = subclassKey;
  }

  if (feature.isInformationalOnly) {
    built.isInformationalOnly = true;
  }

  const choices: ClassFeatureChoice[] = feature.choices
    .filter((choice) => choice.name.trim().length > 0)
    .map((choice) => {
      const builtChoice: ClassFeatureChoice = {
        key: choice.key,
        name: choice.name.trim(),
        description: choice.description.trim(),
      };

      // Пустые поля не пишутся: у варианта их и в выгрузке сайта нет, а пустая
      // строка в записи класса читалась бы заполненной подписью
      const nameEn = choice.nameEn.trim();

      if (nameEn) {
        builtChoice.nameEn = nameEn;
      }

      const additional = choice.additional.trim();

      if (additional) {
        builtChoice.additional = additional;
      }

      const prerequisite = choice.prerequisite.trim();

      if (prerequisite) {
        builtChoice.prerequisite = prerequisite;
      }

      if (choice.hideInSubclasses) {
        builtChoice.hideInSubclasses = true;
      }

      if (choice.requiredLevel) {
        builtChoice.requiredLevel = choice.requiredLevel;
      }

      if (choice.repeatable) {
        builtChoice.repeatable = true;
      }

      return builtChoice;
    });

  if (choices.length > 0) {
    built.choices = choices;

    // Настройка без вариантов ничего не описывает: список у умения стёрли —
    // значит, и считать в нём больше нечего
    const choiceConfig = buildChoiceConfig(feature.choiceConfig);

    if (choiceConfig) {
      built.choiceConfig = choiceConfig;
    }
  }

  if (feature.preservedSkillChoice) {
    built.skillChoice = feature.preservedSkillChoice;
  }

  const grantedSpells = buildGrantedIds(feature.grantedSpells);

  if (grantedSpells.length > 0) {
    built.grantedSpells = grantedSpells;
  }

  const byLevel: Record<string, string[]> = {};

  for (const entry of feature.grantedSpellsByLevel) {
    const ids = buildGrantedIds(entry.spells);

    if (ids.length > 0) {
      byLevel[String(entry.level)] = ids;
    }
  }

  if (Object.keys(byLevel).length > 0) {
    built.grantedSpellsByLevel = byLevel;
  }

  if (feature.activeEffects.length > 0) {
    built.activeEffects = feature.activeEffects;
  }

  // Ресурсы умения собираются отдельно, в счётчики записи
  // ({@link buildFeatureCounters}): там известен уровень класса, от которого
  // идут их ступени. Здесь их надо снять, иначе они уехали бы двумя копиями
  const featData = buildFeatData(
    { ...feature.grants, counters: [] },
    feature.grantedSpellRefs,
  );

  if (featData) {
    built.featData = featData;
  }

  return built;
}

/**
 * Ступени роста умения — отдельными умениями записи, как их разворачивает
 * выгрузка сайта: только название, описание и свой уровень. Механики у ступени
 * нет — всё, что умение даёт листу, выдаётся один раз самим умением.
 *
 * @param feature - умение формы
 * @param subclassKey - ключ подкласса, если умение его
 * @returns записи ступеней; пустой список — роста у умения нет
 */
export function buildScalingFeatures(
  feature: EditableClassFeature,
  subclassKey?: string,
): ClassFeature[] {
  const name = feature.name.trim();

  return feature.scaling
    .filter((step) => step.description.trim() || step.name.trim())
    .map((step) => {
      const level = Math.max(1, Math.round(step.level || 1));

      const built: ClassFeature = {
        key: scalingFeatureKey(feature.key, level),
        name: step.name.trim() || name,
        description: step.description.trim(),
        level,
      };

      if (subclassKey) {
        built.subclassKey = subclassKey;
      }

      // Ступень строки таблицы — такая же строка таблицы: без этой пометки
      // рост «Подкласса барда» уезжал бы на лист персонажа отдельным умением
      if (feature.isInformationalOnly) {
        built.isInformationalOnly = true;
      }

      return built;
    });
}

/**
 * Счётчики записи из ресурсов её умений.
 *
 * Ресурс, заведённый в умении, живёт счётчиком класса, а не даром умения: от
 * уровня класса идут его ступени и уровень появления, а у дара такого уровня
 * нет. Уровень появления берётся у самого умения, ключ умения остаётся на
 * счётчике — по нему форма вернёт ресурс в его умение при открытии записи.
 *
 * @param features - умения записи
 * @param subclassKey - ключ подкласса, если умения его
 * @returns счётчики для {@link ClassDefinition.counters}
 */
export function buildFeatureCounters(
  features: ReadonlyArray<EditableClassFeature>,
  subclassKey?: string,
): ClassCounterDefinition[] {
  return (
    features
      // Умение без названия в запись не попадает — не должен и его ресурс:
      // иначе счётчик остался бы со ссылкой на несуществующее умение
      .filter((feature) => feature.name.trim().length > 0)
      .flatMap((feature) =>
        feature.grants.counters
          .filter((counter) => counter.name.trim().length > 0)
          .map((counter) => ({
            ...buildCounter(
              {
                ...counter,
                startLevel: Math.max(1, Math.round(feature.level || 1)),
              },
              subclassKey,
            ),
            featureKey: feature.key,
          })),
      )
  );
}

/**
 * Возвращает ресурсы умений в их умения и отдаёт остальные счётчики записи.
 *
 * Обратная сторона {@link buildFeatureCounters}: в записи ресурс умения лежит
 * счётчиком, а правится внутри своего умения. Счётчик, чьего умения среди
 * записи нет (умение удалили в обход формы), остаётся собственным счётчиком
 * записи — молча терять его нельзя.
 *
 * @param counters - счётчики записи
 * @param features - умения записи; их ресурсы заполняются на месте
 * @returns счётчики, оставшиеся за самой записью
 */
export function distributeFeatureCounters(
  counters: ClassCounterDefinition[] | undefined,
  features: EditableClassFeature[],
): EditableResourceCounter[] {
  const byKey = new Map(features.map((feature) => [feature.key, feature]));
  const own: EditableResourceCounter[] = [];

  for (const counter of counters ?? []) {
    const feature = counter.featureKey
      ? byKey.get(counter.featureKey)
      : undefined;

    if (feature) {
      feature.grants.counters.push(toEditableCounter(counter));
    } else {
      own.push(toEditableCounter(counter));
    }
  }

  return own;
}

/** Собирает счётчик ресурса из редактируемых полей. */
export function buildCounter(
  counter: EditableResourceCounter,
  subclassKey?: string,
): ClassCounterDefinition {
  const built: ClassCounterDefinition = {
    key: counter.key,
    name: counter.name.trim(),
    startLevel: Math.max(1, Math.round(counter.startLevel || 1)),
    recovery: counter.recovery,
  };

  // Нулевая граница ничего не описывает: у ресурса без неё поля быть не должно
  if (counter.min > 0) {
    built.min = Math.round(counter.min);
  }

  if (counter.showInTable) {
    built.showInTable = true;
  }

  if (counter.shortName.trim()) {
    built.shortName = counter.shortName.trim();
  }

  if (subclassKey) {
    built.subclassKey = subclassKey;
  }

  // Ступени старше формулы — тот же порядок, что и при расчёте на листе:
  // заданный ими ряд формулой не пишется
  const progression = entriesToProgression(counter.progression);

  if (progression) {
    built.progression = progression;
  } else if (counter.max.trim()) {
    built.formula = counter.max.trim();
  }

  return built;
}

/** Собирает заклинательную конфигурацию (null, если выключена). */
export function buildSpellcasting(
  spellcasting: EditableSpellcasting,
): ClassDefinition['spellcasting'] {
  if (!spellcasting.enabled) {
    return null;
  }

  return {
    type: spellcasting.type,
    ability: spellcasting.ability,
    startLevel: Math.max(1, Math.round(spellcasting.startLevel || 1)),
  };
}

/**
 * Собирает колонки таблицы прогрессии (лист или группа). Зарезервированные и
 * ПОВТОРНЫЕ листовые ключи отбрасываются (защита от случайного дубля колонки,
 * напр. дважды добавленного пресета «Ячейки заклинаний»).
 */
export function buildColumns(
  columns: EditableTableColumn[],
): NonNullable<ClassDefinition['tableColumns']> {
  const result: NonNullable<ClassDefinition['tableColumns']> = [];
  const seenKeys = new Set<string>();

  for (const column of columns) {
    const children = column.children
      .filter((child) => {
        const key = child.key.trim();

        if (!key || !child.label.trim() || isReservedColumnKey(key)) {
          return false;
        }

        if (seenKeys.has(key)) {
          return false;
        }

        seenKeys.add(key);

        return true;
      })
      .map((child) => ({ key: child.key.trim(), label: child.label.trim() }));

    if (children.length > 0) {
      result.push({ label: column.label.trim(), children });

      continue;
    }

    const leafKey = column.key.trim();

    if (leafKey && !isReservedColumnKey(leafKey) && !seenKeys.has(leafKey)) {
      seenKeys.add(leafKey);
      result.push({ key: leafKey, label: column.label.trim() });
    }
  }

  return result;
}

/** Числовое/строковое значение ячейки (пусто → undefined → колонка не пишется). */
function textToCell(text: string): string | number | undefined {
  const trimmed = text.trim();

  if (!trimmed || trimmed === '—') {
    return undefined;
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

/**
 * Собирает таблицу прогрессии. `featureKeys` каждого уровня выводятся из
 * `features` (по `level`) + синтетический `asi-<level>` при включённом ASI.
 */
export function buildLevelTable(
  rows: EditableLevelRow[],
  features: EditableClassFeature[],
  columns: EditableTableColumn[],
): ClassLevelEntry[] {
  const leafKeys = collectLeafColumnKeys(columns);

  const keysByLevel = new Map<number, string[]>();

  /**
   * Ставит ключ умения на его уровень.
   *
   * @param level - уровень класса
   * @param key - ключ умения или его ступени роста
   */
  function addKey(level: number, key: string): void {
    const list = keysByLevel.get(level) ?? [];

    list.push(key);
    keysByLevel.set(level, list);
  }

  for (const feature of features) {
    if (!feature.name.trim()) {
      continue;
    }

    addKey(Math.max(1, Math.round(feature.level || 1)), feature.key);

    // Ступени роста стоят в таблице своими строками: на их уровне игрок
    // получает запись умения заново, и без ключа строка уровня была бы пуста
    for (const built of buildScalingFeatures(feature)) {
      addKey(built.level, built.key);
    }
  }

  return rows.map((row) => {
    const featureKeys = [...(keysByLevel.get(row.level) ?? [])];

    if (row.hasAsi) {
      featureKeys.push(`asi-${row.level}`);
    }

    const entry: ClassLevelEntry = {
      level: row.level,
      proficiencyBonus: row.proficiencyBonus,
      featureKeys,
    };

    if (row.newCantrips > 0) {
      entry.newCantrips = row.newCantrips;
    }

    if (row.newSpells > 0) {
      entry.newSpells = row.newSpells;
    }

    for (const key of leafKeys) {
      const value = textToCell(row.columns[key] ?? '');

      if (value !== undefined) {
        entry[key] = value;
      }
    }

    Object.assign(entry, row.preserved);

    return entry;
  });
}

/**
 * Синтетические умения ASI для уровней с включённым чекбоксом, ключей
 * которых ещё нет среди обычных умений. Добавляются в `features`, чтобы
 * детальник показывал «Улучшение характеристик» и мастер находил умение.
 */
export function buildAsiFeatures(
  rows: EditableLevelRow[],
  existing: ClassFeature[],
  preserved: ReadonlyArray<ClassFeature> = [],
): ClassFeature[] {
  const existingKeys = new Set(existing.map((feature) => feature.key));
  const asiFeatures: ClassFeature[] = [];

  // Дары умения-повышения: класс называет в них категории черт, из которых
  // игрок берёт черту вместо прибавки. Форма их не правит, но и потерять не
  // должна — иначе на шаге характеристик предлагалась бы любая черта.
  // Правило у всех уровней повышения одно, поэтому дары берутся у того, у кого
  // они есть: у ступеней роста своих нет — механика умения выдаётся один раз
  const preservedFeatData = preserved.find(
    (feature) => feature.featData,
  )?.featData;

  for (const row of rows) {
    const key = `asi-${row.level}`;

    if (row.hasAsi && !existingKeys.has(key)) {
      const built: ClassFeature = {
        key,
        name: ASI_NAME,
        description: ASI_DESCRIPTION,
        level: row.level,
        abilityImprovement: true,
      };

      if (preservedFeatData) {
        built.featData = preservedFeatData;
      }

      asiFeatures.push(built);
    }
  }

  return asiFeatures;
}

/** Собирает определение подкласса из редактируемых полей. */
export function buildSubclass(subclass: EditableSubclass): SubclassDefinition {
  const baseFeatures = subclass.features
    .filter((feature) => feature.name.trim().length > 0)
    .flatMap((feature) => [
      buildFeature(feature, subclass.key),
      ...buildScalingFeatures(feature, subclass.key),
    ]);

  const asiFeatures = subclass.hasOwnTable
    ? buildAsiFeatures(subclass.levelTable, baseFeatures).map((feature) => ({
        ...feature,
        subclassKey: subclass.key,
      }))
    : [];

  const built: SubclassDefinition = {
    key: subclass.key,
    name: subclass.name.trim(),
    nameEn: subclass.nameEn.trim() || subclass.name.trim(),
    description: subclass.description.trim(),
    unlockLevel: Math.max(1, Math.round(subclass.unlockLevel || 1)),
    features: [...baseFeatures, ...asiFeatures],
  };

  if (subclass.sourceKey?.trim()) {
    built.sourceKey = subclass.sourceKey.trim();
    built.source = subclass.source;
  }

  const counters = [
    ...subclass.counters
      .filter((counter) => counter.name.trim().length > 0)
      .map((counter) => buildCounter(counter, subclass.key)),
    ...buildFeatureCounters(subclass.features, subclass.key),
  ];

  if (counters.length > 0) {
    built.counters = counters;
  }

  const spellcasting = buildSpellcasting(subclass.spellcasting);

  if (spellcasting) {
    built.spellcasting = spellcasting;
  }

  if (subclass.hasOwnTable) {
    const columns = buildColumns(subclass.tableColumns);

    if (columns.length > 0) {
      built.tableColumns = columns;
    }

    built.levelTable = buildLevelTable(
      subclass.levelTable,
      subclass.features,
      subclass.tableColumns,
    );
  }

  if (subclass.preservedFeatData) {
    built.featData = subclass.preservedFeatData;
  }

  if (subclass.preservedBonusSpells) {
    built.bonusSpells = subclass.preservedBonusSpells;
  }

  return built;
}

/** Опции типов заклинателей для USelect. */
export const CASTER_TYPE_OPTIONS: { value: CasterType; label: string }[] = [
  { value: 'full', label: 'Полный' },
  { value: 'half', label: 'Половинный' },
  { value: 'third', label: 'Третичный' },
  { value: 'pact', label: 'Пакт (колдун)' },
  { value: 'none', label: 'Нет' },
];

/** Опции восстановления счётчика. */
/** Опции кости хитов. */
export const HIT_DIE_OPTIONS: { value: HitDie; label: string }[] = [
  { value: 6, label: 'к6' },
  { value: 8, label: 'к8' },
  { value: 10, label: 'к10' },
  { value: 12, label: 'к12' },
];

/**
 * Пресет колонки таблицы прогрессии — частые «стандартные» колонки заклинателей
 * (заговоры/заклинания/подготовленные/ячейки), которые добавляются одной кнопкой
 * с каноническими ключами вместо ручного ввода. Уникальные для класса колонки
 * по-прежнему создаются вручную через «Колонка»/«Группа».
 */
export interface ColumnPreset {
  /** Уникальный id пресета (для кнопки). */
  id: string;
  /** Подпись кнопки. */
  button: string;
  /** Заголовок добавляемой колонки. */
  columnLabel: string;
  /** Ключ листовой колонки (для одиночной колонки). */
  key?: string;
  /** Подзаголовки группы (для колонки-группы). */
  children?: { key: string; label: string }[];
}

/**
 * Готовые «стандартные» колонки DND (ключи совпадают с SRD-классами PHB 2024,
 * чтобы копии классов из компендиума распознавались автоматически). Добавляются
 * пресет-кнопкой как залоченные (название и ключ не редактируются).
 */
export const COLUMN_PRESETS: ColumnPreset[] = [
  // Заклинатели
  {
    id: 'cantripsKnown',
    button: 'Заговоры',
    columnLabel: 'Известные заговоры',
    key: 'cantripsKnown',
  },
  {
    id: 'knownSpells',
    button: 'Известные закл.',
    columnLabel: 'Известные заклинания',
    key: 'knownSpells',
  },
  {
    id: 'preparedSpells',
    button: 'Подготовл.',
    columnLabel: 'Подготовленные заклинания',
    key: 'preparedSpells',
  },
  {
    id: 'spellSlots',
    button: 'Ячейки закл.',
    columnLabel: 'Ячейки заклинаний',
    children: Array.from({ length: 9 }, (_unused, index) => ({
      key: `spellSlots${index + 1}`,
      label: String(index + 1),
    })),
  },
  {
    id: 'pactSlots',
    button: 'Ячейки пакта',
    columnLabel: 'Ячейки пакта',
    key: 'pactSlots',
  },
  {
    id: 'pactSlotLevel',
    button: 'Ур. ячеек пакта',
    columnLabel: 'Уровень ячеек пакта',
    key: 'pactSlotLevel',
  },
  // Классовые ресурсы
  {
    id: 'sorceryPoints',
    button: 'Очки чародейства',
    columnLabel: 'Очки чародейства',
    key: 'sorceryPoints',
  },
  {
    id: 'disciplinePoints',
    button: 'Очки дисциплины',
    columnLabel: 'Очки дисциплины',
    key: 'disciplinePoints',
  },
  {
    id: 'martialArtsDie',
    button: 'Кость БИ',
    columnLabel: 'Кость боевых искусств',
    key: 'martialArtsDie',
  },
  {
    id: 'unarmoredMovementBonus',
    button: 'Скор. без доспехов',
    columnLabel: 'Скорость без доспехов',
    key: 'unarmoredMovementBonus',
  },
  {
    id: 'rageUses',
    button: 'Ярости',
    columnLabel: 'Ярости',
    key: 'rageUses',
  },
  {
    id: 'rageDamage',
    button: 'Урон ярости',
    columnLabel: 'Урон ярости',
    key: 'rageDamage',
  },
  {
    id: 'sneakAttackDice',
    button: 'Скрытая атака',
    columnLabel: 'Скрытая атака',
    key: 'sneakAttackDice',
  },
  {
    id: 'weaponMasteries',
    button: 'Оруж. приёмы',
    columnLabel: 'Оружейные приёмы',
    key: 'weaponMasteries',
  },
  {
    id: 'secondWindUses',
    button: 'Второе дыхание',
    columnLabel: 'Второе дыхание',
    key: 'secondWindUses',
  },
];

/** Все ключи, которые добавит пресет (лист или подзаголовки группы). */
export function presetKeys(preset: ColumnPreset): string[] {
  if (preset.children) {
    return preset.children.map((child) => child.key);
  }

  return preset.key ? [preset.key] : [];
}

/**
 * Множество всех ключей стандартных колонок (листовые + подзаголовки групп).
 * Плюс алиасы SRD без своей кнопки: `spellsKnown` (Мистический рыцарь, Таинств.
 * ловкач) — синоним `knownSpells`, чтобы такие колонки грузились залоченными.
 */
const STANDARD_COLUMN_KEYS = new Set<string>([
  ...COLUMN_PRESETS.flatMap((preset) => presetKeys(preset)),
  'spellsKnown',
]);

/**
 * Является ли колонка определением стандартной DND-колонки (по ключам). Лист —
 * если его ключ стандартный; группа — если все её подзаголовки стандартные.
 */
export function isStandardColumnDefinition(column: {
  key?: string;
  children?: { key: string }[];
}): boolean {
  if (column.children && column.children.length > 0) {
    return column.children.every((child) =>
      STANDARD_COLUMN_KEYS.has(child.key),
    );
  }

  return column.key ? STANDARD_COLUMN_KEYS.has(column.key) : false;
}

/** Строит редактируемую (залоченную) колонку из пресета с уникальными uid. */
export function buildPresetColumn(preset: ColumnPreset): EditableTableColumn {
  return {
    uid: generateId('tc'),
    key: preset.key ?? '',
    label: preset.columnLabel,
    children: (preset.children ?? []).map((child) => ({
      uid: generateId('tcc'),
      key: child.key,
      label: child.label,
    })),
    locked: true,
  };
}
