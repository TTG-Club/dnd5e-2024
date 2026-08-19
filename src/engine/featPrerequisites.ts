/**
 * Проверка требований черты.
 *
 * Проверка МЯГКАЯ: результат говорит, чему персонаж не соответствует, но взять
 * черту не запрещает. За столом мастер разрешает исключения, а жёсткий запрет
 * вдобавок сломал бы уже собранных персонажей, у которых черта уже стоит.
 *
 * Второе правило — не врать: требование, которое проверить нечем (сеттинг
 * кампании, свободный текст, категория доспехов без справочника), в список
 * невыполненных НЕ попадает. Оно остаётся в описании и показывается как есть.
 *
 * @module system/dnd/featPrerequisites
 */

import type { DnDActor } from './dndEntities.js';
import type {
  FeatClassFeatureRequirement,
  FeatData,
  FeatPrerequisite,
  FeatPrerequisiteRef,
} from './featTypes.js';

import { getTotalLevel } from './classTypes.js';
import { ABILITY_LABELS } from './consts.js';

/** Итог проверки требований черты. */
export interface FeatPrerequisiteCheck {
  /** Персонаж соответствует всем требованиям, которые удалось проверить */
  met: boolean;
  /** Читаемые описания невыполненных требований — по одному на требование */
  unmet: string[];
}

/** Дополнительные справочники, без которых часть требований не проверяется. */
export interface FeatPrerequisiteContext {
  /**
   * Категория доспеха по ключу базового типа (`chain-mail` → `heavy`). На листе
   * владения доспехами хранятся ключами базовых типов, а требование задано
   * категорией. Не передан — требования к доспехам не проверяются.
   */
  armorCategoryOf?: (armorKey: string) => string | undefined;
}

/**
 * Канонические названия классовых умений, которых требуют черты. Совпадают с
 * названиями умений на листе: они приходят из определения класса, а туда — из
 * того же справочника, что и требование.
 */
export const CLASS_FEATURE_NAMES: Record<FeatClassFeatureRequirement, string> =
  {
    spellcasting: 'Использование заклинаний',
    pactMagic: 'Магия договора',
    fightingStyle: 'Боевой стиль',
    weaponMastery: 'Оружейные приёмы',
  };

/** Подписи требований для списка невыполненных. */
const UNMET_LABELS = {
  minLevel: 'Уровень персонажа не ниже ',
  abilityMin: ' не ниже ',
  abilityAnyOf: ' или ',
  spellcasting: 'Нужна способность творить заклинания',
  classFeature: 'Нужно умение: ',
  feats: 'Нужна черта: ',
  classes: 'Нужен класс: ',
  species: 'Нужен вид: ',
  backgrounds: 'Нужна предыстория: ',
  armor: 'Нужно владение доспехами: ',
  anyDragonmark: 'Нужна любая черта метки дракона',
  refSeparator: ' или ',
} as const;

/**
 * Черта метки дракона — по названию, а не по ссылке.
 *
 * Это единственное требование, которое сверяется названием: остальные приходят ссылками
 * на записи справочника и сверяются ключом ({@link refMatches}). Здесь ссылки нет и быть
 * не может — требование говорит «любая метка», а меток в справочнике десяток, и список
 * пришлось бы держать руками, устаревая с каждой новой.
 *
 * Русские названия идут либо «Метка …» («Метка исцеления»), либо через слово «дракон»
 * («Аберрантная метка дракона», «Малая метка дракона»); английские — «Mark of …» и
 * «… Dragonmark».
 */
const DRAGONMARK_NAME =
  /(?:^|\s)метк\w*|дракон\w*\s+метк|dragonmark|(?:^|\s)mark\s+of\s/i;

/** Подписи категорий доспехов для читаемого требования. */
const ARMOR_CATEGORY_LABELS: Record<string, string> = {
  light: 'лёгкие',
  medium: 'средние',
  heavy: 'тяжёлые',
  shield: 'щиты',
};

/**
 * Совпадает ли ссылка справочника с записью листа.
 *
 * Слаг страницы несёт суффикс источника (`wizard-phb`), а лист хранит голый
 * ключ (`wizard`), поэтому сверяются оба конца: ключ как начало слага и
 * названия без учёта регистра.
 *
 * @param ref - ссылка из требования
 * @param key - ключ записи на листе
 * @param name - название записи на листе
 */
function refMatches(
  ref: FeatPrerequisiteRef,
  key: string | undefined,
  name: string | undefined,
): boolean {
  const url = ref.url?.toLowerCase() ?? '';
  const entryKey = key?.toLowerCase() ?? '';

  if (entryKey && url && (url === entryKey || url.startsWith(`${entryKey}-`))) {
    return true;
  }

  const refName = ref.name?.trim().toLowerCase() ?? '';
  const entryName = name?.trim().toLowerCase() ?? '';

  return Boolean(refName) && refName === entryName;
}

/** Перечисление ссылок через «или» для строки невыполненного требования. */
function listRefs(refs: FeatPrerequisiteRef[]): string {
  return refs
    .map((ref) => ref.name || ref.url)
    .filter(Boolean)
    .join(UNMET_LABELS.refSeparator);
}

/** Названия умений персонажа в нижнем регистре — для сверки с требованиями. */
function featureNames(actor: DnDActor): Set<string> {
  return new Set(
    (actor.features ?? []).map((feature) => feature.name.trim().toLowerCase()),
  );
}

/**
 * Взята ли персонажем хоть одна черта метки дракона.
 *
 * Смотрим только на черты: «метка» встречается и в названиях заклинаний
 * («Метка охотника»), а требование говорит именно о черте.
 */
function hasDragonmarkFeat(actor: DnDActor): boolean {
  return (actor.features ?? []).some(
    (feature) =>
      feature.featureType === 'feat'
      && (DRAGONMARK_NAME.test(feature.name ?? '')
        || DRAGONMARK_NAME.test(feature.nameEn ?? '')),
  );
}

/**
 * Есть ли у персонажа классовое умение, которого требует черта.
 *
 * «Использование заклинаний» дополнительно засчитывается по заклинательной
 * характеристике класса: у части классов умение с таким названием на листе не
 * заводится, а заклинательство при этом настроено.
 */
function hasClassFeature(
  actor: DnDActor,
  requirement: FeatClassFeatureRequirement,
  names: Set<string>,
): boolean {
  if (names.has(CLASS_FEATURE_NAMES[requirement].toLowerCase())) {
    return true;
  }

  return (
    requirement === 'spellcasting'
    && (actor.system.classes ?? []).some((entry) => entry.spellcastingAbility)
  );
}

/** Проверяет требования к значениям характеристик обеих форм записи. */
function checkAbilities(
  prerequisite: FeatPrerequisite,
  actor: DnDActor,
  unmet: string[],
): void {
  const scores = actor.system.abilities;

  for (const [ability, minValue] of Object.entries(
    prerequisite.abilities ?? {},
  )) {
    const key = ability as keyof typeof scores;

    if (minValue && scores[key] < minValue) {
      unmet.push(`${ABILITY_LABELS[key]}${UNMET_LABELS.abilityMin}${minValue}`);
    }
  }

  for (const requirement of prerequisite.abilityRequirements ?? []) {
    const minValue = requirement.minValue ?? 0;

    if (minValue <= 0 || requirement.anyOf.length === 0) {
      continue;
    }

    const satisfied = requirement.anyOf.some(
      (ability) => scores[ability] >= minValue,
    );

    if (!satisfied) {
      const names = requirement.anyOf
        .map((ability) => ABILITY_LABELS[ability])
        .join(UNMET_LABELS.abilityAnyOf);

      unmet.push(`${names}${UNMET_LABELS.abilityMin}${minValue}`);
    }
  }
}

/** Проверяет требования к записям справочника: черты, классы, вид, предыстория. */
function checkReferences(
  prerequisite: FeatPrerequisite,
  actor: DnDActor,
  unmet: string[],
): void {
  const feats = (actor.features ?? []).filter(
    (feature) => feature.featureType === 'feat',
  );

  if (prerequisite.feats?.length) {
    const has = prerequisite.feats.some((ref) =>
      feats.some((feature) => refMatches(ref, undefined, feature.name)),
    );

    if (!has) {
      unmet.push(UNMET_LABELS.feats + listRefs(prerequisite.feats));
    }
  }

  if (prerequisite.classes?.length) {
    const has = prerequisite.classes.some((ref) =>
      (actor.system.classes ?? []).some((entry) =>
        refMatches(ref, entry.classKey, entry.className),
      ),
    );

    if (!has) {
      unmet.push(UNMET_LABELS.classes + listRefs(prerequisite.classes));
    }
  }

  if (prerequisite.species?.length) {
    const species = actor.system.species;

    const has = prerequisite.species.some((ref) =>
      refMatches(ref, species?.speciesKey, species?.speciesName),
    );

    if (!has) {
      unmet.push(UNMET_LABELS.species + listRefs(prerequisite.species));
    }
  }

  if (prerequisite.backgrounds?.length) {
    const background = actor.system.background;

    const has = prerequisite.backgrounds.some((ref) =>
      refMatches(ref, background?.backgroundKey, background?.backgroundName),
    );

    if (!has) {
      unmet.push(UNMET_LABELS.backgrounds + listRefs(prerequisite.backgrounds));
    }
  }
}

/**
 * Проверяет владение доспехами. Без резолвера категорий
 * ({@link FeatPrerequisiteContext.armorCategoryOf}) требование пропускается:
 * лист хранит ключи базовых типов, и сверить их с категорией нечем.
 */
function checkArmor(
  prerequisite: FeatPrerequisite,
  actor: DnDActor,
  context: FeatPrerequisiteContext,
  unmet: string[],
): void {
  const required = prerequisite.armorProficiency ?? [];

  if (required.length === 0 || !context.armorCategoryOf) {
    return;
  }

  const owned = new Set<string>();

  for (const armorKey of actor.system.proficiencies?.armor ?? []) {
    owned.add(armorKey);

    const category = context.armorCategoryOf(armorKey);

    if (category) {
      owned.add(category);
    }
  }

  const missing = required.filter((category) => !owned.has(category));

  if (missing.length > 0) {
    unmet.push(
      UNMET_LABELS.armor
        + missing
          .map((category) => ARMOR_CATEGORY_LABELS[category] ?? category)
          .join(', '),
    );
  }
}

/**
 * Проверяет требования черты по листу персонажа.
 *
 * @param featData - «дары» черты вместе с её требованиями
 * @param actor - лист персонажа
 * @param context - справочники для требований, которые иначе не проверить
 * @returns соответствие и список невыполненных требований
 */
export function checkFeatPrerequisites(
  featData: FeatData | undefined,
  actor: DnDActor,
  context: FeatPrerequisiteContext = {},
): FeatPrerequisiteCheck {
  const prerequisite = featData?.prerequisite;

  if (!prerequisite) {
    return { met: true, unmet: [] };
  }

  const unmet: string[] = [];

  if (
    prerequisite.minLevel
    && getTotalLevel(actor.system.classes) < prerequisite.minLevel
  ) {
    unmet.push(UNMET_LABELS.minLevel + prerequisite.minLevel);
  }

  checkAbilities(prerequisite, actor, unmet);

  const names = featureNames(actor);

  if (
    prerequisite.spellcasting
    && !hasClassFeature(actor, 'spellcasting', names)
  ) {
    unmet.push(UNMET_LABELS.spellcasting);
  }

  const classFeatures = prerequisite.classFeatures ?? [];

  if (
    classFeatures.length > 0
    && !classFeatures.some((requirement) =>
      hasClassFeature(actor, requirement, names),
    )
  ) {
    unmet.push(
      UNMET_LABELS.classFeature
        + classFeatures
          .map((requirement) => CLASS_FEATURE_NAMES[requirement])
          .join(UNMET_LABELS.refSeparator),
    );
  }

  if (prerequisite.anyDragonmark && !hasDragonmarkFeat(actor)) {
    unmet.push(UNMET_LABELS.anyDragonmark);
  }

  checkReferences(prerequisite, actor, unmet);
  checkArmor(prerequisite, actor, context, unmet);

  return { met: unmet.length === 0, unmet };
}
