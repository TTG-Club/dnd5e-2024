/**
 * Применение черты к актору и откат при удалении.
 *
 * Когда черту перетаскивают на лист персонажа, она должна не просто появиться в
 * списке, а реально «заработать»: выдать заклинания, перенести активные эффекты,
 * добавить владения/языки, повесить защиты и повышение характеристик. Эти
 * функции собирают соответствующие обновления актора (по образцу
 * `useSpeciesWizard.buildUpdates`) и умеют их откатывать по провенансу.
 */

import type { Feature, TypedWebSocketClient } from '@vtt/shared';
import type {
  ActiveEffect,
  ActorCounterState,
  ActorProficiencies,
  AppliedFeatMeta,
  ClassSpellListRequest,
  DnDActor,
  FeatData,
  GrantedSpellSource,
  ResolvedGrantedSpell,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { generateEntityId } from '@/core/entityUtils';
import { useItemsStore } from '@/stores/itemsStore';
import {
  extractWorldSpells,
  loadSpellPacks,
} from '@/systems/dnd5e/composables/spellCompendium';
import {
  appendGrantedSpells,
  applyFeatChoiceSelections,
  applyFeatDataProficiencies,
  buildFeatCounters,
  buildFeatGrantEffect,
  cloneActorProficiencies,
  collectActorFeatChoiceAnswers,
  collectFeatGrantedClassSpellRequests,
  collectFeatGrantedSpellSources,
  expandClassSpellRequests,
  getTotalLevel,
  isFeatOwnedEffect,
  prepareTransferredFeatEffects,
  raiseTokenDarkvision,
  removeFeatChoiceSelections,
  removeFeatDataProficiencies,
  removeGrantedSpellsByFeatureNames,
  resolveChosenAbilities,
  resolveChosenDamageDefenses,
  WORLD_PACK_ID,
} from '@vtt/shared/system/dnd.js';

/**
 * Особенность-черта, несущая дары для применения/отката. Базовый `Feature`
 * (`@vtt/shared`) намеренно не знает о `system/dnd` (иначе циклическая
 * зависимость), поэтому несомые чертой `featData`/`activeEffects` добавляются
 * здесь, на стороне клиента. Эти поля переживают сериализацию актора
 * (`normalizeActor` не трогает `features`).
 */
export interface AppliedFeatFeature extends Feature, AppliedFeatMeta {
  featData?: FeatData;
  activeEffects?: ActiveEffect[];
}

/**
 * Черта компендиума с полями, которых базовый тип умения не знает: категория
 * нужна пикеру, чтобы сузить пул выбора черты.
 */
export interface CompendiumFeat extends AppliedFeatFeature {
  /** Категория черты подписью записи компендиума («Боевой стиль») */
  category?: string;
}

/** Обновления актора, получаемые при применении/откате черты. */
export interface FeatApplyResult {
  features: Feature[];
  spells: Spell[];
  activeEffects: ActiveEffect[];
  proficiencies: ActorProficiencies;
  /**
   * Счётчики ресурсов актора с учётом ресурсов черты. Задаётся всегда: список
   * общий с классовыми счётчиками, и вернуть только «свои» нельзя — вызывающий
   * записывает его целиком.
   */
  classCounters: ActorCounterState[];
  /**
   * Обновлённые настройки токена (поднятое тёмное зрение). Задаётся только если
   * черта повысила тёмное зрение — иначе `undefined` (токен не трогаем, чтобы не
   * затереть его при отсутствии изменений).
   */
  token?: DnDActor['token'];
}

/**
 * Загружает заклинания компендиума и сопоставляет связанные `grantedSpells`
 * черты с их полными данными. Без сокета или связей — пустой список.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param feat - перетаскиваемая черта (имя + блоб даров + ответы игрока)
 * @param feat.name - имя черты (источник при выдаче заклинаний)
 * @param feat.featData - блоб даров черты с выдаваемыми заклинаниями
 * @param feat.choices - ответы игрока: из них берутся выбранные заклинания
 * @param actor - лист персонажа: его уровень решает, что уже открыто. Без него
 *   уровни доступа не проверяются, а расширенный список не раскрывается вовсе
 */
export function resolveFeatGrantedSpells(
  socket: TypedWebSocketClient | null | undefined,
  feat: {
    name: string;
    featData?: FeatData | null;
    choices?: Record<string, string[]>;
  },
  actor?: DnDActor | null,
): Promise<ResolvedGrantedSpell[]> {
  return resolveGrantedSpellSources(
    socket,
    collectFeatGrantedSpellSources(feat, actor),
    collectFeatGrantedClassSpellRequests(feat, actor),
  );
}

/**
 * Пере-собирает заклинания ВСЕХ черт листа на текущем уровне персонажа.
 *
 * Нужен при повышении уровня: у метки дракона заклинания приходят ступенями
 * («Малое восстановление» — с третьего уровня), и без пересборки они остались бы
 * недоступными навсегда. Уже выданные заклинания повторно не добавляются —
 * `appendGrantedSpells` отсеивает их по названию.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param actor - лист персонажа с уже обновлённым уровнем
 * @returns заклинания черт, доступные на текущем уровне
 */
export function resolveActorFeatSpells(
  socket: TypedWebSocketClient | null | undefined,
  actor: DnDActor,
): Promise<ResolvedGrantedSpell[]> {
  const features: AppliedFeatFeature[] = actor.features ?? [];

  const withFeatData = features.filter((feature) => feature.featData);

  const sources = withFeatData.flatMap((feature) =>
    collectFeatGrantedSpellSources(feature, actor),
  );

  const classRequests = withFeatData.flatMap((feature) =>
    collectFeatGrantedClassSpellRequests(feature, actor),
  );

  return resolveGrantedSpellSources(socket, sources, classRequests);
}

/**
 * Сопоставляет связи «заклинание → черта-источник» с записями компендиума и
 * мира. Несопоставленное пропускается: связь могла указывать на пак, которого у
 * этого мастера нет, и ронять из-за неё выдачу целиком неправильно.
 *
 * Компендиум грузится ПО ПАКАМ: у выдачи «весь список класса» автор может назвать
 * конкретный пак, а плоский каталог о паках уже не помнит.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param sources - связи «заклинание → черта-источник»
 * @param classRequests - запросы «выдать весь список класса»
 */
async function resolveGrantedSpellSources(
  socket: TypedWebSocketClient | null | undefined,
  sources: GrantedSpellSource[],
  classRequests: ClassSpellListRequest[] = [],
): Promise<ResolvedGrantedSpell[]> {
  if ((sources.length === 0 && classRequests.length === 0) || !socket) {
    return [];
  }

  const { packs } = await loadSpellPacks(socket);

  // Свои заклинания мира ищутся наравне с компендиумными: черта может выдавать
  // заклинание, заведённое в панели «Предметы». Своим паком — чтобы список класса,
  // ограниченный компендиумом, их не подхватил
  const worldPack = {
    packId: WORLD_PACK_ID,
    spells: extractWorldSpells(useItemsStore().itemsByType('spell')),
  };

  const allPacks = [...packs, worldPack];
  const spells = allPacks.flatMap((pack) => pack.spells);

  const resolved: ResolvedGrantedSpell[] = [];

  for (const source of [
    ...sources,
    ...expandClassSpellRequests(classRequests, allPacks),
  ]) {
    const spell = spells.find((entry) => entry.id === source.spellId);

    if (spell) {
      resolved.push({
        spell,
        featureName: source.featureName,
        alwaysPrepared: source.alwaysPrepared,
        castingAbility: source.castingAbility,
      });
    }
  }

  return resolved;
}

/**
 * Собирает обновления актора для ПРИМЕНЕНИЯ черты: добавляет особенность-черту
 * (несущую `featData`/`activeEffects` для отката), выдаёт заклинания, переносит
 * эффекты + синтетический эффект даров, дописывает владения.
 *
 * @param actor - текущий актор
 * @param droppedFeat - перетащенная черта (с `featData`/`activeEffects`)
 * @param resolvedSpells - сопоставленные с компендиумом выдаваемые заклинания
 */
export function applyFeatToActor(
  actor: DnDActor,
  droppedFeat: AppliedFeatFeature,
  resolvedSpells: ResolvedGrantedSpell[],
): FeatApplyResult {
  const featureId = generateEntityId('feature');
  const featData = droppedFeat.featData ?? null;

  // Конструируем особенность явно (без полей GameItem-обёртки), сохраняя дары
  // для последующего редактирования/отката на акторе.
  // Уровень взятия фиксируется навсегда: прибавка к хитам у «Крепкого» и
  // подобных зависит от него, и на следующем повышении она не должна поехать
  const acquisitionLevel =
    droppedFeat.acquisitionLevel ?? getTotalLevel(actor.system.classes);

  const newFeature: AppliedFeatFeature = {
    id: featureId,
    acquisitionLevel,
    ...(droppedFeat.choices ? { choices: droppedFeat.choices } : {}),
    name: droppedFeat.name,
    nameEn: droppedFeat.nameEn,
    description: droppedFeat.description,
    featureType: 'feat',
    sourceKey: droppedFeat.sourceKey,
    isSRD: droppedFeat.isSRD,
    repeatable: droppedFeat.repeatable,
    repeatableText: droppedFeat.repeatableText,
    ...(featData ? { featData } : {}),
    ...(droppedFeat.activeEffects
      ? { activeEffects: droppedFeat.activeEffects }
      : {}),
  };

  const features = [...actor.features, newFeature];

  const proficiencies = cloneActorProficiencies(actor.system.proficiencies);

  applyFeatDataProficiencies(proficiencies, featData);

  // Выборы игрока — после безусловных даров: «Знаток» поднимает до компетентности то,
  // чем персонаж уже владеет, и порядок здесь имеет значение
  applyFeatChoiceSelections(
    proficiencies,
    featData,
    droppedFeat.choices,
    actor,
  );

  const spells = appendGrantedSpells(actor.spells ?? [], resolvedSpells);

  const transferred = prepareTransferredFeatEffects(
    featureId,
    droppedFeat.activeEffects,
  );

  // Ответы других черт — на случай привязки к чужому выбору: «Мощная метка
  // дракона» поднимает характеристику, названную заклинательной у самой метки.
  // Свои ответы поверх: одноимённый ключ всегда про эту черту
  const answers = {
    ...collectActorFeatChoiceAnswers(actor),
    ...(droppedFeat.choices ?? {}),
  };

  const grantEffect = buildFeatGrantEffect(
    featureId,
    newFeature.name,
    featData,
    {},
    {
      acquisitionLevel,
      walkSpeed: actor.system.movement?.walk,
      // Защита от урона и повышение характеристик по выбору: сам тип урона и
      // сама характеристика известны только после того, как игрок выбрал
      chosenDamageDefenses: resolveChosenDamageDefenses(featData, answers),
      chosenAbilities: resolveChosenAbilities(featData, answers),
    },
  );

  const activeEffects = [
    ...(actor.activeEffects ?? []),
    ...transferred,
    ...(grantEffect ? [grantEffect] : []),
  ];

  // Тёмное зрение: поднимаем дальность зрения токена до максимума (как у вида).
  // Не понижаем — у тёмного зрения может быть другой источник (вид/класс).
  const token = raiseTokenDarkvision(actor.token, featData?.darkvision ?? 0);

  const classCounters = [
    ...(actor.system.classCounters ?? []),
    ...buildFeatCounters(
      { id: featureId, featData, choices: droppedFeat.choices },
      actor,
      actor.system.classCounters ?? [],
    ),
  ];

  return {
    features,
    spells,
    activeEffects,
    proficiencies,
    classCounters,
    token,
  };
}

/**
 * Собирает обновления актора для ОТКАТА черты: удаляет особенность, снимает её
 * заклинания (по `grantedByFeature`), эффекты (по провенансу `feat:<id>`) и
 * выданные владения. Тёмное зрение НЕ понижается (нет провенанса источника —
 * могло прийти от вида/класса; недеструктивно, как и у вида).
 *
 * Инвариант: ключ отката заклинаний — текущее имя черты (`grantedByFeature`).
 * Имя фиксируется при выдаче и при пере-применении (`reapplyFeatToActor`
 * переносит заклинания на новое имя), поэтому откат всегда сходится по имени
 * применённой особенности.
 *
 * @param actor - текущий актор
 * @param feature - удаляемая особенность-черта (с `featData` для точного отката)
 */
export function removeFeatFromActor(
  actor: DnDActor,
  feature: AppliedFeatFeature,
): FeatApplyResult {
  const features = actor.features.filter((entry) => entry.id !== feature.id);

  const spells = removeGrantedSpellsByFeatureNames(actor.spells ?? [], [
    feature.name,
  ]);

  const activeEffects = (actor.activeEffects ?? []).filter(
    (effect) => !isFeatOwnedEffect(effect, feature.id),
  );

  const proficiencies = cloneActorProficiencies(actor.system.proficiencies);

  removeFeatDataProficiencies(proficiencies, feature.featData ?? null);

  removeFeatChoiceSelections(
    proficiencies,
    feature.featData ?? null,
    feature.choices,
  );

  const classCounters = (actor.system.classCounters ?? []).filter(
    (counter) => counter.featureId !== feature.id,
  );

  return { features, spells, activeEffects, proficiencies, classCounters };
}

/**
 * Пере-применяет отредактированную черту: снимает дары старой версии и
 * применяет новую (по образцу смены вида). Заклинания берёт из
 * `resolvedSpells`, который формирует вызывающий — на дропе резолвится
 * компендиум (`resolveFeatGrantedSpells`), на листе без сокета переносятся уже
 * выданные заклинания черты (новые связанные заклинания через лист не
 * подтянутся — для них правьте черту в «Предметах» и перетащите заново).
 *
 * @param actor - текущий актор
 * @param oldFeature - применённая ранее версия черты (для снятия её даров)
 * @param updatedFeat - обновлённая черта (её дары применяются)
 * @param resolvedSpells - выдаваемые заклинания для повторной выдачи
 */
export function reapplyFeatToActor(
  actor: DnDActor,
  oldFeature: AppliedFeatFeature,
  updatedFeat: AppliedFeatFeature,
  resolvedSpells: ResolvedGrantedSpell[],
): FeatApplyResult {
  const removed = removeFeatFromActor(actor, oldFeature);

  const intermediate: DnDActor = {
    ...actor,
    features: removed.features,
    spells: removed.spells,
    activeEffects: removed.activeEffects,
    system: {
      ...actor.system,
      proficiencies: removed.proficiencies,
      // Счётчики снятой версии уже вычтены: иначе новая версия увидела бы
      // старый ресурс и второй раз его не завела бы
      classCounters: removed.classCounters,
    },
  };

  // Уровень взятия переносим со старой версии: правка черты — не повторное её
  // получение, и прибавка к хитам от этого меняться не должна
  return applyFeatToActor(
    intermediate,
    {
      ...updatedFeat,
      acquisitionLevel:
        updatedFeat.acquisitionLevel ?? oldFeature.acquisitionLevel,
      // Сделанные выборы переносим: правка черты — не повторное её получение, и
      // переспрашивать игрока незачем
      choices: updatedFeat.choices ?? oldFeature.choices,
    },
    resolvedSpells,
  );
}
