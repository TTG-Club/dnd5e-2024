/**
 * Типы данных системы классов D&D 5e (PHB 2024)
 *
 * Содержит определения классов (SRD), подклассов,
 * записи классов на акторе и вспомогательные утилиты.
 */

import type {
  AbilityType,
  ArmorCategory,
  SkillType,
  SourceDefinition,
} from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { FeatData } from './featTypes.js';
import type { StartingEquipmentOption } from './startingEquipment.js';

// ── Литеральные типы ─────────────────────────────────────────

/** Уникальный ключ класса */
export type ClassKey =
  | 'barbarian'
  | 'bard'
  | 'cleric'
  | 'druid'
  | 'fighter'
  | 'monk'
  | 'paladin'
  | 'ranger'
  | 'rogue'
  | 'sorcerer'
  | 'warlock'
  | 'wizard';

/** Тип заклинателя */
export type CasterType = 'full' | 'half' | 'third' | 'pact' | 'none';

/** Тип кости хитов */
export type HitDie = 6 | 8 | 10 | 12;

/** Кости хитов в порядке показа (селекторы окон хитов актёра и существа) */
export const HIT_DIE_OPTIONS: readonly HitDie[] = [6, 8, 10, 12];

/** Множество допустимых костей хитов для быстрой проверки */
const HIT_DIE_SET: ReadonlySet<number> = new Set(HIT_DIE_OPTIONS);

/**
 * Проверяет, является ли число костью хитов (`HitDie`).
 * Значение приходит из селектора окна и из записей мира, где на его месте
 * может оказаться любое число.
 *
 * @param value - произвольное число для проверки
 * @returns `true`, если это кость хитов системы
 */
export function isHitDie(value: number): value is HitDie {
  return HIT_DIE_SET.has(value);
}

/**
 * Группа костей хитов одного размера без привязки к классу
 * (для NPC и кастомных актёров без классов).
 */
export interface ManualHitDieGroup {
  /** Размер кости (к6/к8/к10/к12) */
  die: HitDie;
  /** Всего костей в группе */
  total: number;
  /** Использовано костей */
  used: number;
}

/** Способ определения ХП при повышении уровня */
export type HitPointMethod = 'roll' | 'average' | 'max' | 'custom';

/**
 * Каким отдыхом восстанавливается ресурс.
 *
 * Короткий отдых в правилах короче продолжительного, поэтому ресурс, который
 * вернул короткий, возвращает и продолжительный: `short` и `short-one`
 * различаются только порцией короткого отдыха — целиком или один заряд
 * («Второе дыхание» и «Вдохновение барда» правил 2024 года).
 */
export type CounterRecovery = 'short' | 'long' | 'short-one';

// ── Счётчики классовых ресурсов ──────────────────────────────

/**
 * Определение счётчика класса/подкласса (SRD)
 *
 * Описывает ресурс, который класс или подкласс получает на определённом уровне
 * и который восстанавливается после короткого или продолжительного отдыха.
 * Примеры: очки чародейства, кости превосходства, очки духа, ярость.
 */
export interface ClassCounterDefinition {
  /** Уникальный ключ (напр. 'sorcery-points', 'superiority-dice') */
  key: string;
  /** Название на русском */
  name: string;
  /** Краткое название для компактного отображения в интерфейсе */
  shortName?: string;
  /** Название на английском */
  nameEn?: string;
  /** Уровень, с которого доступен счётчик */
  startLevel: number;
  /** Тип восстановления */
  recovery: CounterRecovery;
  /**
   * Показывать ресурс колонкой таблицы прогрессии.
   *
   * Ряд по уровням у ресурса уже задан прогрессией либо формулой, и колонка
   * собирается из него ({@link withCounterTableColumns}): второй раз те же числа
   * автор не набирает. Колонка выводится, только если ряд считается от одного
   * уровня — у максимума по модификатору характеристики его нет.
   */
  showInTable?: boolean;
  /**
   * Нижняя граница максимума; нет или 0 — границы нет.
   *
   * Подпирает расчёт снизу, а не складывается с ним: вдохновение барда равно
   * модификатору Харизмы, но не меньше одного — с Харизмой +0 бард всё равно
   * вдохновляет один раз, а с Харизмой +2 вдохновений два, а не три.
   */
  min?: number;
  /**
   * Прогрессия максимального значения по уровням.
   * Ключ — уровень (строка "1"–"20"), значение — максимальное количество.
   * Если не задано — используется formula.
   */
  progression?: Record<string, number>;
  /**
   * Формула расчёта максимума (если progression не задан).
   * Например: "level" (равно уровню), "level * 5", "chaMod" (мод. Харизмы).
   */
  formula?: string;

  /** Ключ подкласса, если счётчик от подкласса */
  subclassKey?: string;
}

// ── Особенности класса ───────────────────────────────────────

/** Вариант выбора в рамках особенности (напр. Боевой стиль) */
export interface ClassFeatureChoice {
  /** Уникальный ключ варианта */
  key: string;
  /** Название на русском */
  name: string;
  /** Описание варианта */
  description: string;
  /**
   * Уровень класса, с которого вариант доступен; нет — доступен сразу.
   *
   * Часть вариантов открывается позже самого умения: воззвание «для колдуна
   * 5 уровня» на первом ещё не предлагают, хотя умение получено на первом.
   */
  requiredLevel?: number;
}

/**
 * Настройка выбора из {@link ClassFeature.choices}: сколько вариантов берут и
 * как это число растёт по уровням класса.
 *
 * Поля нет у умения, список вариантов которого справочный, — такие варианты
 * только показываются описанием. Так же выгружает их компендиум TTG Club
 * ({@code VttgClass.ChoiceConfig}): пока настройки нет, потребитель ведёт себя
 * как прежде и спрашивает один вариант.
 */
export interface ClassFeatureChoiceConfig {
  /** Подпись выбора («Таинственные воззвания») */
  label?: string;
  /** Сколько вариантов берут на уровне получения умения */
  count?: number;
  /**
   * Сколько вариантов выбрано ВСЕГО к уровню: ключ — уровень класса строкой,
   * значение — итог, а не прибавка (как у {@link ClassCounterDefinition.progression}).
   * У колдуна одно воззвание с первого уровня и три со второго — значит, на
   * втором он выбирает два новых.
   */
  progression?: Record<string, number>;
}

/**
 * Вариант стартового снаряжения класса.
 *
 * Позиции ({@link StartingEquipmentOption.items}) необязательны: без них
 * вариант только показывается строкой, как было до их появления.
 */
export interface ClassStartingEquipmentOption extends StartingEquipmentOption {
  /** Ключ варианта (напр. 'A', 'B', 'C') */
  key: string;
}

/**
 * Выбор владения навыками, который даёт само умение класса или подкласса.
 * Отдельно от `ClassDefinition.skillChoices`: те навыки берут при взятии
 * первого уровня класса, эти — на уровне конкретного умения.
 */
export interface ClassFeatureSkillChoice {
  /** Сколько навыков выбирают */
  count: number;
  /** Пул навыков; пустой список — любой навык */
  from: SkillType[];
}

/** Особенность класса, получаемая на определённом уровне */
export interface ClassFeature {
  /** Уникальный ключ (напр. 'fighting-style', 'second-wind') */
  key: string;
  /** Название на русском */
  name: string;
  /** Описание */
  description: string;
  /** Уровень, на котором получается */
  level: number;
  /** Принадлежит ли подклассу (ключ подкласса) */
  subclassKey?: string;
  /** Требуется ли выбор варианта (напр. Боевой стиль) */
  choices?: ClassFeatureChoice[];
  /**
   * Настройка выбора из {@link choices}: сколько вариантов берут и как число
   * растёт по уровням. Нет — список справочный либо выбирают ровно один
   * вариант, как было до её появления.
   */
  choiceConfig?: ClassFeatureChoiceConfig;
  /**
   * Умение повышает характеристики: на его уровне мастер класса показывает шаг
   * «+2 к одной или +1 к двум, либо черта».
   *
   * Явный признак вместо угадывания по ключу: до его появления ASI опознавался
   * по `key.startsWith('asi-')`, и на самописных или переведённых классах шаг
   * молча пропадал. Эвристика осталась запасным вариантом для записей, где поле
   * не заполнено, — см. `isAsiFeature` в `classEditorTypes.ts`.
   */
  abilityImprovement?: boolean;
  /**
   * Умение даёт владение навыками на выбор («Эксперт», умения подклассов).
   * Мастер класса показывает на его уровне отдельный шаг выбора.
   */
  skillChoice?: ClassFeatureSkillChoice;
  /** Если true - особенность не добавляется в финальный лист актора, служит только как инфо в повышении уровня */
  isInformationalOnly?: boolean;
  /**
   * ID заклинаний компендиума, которые умение предоставляет автоматически
   * (напр. «Избранный враг» следопыта даёт «Метку охотника»).
   * Такие заклинания всегда подготовлены и не тратят лимит ручного выбора.
   */
  grantedSpells?: string[];
  /**
   * Поуровневая выдача заклинаний умением: ключ — уровень КЛАССА (строка
   * «1»–«20»), значение — ID заклинаний компендиума, выдаваемых на этом
   * уровне. Используется для списков доменов/клятв/покровителей
   * («3 уровень: …, 5 уровень: …»). Правила те же, что у `grantedSpells`.
   */
  grantedSpellsByLevel?: Record<string, string[]>;
  /**
   * Активные эффекты умения: то, что меняет числа листа готовой формулой.
   *
   * Переносятся на актора, когда умение получено, — так же, как эффекты
   * предыстории при её применении. Соседом описания, а не его частью: эффект
   * живёт на акторе своей записью, и её видно на вкладке эффектов.
   */
  activeEffects?: ActiveEffect[];
  /**
   * Дары умения: владения, языки, защиты, чувства, выборы игрока, расширение
   * списка заклинаний.
   *
   * Той же моделью, что у черты и предыстории ({@link FeatData}): набор даров у
   * них общий, лист применяет их одним и тем же кодом, и своя модель для того
   * же смысла означала бы второй разбор и второе применение.
   *
   * Заклинаний и ресурсов здесь не бывает: у умения класса они выведены своими
   * полями — {@link ClassFeature.grantedSpells} и счётчиками класса, — и повтор
   * выдал бы то же самое дважды.
   */
  featData?: FeatData;
}

// ── Подкласс ─────────────────────────────────────────────────

/** Определение подкласса */
export interface SubclassDefinition {
  /** Уникальный ключ подкласса */
  key: string;
  /** Название на русском */
  name: string;
  /** Название на английском */
  nameEn: string;
  /** Описание */
  description: string;
  /** Уровень, на котором выбирается подкласс */
  unlockLevel: number;
  /** Особенности подкласса (по уровням) */
  features: ClassFeature[];
  /** Дополнительные заклинания (для подклассов заклинателей) */
  bonusSpells?: Array<{ spellLevel: number; spells: string[] }>;
  /** Ключ источника-книги — аббревиатура в нижнем регистре (напр. 'phb', 'dmg') */
  sourceKey?: string;
  /** Название источника, если его нет ни во встроенном справочнике, ни в паке */
  source?: SourceDefinition;
  /**
   * Заклинательная конфигурация подкласса.
   * Используется для подклассов с собственной магией (например, Мистический рыцарь, Таинственный стрелок).
   */
  spellcasting?: {
    /** Тип заклинателя */
    type: CasterType;
    /** Характеристика заклинания */
    ability: AbilityType;
    /** Уровень, с которого начинается заклинание */
    startLevel: number;
  };
  /**
   * Таблица прогрессии подкласса (уровни 1-20).
   * Используется для подклассов с собственной прогрессией (например, Мистический рыцарь).
   * Если задана — заменяет таблицу базового класса при просмотре подкласса.
   */
  levelTable?: ClassLevelEntry[];
  /**
   * Колонки таблицы прогрессии подкласса.
   * Используется совместно с levelTable.
   */
  tableColumns?: ClassTableColumnDefinition[];
  /** Счётчики подклассовых ресурсов (напр. кости превосходства) */
  counters?: ClassCounterDefinition[];
  /** Активные эффекты подкласса; переносятся на актора при его выборе. */
  activeEffects?: ActiveEffect[];
  /** Дары подкласса той же моделью, что у черты; см. {@link ClassFeature.featData}. */
  featData?: FeatData;
}

// ── Определение класса (SRD) ─────────────────────────────────

/** Запись таблицы прогрессии класса (для каждого уровня 1-20) */
/**
 * Колонка таблицы прогрессии: ключ значения в строке уровня и подпись.
 *
 * Одним типом на класс и подкласс: форма у них общая, а две копии разошлись бы
 * при первой же правке.
 */
export interface ClassTableColumnDefinition {
  /** Ключ значения в строке {@link ClassLevelEntry} */
  key?: string;
  /** Человекочитаемое название колонки */
  label: string;
  /** Подколонки для группировки заголовков (Ячейки заклинаний → 1, 2, 3…) */
  children?: Array<{
    key: string;
    label: string;
  }>;
}

export interface ClassLevelEntry {
  /** Уровень (1-20) */
  level: number;
  /** Бонус мастерства */
  proficiencyBonus: number;
  /** Массив ключей полученных способностей (ссылается на features) */
  featureKeys: string[];

  /** Сколько НОВЫХ заговоров выбрать при получении этого уровня */
  newCantrips?: number;
  /** Сколько НОВЫХ заклинаний 1+ уровня выбрать при получении этого уровня (свободный выбор круга) */
  newSpells?: number;
  /**
   * Покруговое ограничение выбора новых заклинаний.
   * Ключ — круг заклинания (строка "1"–"9"), значение — количество.
   * Если задано — заменяет `newSpells`, игрок выбирает строго указанное количество из каждого круга.
   */
  newSpellsByLevel?: Record<string, number>;

  /** Динамические колонки (например, cantripsKnown, sneakAttack, kiPoints) */
  [key: string]:
    string | number | boolean | string[] | Record<string, number> | undefined;
}

/**
 * Определение класса D&D 5e (PHB 2024)
 *
 * Хранится в SRD JSON-файлах (srd/classes/fighter.json и т.д.).
 * Описывает все характеристики класса, не привязанные к конкретному актору.
 */
export interface ClassDefinition {
  /** Дискриминантное поле типа записи компендиума */
  type: 'class';
  /**
   * Уникальный ключ класса.
   *
   * Для канонических SRD-классов совпадает с {@link ClassKey} (12 значений),
   * но тип намеренно расширен до `string`, чтобы в мире можно было создавать
   * хоумбрю-классы с произвольным slug-ключом (как у видов/предысторий).
   */
  key: string;
  /** Название на русском */
  name: string;
  /** Название на английском */
  nameEn?: string;
  /** Описание класса */
  description?: string;
  /** Иконка для UI (формат: 'tabler:icon-name') */
  icon?: string;
  /** Ключ источника-книги — аббревиатура в нижнем регистре (напр. 'phb', 'dmg') */
  sourceKey?: string;
  /** Название источника, если его нет ни во встроенном справочнике, ни в паке */
  source?: SourceDefinition;
  /** Принадлежит ли классу к System Reference Document (SRD) */
  isSRD?: boolean;

  // --- Базовая механика ---
  /** Кость хитов (d6/d8/d10/d12) */
  hitDie: HitDie;

  // --- Владения ---
  /** Владения: доспехи */
  armorProficiencies: ArmorCategory[];
  /** Владения: оружие (ключи baseType или 'simple'/'martial') */
  weaponProficiencies: string[];
  /** Владения: инструменты */
  toolProficiencies?: string[];
  /** Владения: спасброски */
  savingThrowProficiencies: AbilityType[];
  /** Выбор навыков: количество и список для выбора */
  skillChoices: {
    /** Сколько навыков выбрать */
    count: number;
    /** Из какого списка */
    from: SkillType[];
  };

  /** Начальное снаряжение. Массив вариантов выбора (А, Б, В). */
  startingEquipment?: ClassStartingEquipmentOption[];

  /** Настраиваемые дополнительные колонки для таблицы уровней (например: Скрытая атака, Второе дыхание) */
  tableColumns?: ClassTableColumnDefinition[];

  // --- Заклинательная способность ---
  /** Конфигурация заклинаний (null = нет заклинаний) */
  spellcasting?: {
    /** Тип заклинателя */
    type: CasterType;
    /** Характеристика заклинания */
    ability: AbilityType;
    /** Уровень, с которого начинается заклинание */
    startLevel: number;
  } | null;

  // --- Подклассы ---
  /** Уровень выбора подкласса */
  subclassLevel: number;
  /** Название группы подклассов («Воинский архетип», «Магическая традиция») */
  subclassLabel: string;
  /** Доступные подклассы */
  subclasses: SubclassDefinition[];

  // --- Прогрессия ---
  /** Особенности класса (все уровни) */
  features: ClassFeature[];
  /** Таблица прогрессии (уровни 1-20) */
  levelTable: ClassLevelEntry[];

  // --- Счётчики ---
  /** Счётчики классовых ресурсов (напр. очки чародейства, ярость) */
  counters?: ClassCounterDefinition[];

  // --- Мультикласс ---
  /**
   * Владения, получаемые при взятии этого класса как мультикласса (НЕ первый
   * класс персонажа). Для 12 канонических SRD-классов берётся из таблицы
   * {@link MULTICLASS_PROFICIENCIES} по ключу; для хоумбрю-классов (ключ вне
   * {@link ClassKey}) задаётся здесь явно в редакторе. Резолвится единым
   * хелпером {@link getMulticlassProficiencies}.
   */
  multiclassProficiencies?: MulticlassProficiencies;

  /**
   * Активные эффекты самого класса. Переносятся на актора при взятии первого
   * уровня в классе и снимаются вместе с ним.
   *
   * Нужны тому, что даёт класс целиком и не привязано к одному умению, — а
   * заодно держат класс в одном ряду с видом, предысторией, чертой и предметом:
   * лист применяет эффект одинаково, откуда бы тот ни пришёл.
   */
  activeEffects?: ActiveEffect[];

  /**
   * Дары самого класса той же моделью, что у черты. Применяются при взятии
   * первого уровня в классе; см. {@link ClassFeature.featData}.
   */
  featData?: FeatData;
}

// ── Класс на акторе ──────────────────────────────────────────

/** Запись ХП, полученных на конкретном уровне */
export interface HitPointGain {
  /** Уровень, на котором получены */
  level: number;
  /** Способ определения */
  method: HitPointMethod;
  /** Фактический результат (без мод. ТЕЛ) */
  rolled: number;
}

/**
 * Класс, принятый персонажем
 *
 * Хранится в `actor.system.classes[]`.
 * Каждая запись описывает один класс и его прогрессию на акторе.
 */
export interface ActorClassEntry {
  /** Ключ класса (из ClassDefinition.key) */
  classKey: string;
  /** Название класса (для отображения, если SRD недоступен) */
  className: string;
  /** Уровень в этом классе */
  level: number;
  /** Выбранный подкласс (null до subclassLevel) */
  subclassKey: string | null;
  /** Кость хитов (копия из ClassDefinition) */
  hitDie: HitDie;
  /** Использованные хитдайсы (для коротких отдыхов) */
  hitDiceUsed: number;
  /** История бросков ХП на каждый уровень (позволяет пересчёт при смене ТЕЛ) */
  hitPointsGained: HitPointGain[];
  /** Выбранные навыки при получении класса */
  chosenSkills: SkillType[];
  /** Выбранные варианты особенностей (featureKey → choiceKey) */
  featureChoices: Record<string, string>;
  /** Характеристика заклинателя (копия из ClassDefinition.spellcasting.ability) */
  spellcastingAbility?: AbilityType;
  /** Тип заклинателя (копия из ClassDefinition.spellcasting.type) */
  casterType?: CasterType;
}

// ── Утилиты ──────────────────────────────────────────────────

/**
 * Опознаёт ASI по ключу умения — запасной вариант для записей без флага
 * {@link ClassFeature.abilityImprovement}: старые паки компендиума и классы,
 * созданные до появления поля.
 *
 * @param featureKey - ключ умения
 */
export function isAsiFeatureKey(featureKey: string): boolean {
  return featureKey.startsWith('asi-') || featureKey === 'epic-boon';
}

/**
 * Повышает ли умение характеристики. Явный флаг важнее эвристики по ключу:
 * на самописных и переведённых классах ключ произвольный, и шаг повышения по
 * нему не находился.
 *
 * @param feature - умение класса или подкласса
 */
export function isAsiFeature(feature: ClassFeature): boolean {
  return feature.abilityImprovement ?? isAsiFeatureKey(feature.key);
}

/**
 * Умения класса и всех его подклассов одним списком — по ним ищут умение по
 * ключу из строки таблицы уровней.
 *
 * @param classDefinition - определение класса
 */
export function getAllClassFeatures(
  classDefinition: ClassDefinition,
): ClassFeature[] {
  return [
    ...classDefinition.features,
    ...(classDefinition.subclasses ?? []).flatMap(
      (subclass) => subclass.features,
    ),
  ];
}

/**
 * Даёт ли класс повышение характеристик на этом уровне.
 *
 * Ключи строки таблицы уровней резолвятся в сами умения: флаг живёт на умении,
 * а в таблице лежит только его ключ. Ключ, которому умения не нашлось, всё ещё
 * проверяется эвристикой — в старых паках таблица ссылается на «asi-4» без
 * отдельной записи умения.
 *
 * @param classDefinition - определение класса
 * @param level - уровень класса
 */
export function hasAbilityImprovementAtLevel(
  classDefinition: ClassDefinition,
  level: number,
): boolean {
  const levelEntry = classDefinition.levelTable.find(
    (row) => row.level === level,
  );

  if (!levelEntry) {
    return false;
  }

  const features = getAllClassFeatures(classDefinition);

  return levelEntry.featureKeys.some((key) => {
    const feature = features.find((entry) => entry.key === key);

    return feature ? isAsiFeature(feature) : isAsiFeatureKey(key);
  });
}

/**
 * Вычисляет суммарный уровень персонажа из массива классов
 *
 * @param classes - массив классов актора (может быть undefined/пустым)
 * @returns суммарный уровень (минимум 1)
 */
export function getTotalLevel(classes?: ActorClassEntry[]): number {
  if (!classes || classes.length === 0) {
    return 1;
  }

  return classes.reduce((sum, entry) => sum + entry.level, 0);
}

/**
 * Вычисляет максимальное здоровье из истории бросков ХП
 *
 * Формула: сумма всех hitPointsGained[].rolled + (мод. ТЕЛ × totalLevel)
 *
 * @param classes - массив классов актора
 * @param constitutionMod - модификатор Телосложения
 * @returns максимум ХП
 */
export function calculateMaxHP(
  classes: ActorClassEntry[],
  constitutionMod: number,
): number {
  if (classes.length === 0) {
    return 10 + constitutionMod;
  }

  const totalLevel = getTotalLevel(classes);

  const baseHP = classes.reduce((sum, entry) => {
    return (
      sum
      + entry.hitPointsGained.reduce((hpSum, gain) => hpSum + gain.rolled, 0)
    );
  }, 0);

  return Math.max(1, baseHP + constitutionMod * totalLevel);
}

// ── Мультикласс (PHB 2024) ───────────────────────────────────

/**
 * Владения, получаемые при мультиклассе (PHB 2024).
 *
 * Когда персонаж берёт первый уровень нового класса (не первый класс),
 * он получает только этот сокращённый набор, а НЕ полные стартовые владения.
 */
export interface MulticlassProficiencies {
  /** Владения доспехами */
  armor: ArmorCategory[];
  /** Владения оружием (категории 'simple'/'martial' или конкретные ключи) */
  weapons: string[];
  /** Владения инструментами */
  tools: string[];
  /** Количество навыков, которые можно выбрать из списка класса */
  skillChoices: number;
}

/** Таблица мультиклассовых владений (PHB 2024, глава «Мультикласс») */
export const MULTICLASS_PROFICIENCIES: Record<
  ClassKey,
  MulticlassProficiencies
> = {
  barbarian: {
    armor: ['shield'],
    weapons: ['simple', 'martial'],
    tools: [],
    skillChoices: 0,
  },
  bard: { armor: ['light'], weapons: [], tools: [], skillChoices: 1 },
  cleric: {
    armor: ['light', 'medium', 'shield'],
    weapons: [],
    tools: [],
    skillChoices: 0,
  },
  druid: {
    armor: ['light', 'medium', 'shield'],
    weapons: [],
    tools: [],
    skillChoices: 0,
  },
  fighter: {
    armor: ['light', 'medium', 'shield'],
    weapons: ['simple', 'martial'],
    tools: [],
    skillChoices: 0,
  },
  monk: { armor: [], weapons: ['simple'], tools: [], skillChoices: 0 },
  paladin: {
    armor: ['light', 'medium', 'shield'],
    weapons: ['simple', 'martial'],
    tools: [],
    skillChoices: 0,
  },
  ranger: {
    armor: ['light', 'medium', 'shield'],
    weapons: ['simple', 'martial'],
    tools: [],
    skillChoices: 1,
  },
  rogue: {
    armor: ['light'],
    weapons: [],
    tools: ['thieves-tools'],
    skillChoices: 1,
  },
  sorcerer: { armor: [], weapons: [], tools: [], skillChoices: 0 },
  warlock: {
    armor: ['light'],
    weapons: ['simple'],
    tools: [],
    skillChoices: 0,
  },
  wizard: { armor: [], weapons: [], tools: [], skillChoices: 0 },
};

/**
 * Возвращает владения для мультикласса по определению класса.
 *
 * Сначала смотрит явное поле `multiclassProficiencies` (хоумбрю-классы), затем
 * каноническую таблицу {@link MULTICLASS_PROFICIENCIES} по ключу (12 SRD-классов).
 * Для хоумбрю-класса без явного поля и неканоническим ключом вернёт `undefined`
 * — вызывающий код подставляет пустые значения.
 *
 * @param classDef - определение класса (нужны поля `key` и `multiclassProficiencies`)
 * @returns владения мультикласса или `undefined`
 */
export function getMulticlassProficiencies(
  classDef: Pick<ClassDefinition, 'key' | 'multiclassProficiencies'>,
): MulticlassProficiencies | undefined {
  if (classDef.multiclassProficiencies) {
    return classDef.multiclassProficiencies;
  }

  return Object.entries(MULTICLASS_PROFICIENCIES).find(
    ([canonicalKey]) => canonicalKey === classDef.key,
  )?.[1];
}

/** Локализованные названия классов */
export const CLASS_KEY_LABELS: Record<ClassKey, string> = {
  barbarian: 'Варвар',
  bard: 'Бард',
  cleric: 'Жрец',
  druid: 'Друид',
  fighter: 'Воин',
  monk: 'Монах',
  paladin: 'Паладин',
  ranger: 'Следопыт',
  rogue: 'Плут',
  sorcerer: 'Чародей',
  warlock: 'Колдун',
  wizard: 'Волшебник',
};

/** Ключи классов в порядке показа */
export const CLASS_KEYS: readonly ClassKey[] = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
];

/** Опции классов для UI-селектов (мультиселект владельцев заклинания) */
export const CLASS_KEY_OPTIONS: { value: ClassKey; label: string }[] =
  CLASS_KEYS.map((value) => ({ value, label: CLASS_KEY_LABELS[value] }));

/**
 * Канонический ключ класса из ответа игрока или слага страницы: `wizard-phb` → `wizard`.
 * Слаг сайта несёт суффикс источника, а заклинание помечено голым ключом.
 *
 * @param value - ключ, ответ игрока или слаг страницы класса
 * @returns канонический ключ; `null` — такого класса в правилах нет
 */
export function classKeyFromUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return (
    CLASS_KEYS.find(
      (key) => normalized === key || normalized.startsWith(`${key}-`),
    ) ?? null
  );
}

/**
 * Ключ класса по его названию: «Волшебник» → `wizard`.
 *
 * Нужен там, где класс назван словом, а не ключом: предыстория выдаёт черту
 * «Посвящённый в магию (Волшебник)», и класс её списка приезжает только в этой
 * скобке. Сверка нестрогая по регистру и пробелам — подписи в паках приходят с
 * разным оформлением.
 *
 * @param name - название класса
 * @returns ключ класса; `null` — такого класса в правилах нет
 */
export function classKeyByName(name: string | undefined): ClassKey | null {
  const normalized = name?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return (
    CLASS_KEYS.find((key) => CLASS_KEY_LABELS[key].toLowerCase() === normalized)
    ?? null
  );
}
