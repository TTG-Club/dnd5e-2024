/**
 * Утилиты заклинаний, автоматически предоставляемых умениями (granted spells).
 *
 * Умения классов, видов, предысторий и черт могут содержать поле
 * `grantedSpells` — список ID заклинаний компендиума, которые персонаж
 * получает автоматически (напр. «Избранный враг» следопыта даёт
 * «Метку охотника»). Источник определяет, нужна ли их подготовка;
 * обычные заклинания книги готовятся в пределах нормы класса.
 */

import type { AbilityType } from '@vtt/shared';

import type { Spell, SpellGrantKind } from './dndEntities.js';
import type { FeatGrantedClassSpells } from './featTypes.js';
import type { GrantedSpellRef } from './speciesTypes.js';

import { generateId } from '@vtt/shared';

import { countsTowardPreparedSpells } from './preparedSpells.js';

// ── Типы ──────────────────────────────────────────────────────

/** Минимальная форма умения, способного предоставлять заклинания */
export interface FeatureWithGrantedSpells {
  /** Название умения (используется как источник в бейджах и при откате) */
  name: string;
  /** ID заклинаний компендиума, предоставляемых умением */
  grantedSpells?: string[];
}

/** Связь «заклинание компендиума → умение-источник» */
export interface GrantedSpellSource {
  /** ID заклинания в компендиуме */
  spellId: string;
  /** Название умения, предоставившего заклинание */
  featureName: string;
  /** Предпочтённый пак-компендиум (id манифеста); откат — любой пак по `spellId`. */
  packId?: string;
  /**
   * Заклинание не нужно готовить. По умолчанию (`undefined`) — нужно: так устроены
   * заклинания черт, где выдача занимает подготовку. У врождённых заклинаний вида
   * источник ставит флаг явно.
   */
  alwaysPrepared?: boolean;
  /**
   * Заклинательная характеристика умения-источника. Не задана — берётся общая
   * характеристика листа (класс-заклинатель).
   */
  castingAbility?: AbilityType;
  /** Чем выдано: не задано — решает тот, кто кладёт заклинание на лист */
  grantKind?: SpellGrantKind;
  /**
   * Ключ умения-источника. Названия умений класса и подкласса могут совпасть, а
   * ответ игрока в мастере привязан к конкретному умению.
   */
  featureKey?: string;
  /**
   * Заклинание назвал сам игрок: ответом на выбор записи либо на шаге «Выбрать
   * самому» списка класса. Такое заклинание класса мастер кладёт подготовленным,
   * пока в пределе подготовки есть место ({@link ChosenSpellPreparation}).
   */
  chosenByPlayer?: boolean;
}

/**
 * Запрос «выдать весь список класса» — уже с проверенным уровнем и посчитанным
 * кругом.
 *
 * Отдельно от {@link GrantedSpellSource}: там связь с конкретной записью, а здесь
 * правило, по которому записи ещё предстоит найти. Разворачивает его
 * {@link expandClassSpellRequests} — там, где загружен компендиум.
 */
export interface ClassSpellListRequest {
  /** Ключи классов, чьи списки выдаются (сверяются со `Spell.classKeys`) */
  classKeys: string[];
  /** Название умения-источника: с ним заклинание ложится на лист и им же снимается */
  featureName: string;
  /** Паки, из которых брать заклинания; пусто — из всех доступных */
  spellPackIds?: string[];
  /**
   * Пак записи-источника: при повторе заклинания в нескольких паках выдаётся
   * его копия. Не сужает выдачу, как {@link spellPackIds}, а лишь решает, чья
   * копия победит.
   */
  preferredPackId?: string;
  /** Ровно этот круг; пусто — круг сверху не ограничен */
  level?: number;
  /**
   * Не выше этого круга; пусто — верхней границы нет. У группы «по ячейкам» сюда уже
   * подставлен наибольший круг, который персонаж способен наложить.
   */
  maxLevel?: number;
  /** Заклинание не нужно готовить (см. {@link GrantedSpellSource.alwaysPrepared}) */
  alwaysPrepared?: boolean;
  /** Заклинательная характеристика умения-источника */
  castingAbility?: AbilityType;
  /** Чем выдано (см. {@link GrantedSpellSource.grantKind}) */
  grantKind?: SpellGrantKind;
  /** Ключ умения-источника (см. {@link GrantedSpellSource.featureKey}) */
  featureKey?: string;
}

/** Заклинания одного пака — вход разворота списков классов. */
export interface ClassSpellPack {
  packId: string;
  spells: Spell[];
}

/** Заклинание компендиума, сопоставленное с умением-источником */
export interface ResolvedGrantedSpell {
  /** Полные данные заклинания из компендиума */
  spell: Spell;
  /** Название умения, предоставившего заклинание */
  featureName: string;
  /** Заклинание не нужно готовить (см. {@link GrantedSpellSource.alwaysPrepared}) */
  alwaysPrepared?: boolean;
  /** Заклинательная характеристика умения-источника */
  castingAbility?: AbilityType;
  /** Чем выдано (см. {@link GrantedSpellSource.grantKind}) */
  grantKind?: SpellGrantKind;
  /** Ключ умения-источника (см. {@link GrantedSpellSource.featureKey}) */
  featureKey?: string;
  /** Заклинание назвал сам игрок (см. {@link GrantedSpellSource.chosenByPlayer}) */
  chosenByPlayer?: boolean;
}

/**
 * Подготовка заклинаний, которые игрок выбрал сам: по правилам 2024 выбранное и
 * есть подготовленное. Передаёт её мастер класса — там выбор и делается; выдача
 * черты, вида и предыстории её не передаёт, и там всё ложится как прежде.
 */
export interface ChosenSpellPreparation {
  /**
   * Предел подготовки листа после выдачи: таблицы классов с поправками листа.
   * null — предела нет, и подготовленным ложится всё выбранное.
   */
  limit: number | null;
}

// ── Утилиты ───────────────────────────────────────────────────

/**
 * Собирает связи «заклинание → умение-источник» из списка умений.
 *
 * @param features - умения (класса, вида, черты), возможно с `grantedSpells`
 * @returns плоский список связей без дубликатов по ID заклинания
 */
export function collectGrantedSpellSources(
  features: ReadonlyArray<FeatureWithGrantedSpells>,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  for (const feature of features) {
    for (const spellId of feature.grantedSpells ?? []) {
      if (seenSpellIds.has(spellId)) {
        continue;
      }

      seenSpellIds.add(spellId);
      sources.push({ spellId, featureName: feature.name });
    }
  }

  return sources;
}

/**
 * Умение класса с поуровневой выдачей заклинаний.
 *
 * Расширяет {@link FeatureWithGrantedSpells} уровнем получения умения
 * и картой «уровень класса → ID заклинаний» для списков, выдаваемых
 * частями (домены жреца, клятвы паладина, покровители колдуна).
 */
export interface LeveledFeatureWithGrantedSpells extends FeatureWithGrantedSpells {
  /** Уровень класса, на котором умение получается */
  level?: number;
  /** Поуровневая выдача: ключ — уровень класса (строка «1»–«20») */
  grantedSpellsByLevel?: Record<string, string[]>;
  /**
   * Блоб даров умения: в полях записи заклинание лежит одним id, а характеристику
   * и подготовку задаёт группа выдачи — они уезжают вместе со ссылкой в блоб.
   * Отсюда они и берутся, чтобы поля записи и блоб не разошлись.
   */
  featData?: {
    grantedSpells?: GrantedSpellRef[];
    grantedSpellsAlwaysPrepared?: boolean;
    spellcastingAbility?: AbilityType;
  };
}

/**
 * Умение класса на листе персонажа: то же умение компендиума, про которое
 * известно, какого уровня персонаж достиг в его классе.
 */
export interface SheetClassFeature extends LeveledFeatureWithGrantedSpells {
  /** Уровень персонажа в классе умения; не задан — открытое не определить */
  classLevel?: number;
}

/**
 * Собирает granted-заклинания, получаемые ровно на указанном уровне класса.
 *
 * Учитываются два источника:
 * - `grantedSpells` умений, получаемых именно на этом уровне;
 * - `grantedSpellsByLevel[level]` всех умений, полученных не позже этого
 *   уровня (поуровневые списки доменов/клятв/покровителей).
 *
 * @param features - все умения класса и активного подкласса
 * @param classLevel - получаемый уровень класса
 * @returns плоский список связей без дубликатов по ID заклинания
 */
export function collectGrantedSpellSourcesForClassLevel(
  features: ReadonlyArray<LeveledFeatureWithGrantedSpells>,
  classLevel: number,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  for (const feature of features) {
    const gainedAtLevel = feature.level ?? 1;

    if (gainedAtLevel > classLevel) {
      continue;
    }

    const spellIds: string[] = [];

    if (gainedAtLevel === classLevel) {
      spellIds.push(...(feature.grantedSpells ?? []));
    }

    spellIds.push(
      ...(feature.grantedSpellsByLevel?.[String(classLevel)] ?? []),
    );

    const groupBySpellId = new Map(
      (feature.featData?.grantedSpells ?? [])
        .filter((ref): ref is GrantedSpellRef & { spellId: string } =>
          Boolean(ref.spellId),
        )
        .map((ref) => [ref.spellId, ref]),
    );

    for (const spellId of spellIds) {
      if (seenSpellIds.has(spellId)) {
        continue;
      }

      seenSpellIds.add(spellId);

      const group = groupBySpellId.get(spellId);

      sources.push({
        spellId,
        featureName: feature.name,
        alwaysPrepared:
          group?.alwaysPrepared
          ?? feature.featData?.grantedSpellsAlwaysPrepared,
        castingAbility:
          group?.spellcastingAbility ?? feature.featData?.spellcastingAbility,
        grantKind: 'class',
      });
    }
  }

  return sources;
}

/** Умение класса, способное выдать списки классов целиком */
export interface FeatureWithClassSpellLists {
  /** Ключ умения: по нему мастер помнит ответ игрока */
  key: string;
  /** Название умения — источник выдачи на листе */
  name: string;
  /** Уровень класса, на котором умение получается */
  level?: number;
  /** Списки классов полем умения (выгрузка сайта, редактор системы) */
  grantedClassSpells?: FeatGrantedClassSpells[];
  /** Блоб даров: у записей мира, сохранённых раньше, списки лежат в нём */
  featData?: { grantedClassSpells?: FeatGrantedClassSpells[] };
}

/**
 * Что уровень класса открывает в списках классов одного умения: мастер
 * спрашивает, класть ли их на лист целиком или выбрать из них самому.
 */
export interface ClassSpellListOffer {
  /** Ключ умения */
  featureKey: string;
  /** Название умения — источник выдачи на листе */
  featureName: string;
  /** Запросы, по которым компендиум даст заклинания предложения */
  requests: ClassSpellListRequest[];
}

/**
 * Списки классов, которые умения открывают на получаемом уровне класса.
 *
 * Группа открывается на своём уровне КЛАССА (пусто — вместе с умением). Группа
 * «не выше доступного круга» открывается ещё и всякий раз, когда уровень даёт
 * новый круг ячеек, — её список растёт вместе с персонажем. Уже известные
 * заклинания отсеивает тот, кто показывает предложение: по названию, как и вся
 * выдача.
 *
 * Вырос предел подготовки класса — снова открываются и все группы, открытые
 * раньше: игроку есть куда добрать заклинание, а новой группы уровень мог и не
 * дать (бард на 2 уровне готовит пять вместо четырёх, а второй круг приходит
 * только на 3-м). Группа с отметкой «не готовить» в предел не входит и его
 * ростом не открывается.
 *
 * @param features - умения класса и активного подкласса
 * @param classLevel - получаемый уровень класса
 * @param slotLevels - наибольший круг ячеек до уровня и после него
 * @param slotLevels.before - до получения уровня
 * @param slotLevels.after - после получения уровня
 * @param preparedLimit - предел подготовки класса по его таблице до уровня и
 *   после него; null — таблица числа не даёт. Не задан — рост предела не
 *   учитывается
 * @param preparedLimit.before - до получения уровня
 * @param preparedLimit.after - после получения уровня
 * @returns предложения по умениям; умения без открывшихся групп пропущены
 */
export function collectClassSpellListOffers(
  features: ReadonlyArray<FeatureWithClassSpellLists>,
  classLevel: number,
  slotLevels: { before: number; after: number },
  preparedLimit?: { before: number | null; after: number | null },
): ClassSpellListOffer[] {
  const offers: ClassSpellListOffer[] = [];

  const preparedLimitGrew =
    (preparedLimit?.after ?? 0) > (preparedLimit?.before ?? 0);

  for (const feature of features) {
    const gainedAtLevel = feature.level ?? 1;

    if (gainedAtLevel > classLevel) {
      continue;
    }

    const groups =
      feature.grantedClassSpells ?? feature.featData?.grantedClassSpells ?? [];

    const requests: ClassSpellListRequest[] = [];

    for (const group of groups) {
      const opensAt = group.requiredLevel ?? gainedAtLevel;
      const classKeys = group.classKeys.filter(Boolean);

      if (opensAt > classLevel || classKeys.length === 0) {
        continue;
      }

      const newSlotCircle =
        group.fromSlots && slotLevels.after > slotLevels.before;

      const roomToPrepare = preparedLimitGrew && !group.alwaysPrepared;

      if (opensAt !== classLevel && !newSlotCircle && !roomToPrepare) {
        continue;
      }

      requests.push({
        classKeys,
        featureName: feature.name,
        spellPackIds: group.spellPackIds,
        level: group.level,
        maxLevel: group.fromSlots ? slotLevels.after : group.maxLevel,
        alwaysPrepared: group.alwaysPrepared,
        castingAbility: group.spellcastingAbility,
        grantKind: 'class',
        featureKey: feature.key,
      });
    }

    if (requests.length > 0) {
      offers.push({
        featureKey: feature.key,
        featureName: feature.name,
        requests,
      });
    }
  }

  return offers;
}

/**
 * Разворачивает запросы «весь список класса» в связи «заклинание → умение-источник».
 *
 * Разворот здесь, а не у сборщика запросов: каталог загружается лениво и только тем,
 * кто действительно выдаёт заклинания, — а сборщик работает и без компендиума, в
 * мастерах и на дропе.
 *
 * Круг проверяется тем же кодом, что и у выбора заклинаний
 * (`matchesFeatSpellFilter`), — здесь он повторён своим сравнением ради того, чтобы
 * движок выдачи не зависел от модуля выборов; правило одно: «ровно круг» либо «не
 * выше круга».
 *
 * @param requests - запросы, собранные {@link collectFeatGrantedClassSpellRequests}
 * @param packs - заклинания компендиума по пакам (плюс заклинания самого мира)
 * @returns связи без дубликатов по id заклинания
 */
export function expandClassSpellRequests(
  requests: ReadonlyArray<ClassSpellListRequest>,
  packs: ReadonlyArray<ClassSpellPack>,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  for (const request of requests) {
    if (request.classKeys.length === 0) {
      continue;
    }

    const allowedPacks = request.spellPackIds?.length
      ? packs.filter((pack) => request.spellPackIds?.includes(pack.packId))
      : packs;

    // Пак записи-источника идёт первым: первая встреченная копия и остаётся
    const orderedPacks = request.preferredPackId
      ? [
          ...allowedPacks.filter(
            (pack) => pack.packId === request.preferredPackId,
          ),
          ...allowedPacks.filter(
            (pack) => pack.packId !== request.preferredPackId,
          ),
        ]
      : allowedPacks;

    for (const pack of orderedPacks) {
      for (const spell of pack.spells) {
        if (
          seenSpellIds.has(spell.id)
          || !matchesClassSpellRequest(spell, request)
        ) {
          continue;
        }

        seenSpellIds.add(spell.id);

        sources.push({
          spellId: spell.id,
          featureName: request.featureName,
          packId: pack.packId,
          alwaysPrepared: request.alwaysPrepared,
          castingAbility: request.castingAbility,
          grantKind: request.grantKind,
          featureKey: request.featureKey,
        });
      }
    }
  }

  return sources;
}

/**
 * Подходит ли заклинание под запрос: и по классу, и по кругу.
 *
 * @param spell - заклинание компендиума
 * @param request - запрос списка класса
 */
function matchesClassSpellRequest(
  spell: Spell,
  request: ClassSpellListRequest,
): boolean {
  const spellClasses = spell.classKeys ?? [];

  if (!spellClasses.some((key) => request.classKeys.includes(key))) {
    return false;
  }

  if (request.level !== undefined && spell.level !== request.level) {
    return false;
  }

  return request.maxLevel === undefined || spell.level <= request.maxLevel;
}

/**
 * Нормализует название заклинания для сравнения на дубликаты.
 *
 * @param name - название заклинания
 * @returns название без крайних пробелов в нижнем регистре
 */
export function normalizeSpellName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Отдаёт записи листа отметку «Подготавливать не нужно» от чужой выдачи.
 *
 * Источник записи не меняется: она остаётся заклинанием игрока или прежнего
 * умения и переживёт откат выдачи — {@link removeGrantedSpellsByFeatureNames}
 * лишь вернёт ей прежнюю подготовку. Запись, у которой отметка своя, и запись
 * самого дающего умения не трогаются: первой давать нечего, а второй отметку
 * ставит её собственная выдача и сверка.
 *
 * @param spell - запись листа с тем же названием, что у выдаваемого заклинания
 * @param featureName - название умения, выдающего заклинание без подготовки
 * @returns запись с отметкой; без изменений — тот же объект
 */
function borrowPreparation(spell: Spell, featureName: string): Spell {
  if (spell.grantedByFeature === featureName) {
    return spell;
  }

  const borrowed = spell.borrowedPreparation;

  if (!borrowed) {
    return spell.alwaysPrepared
      ? spell
      : {
          ...spell,
          prepared: true,
          alwaysPrepared: true,
          borrowedPreparation: {
            sources: [featureName],
            wasPrepared: spell.prepared === true,
          },
        };
  }

  if (borrowed.sources.includes(featureName)) {
    return spell;
  }

  return {
    ...spell,
    prepared: true,
    alwaysPrepared: true,
    borrowedPreparation: {
      ...borrowed,
      sources: [...borrowed.sources, featureName],
    },
  };
}

/**
 * Дало ли умение записи отметку «Подготавливать не нужно» взаймы. Нужен тому,
 * кто снимает и тут же возвращает выдачу без компендиума (правка черты на
 * листе): такую запись надо назвать в повторной выдаче, иначе отметка уйдёт.
 *
 * @param spell - заклинание листа
 * @param featureName - название умения-источника
 * @returns true — отметка записи держится в том числе на этом умении
 */
export function isPreparationBorrowedFrom(
  spell: Pick<Spell, 'borrowedPreparation'>,
  featureName: string,
): boolean {
  return spell.borrowedPreparation?.sources.includes(featureName) ?? false;
}

/**
 * Собирает повторную выдачу заклинаний умения прямо с листа — для правки черты
 * на листе, где компендиума под рукой нет: умение снимается и тут же выдаётся
 * заново, и всё, что здесь не названо, с листа уйдёт.
 *
 * Запись самого умения переносится такой, какой лежала. Запись другого
 * источника, которой умение дало отметку «не готовить», называется с этой
 * отметкой — снятие её вернёт, а выдача даст заново.
 *
 * @param spells - заклинания листа до снятия умения
 * @param oldFeatureName - название умения, под которым заклинания выданы
 * @param newFeatureName - название умения после правки
 * @returns выдача для {@link appendGrantedSpells}
 */
export function collectCarriedFeatureSpells(
  spells: ReadonlyArray<Spell>,
  oldFeatureName: string,
  newFeatureName: string,
): ResolvedGrantedSpell[] {
  return spells.flatMap((spell): ResolvedGrantedSpell[] => {
    if (spell.grantedByFeature === oldFeatureName) {
      // Поля выдачи называем заново: выдача ставит их по своему входу, а не по
      // записи, и без них заклинание «не готовить» легло бы обычным и заняло
      // место в пределе подготовки. Характеристика едет в самой записи
      return [
        {
          spell,
          featureName: newFeatureName,
          alwaysPrepared: spell.alwaysPrepared === true,
          grantKind: spell.grantKind,
        },
      ];
    }

    return isPreparationBorrowedFrom(spell, oldFeatureName)
      ? [{ spell, featureName: newFeatureName, alwaysPrepared: true }]
      : [];
  });
}

/**
 * Добавляет granted-заклинания в список заклинаний актора.
 *
 * Дубликаты отсеиваются по нормализованному названию (при добавлении в лист
 * персонажа заклинанию выдаётся новый id, поэтому id компендиума с ним
 * никогда не совпадает). Каждое добавленное заклинание получает
 * `grantedByFeature` с названием умения-источника. Запись, которая на листе уже
 * есть, второй раз не кладётся; если выдача освобождает от подготовки, отметку
 * получает она — правило одно на умения класса, вид, предысторию и черту.
 *
 * Подготовка берётся у источника: врождённые заклинания вида готовить не нужно,
 * а черта решает сама — по умолчанию заклинание ложится в книгу наравне с
 * остальными и подготовку занимает. Заклинательная характеристика источника, если
 * она задана, проставляется заклинанию и потому меняет его атаку и сложность
 * спасброска.
 *
 * Заклинание, которое игрок выбрал сам, ложится подготовленным, пока в пределе
 * подготовки есть место, — если вызывающий передал предел и заклинание идёт в
 * счёт подготовки класса. Что не поместилось, остаётся неподготовленным: его
 * отметит игрок. Весь список класса, выданный целиком, выбором не считается —
 * там подготовка и есть выбор игрока.
 *
 * @param existingSpells - текущий список заклинаний актора
 * @param grantedSpells - granted-заклинания с умениями-источниками
 * @param defaultGrantKind - чем выдано, если источник этого не назвал сам
 * @param chosenPreparation - предел подготовки для выбранного игроком; не
 *   задан — выбранное ложится как остальная выдача
 * @returns новый список заклинаний (исходный не мутируется)
 */
export function appendGrantedSpells(
  existingSpells: Spell[],
  grantedSpells: ResolvedGrantedSpell[],
  defaultGrantKind?: SpellGrantKind,
  chosenPreparation?: ChosenSpellPreparation,
): Spell[] {
  const result = [...existingSpells];

  // Место считается от уже подготовленного на листе: прежние отметки остаются
  let preparedCount = existingSpells.filter(countsTowardPreparedSpells).length;

  const indexByName = new Map<string, number>();

  result.forEach((spell, index) => {
    const name = normalizeSpellName(spell.name);

    if (!indexByName.has(name)) {
      indexByName.set(name, index);
    }
  });

  for (const granted of grantedSpells) {
    const normalizedName = normalizeSpellName(granted.spell.name);
    const existingIndex = indexByName.get(normalizedName);

    // Заклинание, которое игрок положил в книгу сам, остаётся его: сделай его
    // выданным — и откат источника унёс бы запись игрока с листа. Но отметку
    // «не готовить» выдача ему отдаёт: иначе заклинание домена, выбранное раньше
    // самим игроком, так и занимало бы место в пределе подготовки
    if (existingIndex !== undefined) {
      if (granted.alwaysPrepared === true) {
        const existing = result[existingIndex];
        const marked = borrowPreparation(existing, granted.featureName);

        // Место освободилось — займёт его игрок сам либо выбранное ниже
        if (
          countsTowardPreparedSpells(existing)
          && !countsTowardPreparedSpells(marked)
        ) {
          preparedCount -= 1;
        }

        result[existingIndex] = marked;
      }

      continue;
    }

    indexByName.set(normalizedName, result.length);

    // API и редактор опускают выключенный флаг. Только явное исключение
    // источника освобождает выданное заклинание от подготовки.
    const alwaysPrepared = granted.alwaysPrepared ?? false;
    const grantKind = granted.grantKind ?? defaultGrantKind;

    const spell: Spell = {
      ...granted.spell,
      id: generateId('spell'),
      prepared: alwaysPrepared,
      alwaysPrepared,
      ...(granted.castingAbility
        ? { attackAbility: granted.castingAbility }
        : {}),
      grantedByFeature: granted.featureName,
      ...(grantKind ? { grantKind } : {}),
    };

    const preparedByChoice: Spell = { ...spell, prepared: true };

    // В счёт подготовки идёт только заклинание класса 1+ круга без отметки
    // «не готовить» — то же правило, что у счётчика листа
    const hasPlace =
      chosenPreparation !== undefined
      && granted.chosenByPlayer === true
      && countsTowardPreparedSpells(preparedByChoice)
      && (chosenPreparation.limit === null
        || preparedCount < chosenPreparation.limit);

    if (hasPlace) {
      preparedCount += 1;
    }

    result.push(hasPlace ? preparedByChoice : spell);
  }

  return result;
}

/**
 * Досылает заклинаниям, выданным умениями класса, то, чего при выдаче не было:
 * источник «умение класса» и отметку «Подготавливать не нужно». Выгрузка
 * компендиума долго теряла отметку у умений класса, и заклинания домена легли
 * на листы как обычные — их приходилось готовить.
 *
 * Отметка только ставится, но не снимается: заклинание, которое игрок держит
 * подготовленным по старой выдаче, не должно внезапно потребовать подготовки.
 *
 * Сверка идёт по названиям: другой связи у заклинания листа нет — id
 * компендиума при выдаче не сохраняется, а источник записан названием умения
 * (тем же ключом работают и повтор выдачи, и её откат). Неоднозначное название
 * не угадывается: умение, чьё название повторяется, пропускается, а ссылка с
 * повторяющимся названием уступает отметке всей выдачи умения.
 *
 * Листу, собранному до правила «выдача без подготовки отдаёт отметку уже лежащей
 * записи», отметка досылается здесь же: умение, чей уровень класса назван
 * (`classLevel`), отдаёт её одноимённой записи другого источника — если само
 * заклинание на этом уровне уже открыто. Без уровня ничего не досылается: по
 * одному названию не понять, дорос ли персонаж до заклинания.
 *
 * @param spells - заклинания листа
 * @param features - умения классов и подклассов персонажа
 * @returns новый список заклинаний; без изменений — тот же массив
 */
export function syncClassGrantedSpells(
  spells: Spell[],
  features: ReadonlyArray<SheetClassFeature>,
): Spell[] {
  const featureByName = new Map<string, SheetClassFeature>();
  const ambiguousNames = new Set<string>();

  for (const feature of features) {
    if (featureByName.has(feature.name)) {
      ambiguousNames.add(feature.name);
    } else {
      featureByName.set(feature.name, feature);
    }
  }

  for (const name of ambiguousNames) {
    featureByName.delete(name);
  }

  let changed = false;

  const synced = spells.map((spell): Spell => {
    const feature = spell.grantedByFeature
      ? featureByName.get(spell.grantedByFeature)
      : undefined;

    if (!feature || (spell.grantKind && spell.grantKind !== 'class')) {
      return spell;
    }

    const spellName = normalizeSpellName(spell.name);

    const references = (feature.featData?.grantedSpells ?? []).filter(
      (entry) => normalizeSpellName(entry.name) === spellName,
    );

    const reference = references.length === 1 ? references[0] : undefined;

    const alwaysPrepared =
      reference?.alwaysPrepared
      ?? feature.featData?.grantedSpellsAlwaysPrepared;

    const needsKind = spell.grantKind === undefined;
    const needsPrepared = alwaysPrepared === true && !spell.alwaysPrepared;

    if (!needsKind && !needsPrepared) {
      return spell;
    }

    changed = true;

    return {
      ...spell,
      grantKind: 'class',
      ...(needsPrepared ? { alwaysPrepared: true, prepared: true } : {}),
    };
  });

  for (const feature of featureByName.values()) {
    for (const spellName of collectOpenedPreparedNames(feature)) {
      const sameName = synced.filter(
        (spell) => normalizeSpellName(spell.name) === spellName,
      );

      // Своя запись умения на листе есть — отметку несёт она
      if (
        sameName.length === 0
        || sameName.some((spell) => spell.grantedByFeature === feature.name)
      ) {
        continue;
      }

      const marked = borrowPreparation(sameName[0], feature.name);

      if (marked !== sameName[0]) {
        synced[synced.indexOf(sameName[0])] = marked;
        changed = true;
      }
    }
  }

  return changed ? synced : spells;
}

/**
 * Названия заклинаний, которые умение класса уже выдало персонажу без
 * подготовки: уровень умения и уровень самого заклинания не выше уровня
 * персонажа в классе. Заклинание, чей уровень выдачи не найден, пропускается.
 *
 * @param feature - умение класса с уровнем персонажа в этом классе
 * @returns нормализованные названия; уровень класса не назван — пусто
 */
function collectOpenedPreparedNames(feature: SheetClassFeature): string[] {
  const classLevel = feature.classLevel;
  const gainedAtLevel = feature.level ?? 1;

  if (classLevel === undefined || gainedAtLevel > classLevel) {
    return [];
  }

  const openedIds = new Set(feature.grantedSpells ?? []);

  for (const [level, spellIds] of Object.entries(
    feature.grantedSpellsByLevel ?? {},
  )) {
    if (Number(level) <= classLevel) {
      spellIds.forEach((spellId) => openedIds.add(spellId));
    }
  }

  return (feature.featData?.grantedSpells ?? [])
    .filter(
      (reference) =>
        reference.spellId !== undefined
        && openedIds.has(reference.spellId)
        && (reference.alwaysPrepared
          ?? feature.featData?.grantedSpellsAlwaysPrepared) === true,
    )
    .map((reference) => normalizeSpellName(reference.name));
}

/**
 * Удаляет granted-заклинания, выданные указанными умениями.
 *
 * Используется при откате источника (смена вида, замена черты предыстории):
 * заклинания, у которых `grantedByFeature` совпадает с одним из названий
 * умений, исключаются из списка. Запись, которой снимаемое умение лишь дало
 * отметку «Подготавливать не нужно», остаётся на листе: отметка уходит вместе с
 * последним давшим её умением, и запись возвращается к прежней подготовке.
 *
 * @param spells - текущий список заклинаний актора
 * @param featureNames - названия умений, чьи заклинания нужно убрать
 * @returns новый список заклинаний (исходный не мутируется)
 */
export function removeGrantedSpellsByFeatureNames(
  spells: Spell[],
  featureNames: ReadonlyArray<string>,
): Spell[] {
  const namesToRemove = new Set(featureNames);

  return spells
    .filter(
      (spell) =>
        !spell.grantedByFeature || !namesToRemove.has(spell.grantedByFeature),
    )
    .map((spell) => returnBorrowedPreparation(spell, namesToRemove));
}

/**
 * Снимает с записи отметку «Подготавливать не нужно», данную снимаемыми
 * умениями. Пока отметку держит ещё хоть одно умение, она остаётся.
 *
 * @param spell - заклинание листа
 * @param removedNames - названия снимаемых умений
 * @returns запись без снятой отметки; без изменений — тот же объект
 */
function returnBorrowedPreparation(
  spell: Spell,
  removedNames: ReadonlySet<string>,
): Spell {
  const borrowed = spell.borrowedPreparation;

  if (!borrowed) {
    return spell;
  }

  const sources = borrowed.sources.filter((name) => !removedNames.has(name));

  if (sources.length === borrowed.sources.length) {
    return spell;
  }

  if (sources.length > 0) {
    return { ...spell, borrowedPreparation: { ...borrowed, sources } };
  }

  const { borrowedPreparation: returned, ...ordinary } = spell;

  return {
    ...ordinary,
    prepared: returned?.wasPrepared ?? false,
    alwaysPrepared: false,
  };
}
