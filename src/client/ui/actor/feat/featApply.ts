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
  AppliedFeatMeta,
  DnDActor,
  FeatData,
  ResolvedGrantedSpell,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { loadCompendiumKind } from '@/core/compendiumDataClient';
import { generateEntityId } from '@/core/entityUtils';
import { useItemsStore } from '@/stores/itemsStore';
import {
  extractSpellEntries,
  extractWorldSpells,
} from '@/systems/dnd5e/composables/spellCompendium';
import { pushUnique, removeItems } from '@vtt/shared';
import {
  appendGrantedSpells,
  applyFeatChoiceSelections,
  buildFeatCounters,
  buildFeatGrantEffect,
  collectActorFeatChoiceAnswers,
  collectFeatGrantedSpellSources,
  getTotalLevel,
  isFeatOwnedEffect,
  prepareTransferredFeatEffects,
  removeFeatChoiceSelections,
  removeGrantedSpellsByFeatureNames,
  resolveChosenAbilities,
  resolveChosenDamageDefenses,
} from '@vtt/shared/system/dnd.js';

/** Владения актора (структурно — то, что черта правит). */
type ActorProficiencies = DnDActor['system']['proficiencies'];

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
 * Глубокая копия владений (чтобы не мутировать исходный объект актора).
 *
 * Клонируем через JSON, а НЕ `structuredClone`: актор приходит из `ref` листа
 * (`localActor`), поэтому `actor.system.proficiencies` — реактивный Proxy Vue, на
 * котором `structuredClone` бросает `DataCloneError` («could not be cloned»).
 * Владения — чистый JSON (массивы строк + запись строка→строка), так что клон
 * без потерь. Тот же приём используется в `applyFeatDarkvision` ниже.
 */
function cloneProficiencies(
  proficiencies: ActorProficiencies,
): ActorProficiencies {
  return JSON.parse(JSON.stringify(proficiencies));
}

/** Применяет владения черты к копии владений актора (in-place). */
function applyFeatProficiencies(
  proficiencies: ActorProficiencies,
  featData: FeatData | null | undefined,
): void {
  for (const skill of featData?.skillProficiencies ?? []) {
    proficiencies.skills[skill] = 'proficient';
  }

  pushUnique(proficiencies.weapons, featData?.weaponProficiencies ?? []);
  pushUnique(proficiencies.weaponMasteries, featData?.weaponMasteries ?? []);
  pushUnique(proficiencies.armor, featData?.armorProficiencies ?? []);
  pushUnique(proficiencies.tools, featData?.toolProficiencies ?? []);
  pushUnique(proficiencies.languages, featData?.languages ?? []);

  pushUnique(
    proficiencies.savingThrows,
    featData?.savingThrowProficiencies ?? [],
  );
}

/** Откатывает владения черты из копии владений актора (in-place). */
function removeFeatProficiencies(
  proficiencies: ActorProficiencies,
  featData: FeatData | null | undefined,
): void {
  for (const skill of featData?.skillProficiencies ?? []) {
    Reflect.deleteProperty(proficiencies.skills, skill);
  }

  removeItems(proficiencies.weapons, featData?.weaponProficiencies ?? []);
  removeItems(proficiencies.weaponMasteries, featData?.weaponMasteries ?? []);
  removeItems(proficiencies.armor, featData?.armorProficiencies ?? []);
  removeItems(proficiencies.tools, featData?.toolProficiencies ?? []);
  removeItems(proficiencies.languages, featData?.languages ?? []);

  removeItems(
    proficiencies.savingThrows,
    featData?.savingThrowProficiencies ?? [],
  );
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

  const sources = features
    .filter((feature) => feature.featData)
    .flatMap((feature) => collectFeatGrantedSpellSources(feature, actor));

  return resolveGrantedSpellSources(socket, sources);
}

/**
 * Сопоставляет связи «заклинание → черта-источник» с записями компендиума и
 * мира. Несопоставленное пропускается: связь могла указывать на пак, которого у
 * этого мастера нет, и ронять из-за неё выдачу целиком неправильно.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param sources - связи «заклинание → черта-источник»
 */
async function resolveGrantedSpellSources(
  socket: TypedWebSocketClient | null | undefined,
  sources: ReturnType<typeof collectFeatGrantedSpellSources>,
): Promise<ResolvedGrantedSpell[]> {
  if (sources.length === 0 || !socket) {
    return [];
  }

  const entries = await loadCompendiumKind(socket, 'spell');

  // Свои заклинания мира ищутся наравне с компендиумными: черта может выдавать
  // заклинание, заведённое в панели «Предметы»
  const spells = [
    ...extractSpellEntries(entries),
    ...extractWorldSpells(useItemsStore().itemsByType('spell')),
  ];

  const resolved: ResolvedGrantedSpell[] = [];

  for (const source of sources) {
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

  const proficiencies = cloneProficiencies(actor.system.proficiencies);

  applyFeatProficiencies(proficiencies, featData);

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
  const token = applyFeatDarkvision(actor.token, featData?.darkvision ?? 0);

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
 * Возвращает обновлённые настройки токена с поднятым до `darkvision` тёмным
 * зрением, либо `undefined`, если поднимать нечего (черта не даёт тёмного зрения
 * или у токена оно уже не ниже).
 *
 * @param token - текущие настройки токена актора
 * @param darkvision - тёмное зрение черты (футы)
 */
function applyFeatDarkvision(
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

  const proficiencies = cloneProficiencies(actor.system.proficiencies);

  removeFeatProficiencies(proficiencies, feature.featData ?? null);

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
