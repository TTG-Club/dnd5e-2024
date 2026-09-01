/**
 * Ключ вида (открытый тип, как и `BackgroundKey`).
 *
 * Канонические виды SRD: `human`, `elf`, `dwarf`, `halfling`, `gnome`,
 * `half-orc`, `tiefling`, `dragonborn`, `goliath`, `aasimar`. Пользовательские
 * виды, созданные в мире, получают сгенерированный slug-ключ.
 */
export type SpeciesKey = string;

/**
 * Тип существа вида — тот же словарь, что и у статблока существа.
 *
 * Раньше это был свой союз с теми же значениями, и «Рой» жил только здесь:
 * статблок его не знал, а гейт урона «по такому-то типу» не срабатывал ни на
 * ком с этим типом. Один союз на оба места чинит расхождение навсегда.
 */
export type CreatureType = import('./creatureTypes.js').CreatureCategory;

export type SpeciesGrant =
  | SkillProficiencyGrant
  | WeaponProficiencyGrant
  | ArmorProficiencyGrant
  | ToolProficiencyGrant
  | SavingThrowProficiencyGrant
  | LanguageGrant
  | DamageDefenseGrant
  | ConditionImmunityGrant
  | DarkvisionGrant;

export interface SkillProficiencyGrant {
  type: 'skillProficiency';
  count: number;
  from: import('@vtt/shared').SkillType[];
}

export interface WeaponProficiencyGrant {
  type: 'weaponProficiency';
  items: string[];
  choices?: { count: number; from: string[] };
}

export interface ArmorProficiencyGrant {
  type: 'armorProficiency';
  items: string[];
  choices?: { count: number; from: string[] };
}

export interface ToolProficiencyGrant {
  type: 'toolProficiency';
  items: string[];
  choices?: { count: number; from: string[] };
}

export interface SavingThrowProficiencyGrant {
  type: 'savingThrowProficiency';
  abilities: import('@vtt/shared').AbilityType[];
}

export interface LanguageGrant {
  type: 'language';
  items: string[];
  choices?: { count: number; from: string[] };
}

/**
 * Защита вида по одному типу урона: к выбранному типу — сопротивление,
 * иммунитет или уязвимость (гибко, в отличие от прежнего «только сопротивление»).
 */
export interface DamageDefenseEntry {
  damageType: import('@vtt/shared').DefensibleDamageType;
  kind: import('./damageConstants.js').DamageDefenseKind;
}

export interface DamageDefenseGrant {
  type: 'damageDefense';
  /** Защиты по типам урона (для каждого типа — свой вид защиты). */
  entries: DamageDefenseEntry[];
}

export interface ConditionImmunityGrant {
  type: 'conditionImmunity';
  /** Состояния, к которым вид даёт иммунитет (для хоумбрю-видов). */
  conditions: import('./conditionKeys.js').ConditionKey[];
}

export interface DarkvisionGrant {
  type: 'darkvision';
  range: number;
}

/**
 * Встроенный вариант-подвид ЛЕГАСИ-формата.
 *
 * @deprecated Подвид теперь — самостоятельная запись вида со ссылкой
 * {@link SpeciesDefinition.parentKey} на родителя (как на сайте TTG Club).
 * Старые паки и хоумбрю-виды со встроенными вариантами продолжают читаться
 * (дуал-рид в мастере и просмотре), но новый редактор и новая выгрузка
 * встроенные варианты не пишут.
 */
export interface SpeciesFeatureChoice {
  key: string;
  name: string;
  description: string;
  /**
   * Особенности, которые даёт этот вариант (подвид) — со своими уровнями,
   * скоростью, тёмным зрением и заклинаниями. Применяются и появляются только
   * при выборе данного варианта. Здесь же — единственное место описания подвида,
   * без дублирования отдельными верхнеуровневыми особенностями.
   */
  features?: SpeciesFeature[];
  /**
   * Защиты от типов урона, которые даёт этот подвид (как у драконорождённых:
   * наследие → сопротивление своему типу урона). Применяются на 1 уровне при
   * выборе варианта, наравне с защитами основного вида (`DamageDefenseGrant`).
   */
  damageDefenses?: DamageDefenseEntry[];
  /** Иммунитеты к состояниям, которые даёт этот подвид. */
  conditionImmunities?: import('./conditionKeys.js').ConditionKey[];
}

/**
 * Заклинание, выдаваемое особенностью вида.
 *
 * Хранит имя (всегда) и опциональную связь с компендиумом по `spellId`.
 * - Со `spellId` — на применении вида ищется в компендиуме по id и авто-выдаётся
 *   (всегда подготовлено). Если компендиума нет — выдача пропускается, ставится
 *   пометка. Переносится между мирами: при отсутствии связи остаётся имя.
 * - Без `spellId` — просто имя (информационно), мастер добавляет заклинание сам.
 */
export interface GrantedSpellRef {
  name: string;
  spellId?: string;
  /**
   * Предпочтённый пак-компендиум, из которого брать заклинание (id манифеста).
   * При применении: есть такой пак — берём из него; нет (у другого мастера) —
   * откат к поиску по `spellId` в любом паке. Локальная подсказка, не ломает
   * переносимость.
   */
  packId?: string;
  /**
   * Уровень персонажа, с которого заклинание доступно; пусто — сразу.
   *
   * Нужен чертам: у метки дракона «Лечение ран» есть с самого начала, а «Малое
   * восстановление» приходит на третьем уровне. У вида и класса гейт свой — там
   * уровень стоит у самой особенности, — и поле остаётся пустым.
   */
  requiredLevel?: number;
}

/**
 * Прибавка/установка скорости движения, выдаваемая особенностью вида.
 * Значения трактуются как «не ниже» — итоговая скорость берётся как максимум
 * базовой скорости вида и всех применимых на текущем уровне даров.
 */
export interface SpeciesMovementGrant {
  walk?: number;
  fly?: number;
  swim?: number;
  climb?: number;
  burrow?: number;
}

export interface SpeciesFeature {
  key: string;
  name: string;
  description: string;
  /**
   * Уровень персонажа, на котором особенность появляется (по умолчанию 1).
   * Появляется в списке особенностей и применяет свои эффекты, когда суммарный
   * уровень персонажа достигает этого значения.
   */
  level?: number;
  /** Скорость движения, выдаваемая особенностью (полёт, плавание и т.д.). */
  movement?: SpeciesMovementGrant;
  /** Тёмное зрение (футы), выдаваемое особенностью. */
  darkvision?: number;
  /** @deprecated Встроенные варианты-подвиды легаси-формата; см. {@link SpeciesFeatureChoice}. */
  choices?: SpeciesFeatureChoice[];
  isInformationalOnly?: boolean;
  /**
   * Дары особенности блоком {@link import('./featTypes.js').FeatData} — той же
   * формы, что у черты, предыстории и умения класса: владения, модификаторы
   * листа, выборы игрока, счётчики, тёмное зрение. Так приезжает выгрузка сайта;
   * поля `movement`/`darkvision` выше остаются для легаси-паков и простых
   * хоумбрю-записей.
   */
  featData?: import('./featTypes.js').FeatData;
  /**
   * Заклинания, выдаваемые особенностью. Автор вписывает имя; при совпадении с
   * компендиумом связывает по `spellId` (тогда авто-выдача). Без связи —
   * информационно. См. {@link GrantedSpellRef}.
   */
  grantedSpells?: GrantedSpellRef[];
  /**
   * Активные эффекты умения: то, что меняет числа листа готовой формулой.
   *
   * Соседом даров, а не их частью: дар лист проставляет сам — владение, чувство,
   * скорость, — а эффект приезжает готовым, живёт на акторе своей записью, и её
   * видно на вкладке эффектов и можно временно отключить.
   */
  activeEffects?: import('./activeEffectTypes.js').ActiveEffect[];
}

/**
 * Рост вида в футах для одного размера: границы «от» и «до». Задавать можно
 * любую одну — у «Средний, от 5 фт.» верхней границы попросту нет.
 */
export interface SpeciesHeightRange {
  /** Нижняя граница роста в футах; пусто — не указана */
  from?: number;
  /** Верхняя граница роста в футах; пусто — не указана */
  to?: number;
}

export interface SpeciesDefinition {
  /** Дискриминантное поле типа записи компендиума */
  type: 'species';
  key: SpeciesKey;
  /**
   * Ключ родительского вида. Задан — запись является подвидом (происхождением)
   * этого вида: она не предлагается как самостоятельный вид, а появляется
   * вариантом после выбора родителя. Подвид — полноценная запись со своими
   * характеристиками, особенностями и дарами (как на сайте TTG Club).
   */
  parentKey?: SpeciesKey;
  name: string;
  nameEn: string;
  description: string;
  icon?: string;
  /** Ключ источника-книги — аббревиатура в нижнем регистре (напр. 'phb', 'dmg') */
  sourceKey?: string;
  /** Название источника, если его нет ни во встроенном справочнике, ни в паке */
  source?: import('@vtt/shared').SourceDefinition;
  /** Принадлежит ли виду к System Reference Document (SRD) */
  isSRD?: boolean;

  creatureType: CreatureType;
  size: import('@vtt/shared').CreatureSize[];

  /**
   * Рост в футах по каждому размеру из {@link SpeciesDefinition.size} — так же,
   * как его задаёт мастерская сайта. Величина справочная: на механику она не
   * влияет, но помогает игроку выбрать размер в мастере и стоит в карточке
   * вида. Ключи — только те размеры, у которых рост указан.
   */
  heights?: Partial<
    Record<import('@vtt/shared').CreatureSize, SpeciesHeightRange>
  >;

  speed: {
    walk: number;
    fly?: number;
    swim?: number;
    climb?: number;
    burrow?: number;
  };

  /**
   * Обычное зрение в футах — дальность зрения токена в дневном режиме
   * (`token.vision.range`). Пусто — у токена остаётся его значение по
   * умолчанию. Запись-подвид переопределяет родителя, как и скоростью.
   */
  vision?: number;

  /**
   * Дары записи легаси-формата (9 фиксированных типов). Читаются по-прежнему;
   * новый редактор и новая выгрузка пишут дары блоком {@link SpeciesDefinition.featData}.
   *
   * Поле НЕОБЯЗАТЕЛЬНОЕ: записи нового формата его не содержат вовсе — ни одна
   * запись вида в компендиуме TTG Club его уже не пишет. Читать `grants` как
   * гарантированный массив нельзя: мастер настройки так и падал на первой же
   * записи из компендиума.
   */
  grants?: SpeciesGrant[];

  /**
   * Дары записи блоком {@link import('./featTypes.js').FeatData} — механика вида
   * или происхождения целиком, той же формы, что у черты. Нужен прежде всего
   * подвидам без особенностей: приписать дар им больше некуда.
   */
  featData?: import('./featTypes.js').FeatData;

  features: SpeciesFeature[];

  /**
   * Активные эффекты самого вида или происхождения. Переносятся на актора при
   * выборе вида — так же, как эффекты предыстории при её применении.
   *
   * Нужны прежде всего происхождениям: умений у них не бывает, и приписать
   * эффект там было бы некуда.
   */
  activeEffects?: import('./activeEffectTypes.js').ActiveEffect[];
}

export interface ActorSpeciesEntry {
  speciesKey: string;
  speciesName: string;
  creatureType: CreatureType;
  size: import('@vtt/shared').CreatureSize;
  /**
   * Ключ выбранной записи-подвида (новая модель: подвид — самостоятельная
   * запись с {@link SpeciesDefinition.parentKey}). Пусто — подвид не выбран либо
   * вид использует легаси-варианты ({@link ActorSpeciesEntry.featureChoices}).
   */
  subspeciesKey?: string;
  /** Название выбранного подвида — снимок для показа без резолва записи. */
  subspeciesName?: string;
  /** Ответы по легаси-вариантам: ключ особенности → ключ выбранного варианта. */
  featureChoices: Record<string, string>;
  grantChoices: Record<number, string[]>;
  /**
   * Ответы на выборы блоков даров `featData`: ключ источника
   * ({@link import('./speciesGrants.js').SpeciesFeatDataSource.sourceKey}) →
   * ответы этого блока (ключ выбора → выбранные значения). По ним откат снимает
   * выданное выбором, не переспрашивая игрока.
   */
  featDataChoices?: Record<string, Record<string, string[]>>;
}
