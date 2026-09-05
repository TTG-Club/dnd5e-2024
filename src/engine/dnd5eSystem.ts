import type {
  BaseActiveEffect,
  BaseActor,
  BaseCreature,
  BaseGameItem,
  CompendiumValueFormatter,
  ConditionDefinition,
  CustomArea,
  DiceRollData,
  Feature,
  GridSettings,
  HealthCondition,
  MeasurementTemplate,
  MovementRange,
  SceneEntity,
  SystemRollResult,
  Token,
  VttSystem,
} from '@vtt/shared';

import type { BackgroundDefinition } from './backgroundTypes.js';
import type { DndCombatState } from './damageApplication.js';
import type { DamageApplyResult } from './damageUtils.js';
import type { DnDGameItem, Spell } from './dndEntities.js';
import type { IncomingAttackContext } from './effectPipeline.js';

import { getHealthCondition, HEALTH_CONDITIONS, isRecord } from '@vtt/shared';

import {
  ActiveEffectsArraySchema,
  isActiveEffect,
  isDnDEffect,
  isEffectOrigin,
} from './activeEffectTypes.js';
import {
  normalizeActorData as normalizeDndActorData,
  validateActorData as validateDndActorData,
} from './actorValidation.js';
import {
  collectAllAuraEffects,
  calculateAmbientAuras as computeAmbientAuras,
} from './auraMath.js';
import { normalizeActor, normalizeCreature } from './calculations.js';
import { CLASS_KEY_OPTIONS } from './classTypes.js';
import {
  buildConditionActiveEffect,
  getConditionEntry,
  listConditions,
  resolveEffectConditionKey,
} from './conditionTemplates.js';
import {
  BASE_UNARMORED_AC,
  CREATURE_CATEGORIES,
  DEFAULT_ACTOR,
} from './consts.js';
import {
  applyCombatState as applyCombatStateImpl,
  applyEffectsToEntity as applyEffectsToEntityImpl,
  applyTargetDamage as applyTargetDamageImpl,
  getEntityActiveFlags as getEntityActiveFlagsImpl,
  getEntityArmorClass as getEntityArmorClassImpl,
  pickCombatState as pickCombatStateImpl,
} from './damageApplication.js';
import { getSpellDamageParts } from './damageParts.js';
import { syncCreatureDeathCondition } from './deathState.js';
import { rollDamageFormula as rollDamageFormulaImpl } from './diceFormula.js';
import { collectActiveEffects, resolveActorStats } from './effectPipeline.js';
import { isDndSceneEntity } from './entityGuards.js';
import { buildFeatGrantsSummary } from './featGrantsSummary.js';
import { validateFormula } from './formulaParser.js';
import {
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
} from './hitPoints.js';
import { validateGameItem } from './itemSchemas.js';
import { transferItem } from './itemTransfer.js';
import {
  applyAuraTriggerEffects as computeAuraTriggerEffects,
  syncActorAreaEffects,
} from './positionalEffects.js';
import { damagePartIsHealing } from './spellUtils.js';
import { isPointInTemplate as isPointInTemplateGeometry } from './templateGeometry.js';
import {
  entityIgnoresTerrainCost as entityIgnoresTerrainCostImpl,
  resolveAreaTerrainCost,
} from './terrainCost.js';
import {
  decrementActorEffectDurations,
  expireTurnEffects as expireEntityTurnEffects,
  formatEffectsSummary,
  formatTurnEffectsMessage,
  processTurnEffects,
} from './turnEffects.js';

/**
 * Type-guard: значение — валидное состояние здоровья (`HealthCondition`).
 *
 * @param value - проверяемый элемент
 * @returns true, если value имеет форму HealthCondition
 */
function isHealthCondition(value: unknown): value is HealthCondition {
  return (
    isRecord(value)
    && typeof value.key === 'string'
    && typeof value.minPercent === 'number'
    && typeof value.maxPercent === 'number'
    && typeof value.color === 'string'
  );
}

/**
 * Type-guard: значение — массив валидных состояний здоровья.
 * Внешние `customConditions` приходят как `unknown[]` (контракт VttSystem)
 * и валидируются здесь перед передачей в типизированный расчёт.
 *
 * @param value - проверяемое значение
 * @returns true, если value — массив HealthCondition
 */
function isHealthConditionArray(value: unknown): value is HealthCondition[] {
  return Array.isArray(value) && value.every(isHealthCondition);
}

/** Подписи типов существ по ключу (для форматтера компендиума) */
const CREATURE_TYPE_LABELS: Record<string, string> = CREATURE_CATEGORIES;

/** Подписи классов по ключу (для форматтера компендиума) */
const CLASS_LABELS: Record<string, string> = Object.fromEntries(
  CLASS_KEY_OPTIONS.map((option) => [option.value, option.label]),
);

/**
 * Парсит показатель опасности (ПО) в число для сортировки.
 * Пусто/«—» → -1 (идут первыми); поддерживает дроби «1/8», «1/4», «1/2».
 *
 * @param cr - строковое значение challengeRating
 */
function parseChallengeRating(cr: string): number {
  if (!cr || cr === '—') {
    return -1;
  }

  if (cr.includes('/')) {
    const [numerator, denominator] = cr.split('/');
    const denominatorValue = Number(denominator);

    if (denominatorValue) {
      return Number(numerator) / denominatorValue;
    }
  }

  const parsed = Number(cr);

  return Number.isNaN(parsed) ? -1 : parsed;
}

/**
 * Форматтеры значений компендиума D&D по имени формата. Управляют подписью
 * и сортировкой опций фильтров и заголовков разделов в обобщённом движке
 * отображения (`useCompendiumView`).
 */
const COMPENDIUM_VALUE_FORMATTERS: Record<string, CompendiumValueFormatter> = {
  spellLevel: {
    label: (value) =>
      Number(value) === 0 ? 'Заговоры' : `${Number(value)} круг`,
    shortLabel: (value) => String(Number(value)),
    sortKey: (value) => Number(value),
  },
  challengeRating: {
    label: (value) => {
      const cr = String(value ?? '');

      return !cr || cr === '—' ? 'ПО — (без уровня опасности)' : `ПО ${cr}`;
    },
    shortLabel: (value) => {
      const cr = String(value ?? '');

      return cr && cr !== '—' ? cr : '—';
    },
    sortKey: (value) => parseChallengeRating(String(value ?? '')),
  },
  creatureType: {
    label: (value) => CREATURE_TYPE_LABELS[String(value)] ?? String(value),
    sortKey: (value) => CREATURE_TYPE_LABELS[String(value)] ?? String(value),
  },
  spellClass: {
    label: (value) => CLASS_LABELS[String(value)] ?? String(value),
    sortKey: (value) => CLASS_LABELS[String(value)] ?? String(value),
  },
};

/**
 * Проверяет, что значение — запись, по которой строится сводка механических
 * даров (черта, предмет-черта или предыстория). Все три формы адресуются по
 * названию, а остальные поля `buildFeatGrantsSummary` читает защитно.
 *
 * @param value - запись из контракта ядра
 * @returns `true`, если по записи можно строить сводку
 */
function isFeatSummarySource(
  value: unknown,
): value is Feature | DnDGameItem | BackgroundDefinition {
  return isRecord(value) && typeof value.name === 'string';
}

/**
 * Разбирает контекст входящей атаки, приходящий от ядра непрозрачным
 * значением: КД цели зависит от вида атаки (условные бонусы «+2 против
 * дальнобойных»), а чужой вид атаки такой бонус молча включил бы.
 *
 * @param value - контекст атаки из контракта ядра
 * @returns контекст атаки либо `undefined`, если вида атаки в нём нет
 */
function parseAttackContext(value: unknown): IncomingAttackContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { attackType } = value;

  if (
    attackType === 'melee'
    || attackType === 'ranged'
    || attackType === 'spell'
  ) {
    return { attackType };
  }

  return undefined;
}

/**
 * Type-guard: запись компендиума — заклинание (для предиката лечения).
 *
 * @param entry - проверяемая запись
 */
function isSpellEntry(entry: unknown): entry is Spell {
  return isRecord(entry) && entry.type === 'spell';
}

/**
 * Производные булевы предикаты компендиума по ключу — для фильтров, которые
 * нельзя выразить одним полем (лечение определяется по частям урона).
 */
const COMPENDIUM_PREDICATES: Record<string, (entry: unknown) => boolean> = {
  spellHealing: (entry) =>
    isSpellEntry(entry)
    && getSpellDamageParts(entry).some((part) => damagePartIsHealing(part)),
};

/**
 * Игровая система D&D 5e (Ядро правил).
 * Предоставляет Ядру (Core VTT) абстрагированные методы для работы
 * с Инициативой, Боевкой и т.д.
 */
export class Dnd5eVttSystem implements VttSystem {
  readonly id = 'dnd5e-2024';

  readonly name = 'Dungeons & Dragons 5th Edition';

  readonly version = '0.7.12';

  /**
   * Выполняет валидацию данных актера по правилам системы D&D 5e.
   *
   * @param actor Объект актера для валидации
   */
  // eslint-disable-next-line class-methods-use-this
  validateActor(actor: BaseActor): void {
    if (!Array.isArray(actor.activeEffects)) {
      return;
    }

    // Схема и разбирает список, и типизирует его: дальше `changes` читаются
    // из её результата, а не из непрозрачной нейтральной базы
    const effects = ActiveEffectsArraySchema.parse(actor.activeEffects);

    for (const effect of effects) {
      for (const change of effect.changes) {
        validateFormula(change.value);
      }
    }
  }

  /**
   * Возвращает шаблон нового актёра D&D 5e по умолчанию (без `id`).
   *
   * Копия глубокая: при мелкой вложенные `system`/`token`/массивы остались бы
   * общими с константой-шаблоном, и правки одного созданного актёра меняли бы
   * и шаблон, и всех созданных по нему следом.
   */
  // eslint-disable-next-line class-methods-use-this
  createDefaultActor(): Partial<BaseActor> {
    return structuredClone(DEFAULT_ACTOR);
  }

  /**
   * Валидирует данные актёра D&D 5e для формы создания/редактирования.
   */
  // eslint-disable-next-line class-methods-use-this
  validateActorData(actor: Partial<BaseActor>): void {
    validateDndActorData(actor);
  }

  /**
   * Нормализует частичные данные актёра D&D 5e (зажимает значения в границы).
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeActorData(actor: Partial<BaseActor>): Partial<BaseActor> {
    return normalizeDndActorData(actor);
  }

  /**
   * Структурно валидирует данные предмета D&D 5e через Zod-схему (обобщённый
   * конверт + лениво по типу). Бросает `Error` при нарушении.
   */
  // eslint-disable-next-line class-methods-use-this
  validateItemData(item: unknown): void {
    validateGameItem(item);
  }

  /**
   * Строит Markdown-сводку механических даров черты/предмета/предыстории D&D 5e.
   */
  // eslint-disable-next-line class-methods-use-this
  getFeatGrantsSummary(feat: unknown): string {
    return isFeatSummarySource(feat) ? buildFeatGrantsSummary(feat) : '';
  }

  /**
   * Вычисляет модификатор инициативы для D&D 5e с учетом баффов и дебаффов (Active Effects).
   */
  // eslint-disable-next-line class-methods-use-this
  getInitiativeModifier(actor: BaseActor): number {
    // Актёр без данных системы в инициативу не вступает: считать её не по чему
    if (!isDndSceneEntity(actor)) {
      return 0;
    }

    // Вызываем полный пайплайн активных эффектов, чтобы получить итоговое значение инициативы
    const resolvedStats = resolveActorStats(actor);

    return resolvedStats.initiative;
  }

  /**
   * Совершает бросок инициативы (1к20 + модификатор)
   */
  rollInitiative(
    actor: BaseActor,
    rollFn?: (formula: string) => DiceRollData,
  ): SystemRollResult {
    const modifier = this.getInitiativeModifier(actor);

    if (rollFn) {
      // Клиент: Делаем бросок через стор (DiceRoller)
      const rollData = rollFn('1к20');

      return {
        roll: rollData.total, // Это чистое значение кубика от 1 до 20
        modifier,
        total: rollData.total + modifier,
        rollData,
      };
    }

    // Сервер (или если rollFn не передан): Автоматический математический бросок
    const roll = Math.floor(Math.random() * 20) + 1;

    return {
      roll,
      modifier,
      total: roll + modifier,
    };
  }

  /**
   * Инициализация системы (серверный lifecycle).
   * Пустая реализация по умолчанию — переопределяется серверным подклассом.
   */
  // eslint-disable-next-line class-methods-use-this
  init(_api: unknown): void {
    // Пустая реализация — override в серверном подклассе
  }

  /**
   * Уничтожение системы (серверный lifecycle).
   * Пустая реализация по умолчанию — переопределяется серверным подклассом.
   */
  // eslint-disable-next-line class-methods-use-this
  destroy(): void {
    // Пустая реализация — override в серверном подклассе
  }

  /**
   * Прогоняет периодические эффекты сущности на границе хода (DoT-урон +
   * повторные спасброски D&D 5e) и возвращает флаг изменения и сводку для чата.
   */
  // eslint-disable-next-line class-methods-use-this
  runTurnEffects(
    entity: SceneEntity,
    timing: 'startOfTurn' | 'endOfTurn',
  ): { changed: boolean; chatSummary: string | null } {
    if (!isDndSceneEntity(entity)) {
      return { changed: false, chatSummary: null };
    }

    const result = processTurnEffects(entity, timing);
    const chatSummary = formatTurnEffectsMessage(entity.name, timing, result);

    return { changed: result.changed, chatSummary };
  }

  /**
   * Снимает точные `turn`-эффекты на границе хода участника `turnActorId`.
   *
   * Состав боя нужен, чтобы отличить достижимый якорь-источник от недостижимого:
   * эффект «до конца хода кастера», которого нет в трекере инициативы, ждал бы
   * хода, который не наступит, — такой якорь деградирует к носителю.
   */
  // eslint-disable-next-line class-methods-use-this
  expireTurnEffects(
    entity: SceneEntity,
    turnActorId: string,
    timing: 'start' | 'end',
    participantIds: ReadonlySet<string>,
  ): boolean {
    if (!isDndSceneEntity(entity)) {
      return false;
    }

    return expireEntityTurnEffects(entity, turnActorId, timing, participantIds);
  }

  /**
   * Уменьшает длительность (в раундах) всех эффектов на сущности, снимая истёкшие.
   */
  // eslint-disable-next-line class-methods-use-this
  decrementEffectDurations(entity: SceneEntity): boolean {
    if (!isDndSceneEntity(entity)) {
      return false;
    }

    return decrementActorEffectDurations(entity);
  }

  /**
   * Синхронизирует эффекты зон при перемещении токена и форматирует сводку
   * сработавших триггеров для чата (метка «область»).
   */
  // eslint-disable-next-line class-methods-use-this
  syncAreaEffects(
    entity: SceneEntity,
    previousAreaIds: ReadonlySet<string>,
    currentAreaIds: ReadonlySet<string>,
    areas: CustomArea[],
    options?: {
      triggerOneShots?: boolean;
      alreadyEnteredAreaIds?: ReadonlySet<string>;
    },
  ): { changed: boolean; chatSummary: string | null } {
    if (!isDndSceneEntity(entity)) {
      return { changed: false, chatSummary: null };
    }

    const result = syncActorAreaEffects(
      entity,
      previousAreaIds,
      currentAreaIds,
      areas,
      options,
    );

    const chatSummary = formatEffectsSummary(
      entity.name,
      'область',
      result.damageOutcomes,
      result.saveOutcomes,
      (save) => (save.passed ? '✓ спас' : '✗ провал'),
    );

    return { changed: result.changed, chatSummary };
  }

  /**
   * Обрабатывает разовые триггер-ауры при перемещении токена и форматирует по
   * каждой затронутой сущности сводку для чата (метка «аура»).
   */
  // eslint-disable-next-line class-methods-use-this
  applyAuraTriggerEffects(
    scene: { tokens?: Token[]; gridSettings?: GridSettings },
    movedToken: Token,
    movedEntity: SceneEntity,
    previousToken: Token | undefined,
    getEntity: (actorId: string) => SceneEntity | undefined,
  ): Array<{
    entity: SceneEntity;
    changed: boolean;
    chatSummary: string | null;
  }> {
    if (!isDndSceneEntity(movedEntity)) {
      return [];
    }

    const outcomes = computeAuraTriggerEffects(
      scene,
      movedToken,
      movedEntity,
      previousToken,
      (actorId) => {
        const entity = getEntity(actorId);

        return entity && isDndSceneEntity(entity) ? entity : undefined;
      },
    );

    return outcomes.map((outcome) => ({
      entity: outcome.entity,
      changed: outcome.changed,
      chatSummary: formatEffectsSummary(
        outcome.entity.name,
        'аура',
        outcome.damageOutcomes,
        outcome.saveOutcomes,
        (save) => (save.passed ? '✓ спас' : '✗ провал'),
      ),
    }));
  }

  /**
   * Проверяет попадание точки в область шаблона измерения по геометрии D&D 5e
   * (круг/конус/куб/линия).
   */
  // eslint-disable-next-line class-methods-use-this
  isPointInTemplate(
    pointX: number,
    pointY: number,
    gridSize: number,
    template: MeasurementTemplate,
  ): boolean {
    return isPointInTemplateGeometry(pointX, pointY, gridSize, template);
  }

  /**
   * Минимальный бросок кубиковой формулы урона D&D (сумма + выпавшие значения).
   */
  // eslint-disable-next-line class-methods-use-this
  rollDamageFormula(formula: string): { total: number; values: number[] } {
    return rollDamageFormulaImpl(formula);
  }

  /**
   * Собирает все аура-эффекты сущности (на самой сущности + с экипировки).
   */
  // eslint-disable-next-line class-methods-use-this
  collectAuraEffects(entity: SceneEntity): BaseActiveEffect[] {
    return isDndSceneEntity(entity) ? collectAllAuraEffects(entity) : [];
  }

  /**
   * Вычисляет внешние (ambient) аура-эффекты, накрывающие целевой токен.
   */
  // eslint-disable-next-line class-methods-use-this
  calculateAmbientAuras(
    targetToken: Token,
    sources: Array<{ token: Token; effects: BaseActiveEffect[] }>,
    gridSettings: GridSettings,
  ): BaseActiveEffect[] {
    // Границы системы D&D: нейтральные эффекты контракта — это D&D-эффекты
    // (`isDnDEffect` — доверенный шов системы к своим же данным).
    const dndSources = sources.map((source) => ({
      token: source.token,
      effects: source.effects.filter(isDnDEffect),
    }));

    return computeAmbientAuras(targetToken, dndSources, gridSettings);
  }

  /**
   * Суммарная скорость сущности по всем режимам движения с учётом эффектов —
   * ядро использует её как гейт «может ли токен двигаться» (0 — нельзя).
   */
  // eslint-disable-next-line class-methods-use-this
  getTotalMovementSpeed(entity: SceneEntity): number {
    // Сущность без данных системы правилами D&D не двигается: считать её
    // скорость не по чему, и ядро получит 0 вместо ошибки в обработчике хода
    if (!isDndSceneEntity(entity)) {
      return 0;
    }

    const activeEffects = collectActiveEffects(entity);
    const { movement } = resolveActorStats(entity, activeEffects);

    return (
      (movement.walk || 0)
      + (movement.fly || 0)
      + (movement.swim || 0)
      + (movement.climb || 0)
      + (movement.burrow || 0)
    );
  }

  /**
   * Дальность хода сущности за один ход — ядро красит по ней маршрут токена.
   *
   * Скорость по правилам D&D 2024 — это Скорость ходьбы. Существо, которое
   * ходить не умеет (парящее, плавающее, роющее), перемещается своим режимом,
   * поэтому при нулевой ходьбе берётся самый быстрый из остальных: иначе у
   * дракона в полёте зона хода схлопнулась бы в точку.
   *
   * «Рывок» даёт прибавку, равную Скорости, — отсюда удвоение предела.
   */
  // eslint-disable-next-line class-methods-use-this
  getMovementRange(entity: SceneEntity): MovementRange | null {
    // Сущность без данных системы считать не по чему
    if (!isDndSceneEntity(entity)) {
      return null;
    }

    const activeEffects = collectActiveEffects(entity);
    const { movement } = resolveActorStats(entity, activeEffects);

    const base =
      movement.walk
      || Math.max(
        movement.fly || 0,
        movement.swim || 0,
        movement.climb || 0,
        movement.burrow || 0,
      );

    if (base <= 0) {
      return { base: 0, extended: 0 };
    }

    return { base, extended: base * 2 };
  }

  /**
   * Множитель цены клетки внутри зоны — труднопроходимая местность.
   *
   * Правило мастер задаёт строкой модификатора `terrain.movementCost` в
   * эффектах зоны, поэтому читается оно отсюда, а не из полей самой зоны.
   */
  // eslint-disable-next-line class-methods-use-this
  getAreaMovementCost(area: CustomArea): number {
    return resolveAreaTerrainCost(area);
  }

  /**
   * Не смотрит ли сущность на труднопроходимость вовсе (флаг
   * `terrain.ignoreDifficult` — сапоги, черта, форма движения).
   */
  // eslint-disable-next-line class-methods-use-this
  entityIgnoresTerrainCost(entity: SceneEntity): boolean {
    // Сущность без данных системы правилами D&D не описана: считать её
    // игнорирующей нельзя, иначе болото перестало бы работать на всех подряд
    if (!isDndSceneEntity(entity)) {
      return false;
    }

    return entityIgnoresTerrainCostImpl(entity);
  }

  /**
   * Снимает боевое состояние сущности D&D 5e (ХП и активные эффекты) для
   * отправки на сервер узким каналом `entity:apply-combat-state`.
   */
  // eslint-disable-next-line class-methods-use-this
  pickCombatState(entity: SceneEntity): DndCombatState | undefined {
    // Снимок сущности без данных системы не собрать, а выдумывать его нельзя —
    // он уходит на сервер и записывается в мир. `undefined` — штатный ответ
    // контракта: ядро откатится на полную замену сущности.
    return isDndSceneEntity(entity) ? pickCombatStateImpl(entity) : undefined;
  }

  /**
   * Записывает боевое состояние в сущность D&D 5e на сервере, проверив
   * пришедший от клиента снимок.
   */
  // eslint-disable-next-line class-methods-use-this
  applyCombatState(entity: SceneEntity, state: unknown): boolean {
    return isDndSceneEntity(entity)
      ? applyCombatStateImpl(entity, state)
      : false;
  }

  /**
   * Применяет урон/лечение к сущности D&D 5e (мутирует ХП с учётом защит и
   * временных ХП) и возвращает сводку изменения.
   */
  // eslint-disable-next-line class-methods-use-this
  applyDamageToEntity(
    entity: SceneEntity,
    amount: number,
    isHealing: boolean,
    damageType?: string,
  ): DamageApplyResult {
    // Сущность без данных системы урона не получает: её запас хитов неизвестен,
    // и выдуманное «после» ушло бы в метку и в чат как настоящее
    if (!isDndSceneEntity(entity)) {
      return { actorName: entity.name, hpBefore: 0, hpAfter: 0 };
    }

    return applyTargetDamageImpl(entity, amount, isHealing, damageType);
  }

  /**
   * Накладывает эффекты на сущность D&D 5e (иммунитеты, condition-сборка,
   * слияние) и возвращает обновлённый список `activeEffects`.
   */
  // eslint-disable-next-line class-methods-use-this
  applyEffectsToEntity(
    entity: SceneEntity,
    effects: BaseActiveEffect[],
    origin: string,
  ): BaseActiveEffect[] {
    if (!isDndSceneEntity(entity) || !isEffectOrigin(origin)) {
      return entity.activeEffects ?? [];
    }

    return applyEffectsToEntityImpl(
      entity,
      effects.filter(isDnDEffect),
      origin,
    );
  }

  /**
   * Возвращает итоговый КД сущности D&D 5e с учётом контекста входящей атаки.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityArmorClass(entity: SceneEntity, attackContext?: unknown): number {
    if (!isDndSceneEntity(entity)) {
      return BASE_UNARMORED_AC;
    }

    return getEntityArmorClassImpl(entity, parseAttackContext(attackContext));
  }

  /**
   * Возвращает набор активных боевых флагов сущности D&D 5e.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityActiveFlags(entity: SceneEntity): ReadonlySet<string> {
    return isDndSceneEntity(entity)
      ? getEntityActiveFlagsImpl(entity)
      : new Set<string>();
  }

  /**
   * Переносит предмет из инвентаря отправителя в инвентарь получателя.
   *
   * Правило переноса живёт в движке ({@link transferItem}) и одно на все пути:
   * этот метод контракта зовёт ядро при перетаскивании токена на токен, а тот
   * же расчёт вызывает лист, на который предмет бросили мышью. Стороны — любые
   * сущности с инвентарём, а не только актёры.
   *
   * Права на перенос (владелец или ГМ) проверяет ядро — это правило VTT, а не
   * D&D, поэтому здесь их нет.
   *
   * @param source - сущность-отправитель
   * @param target - сущность-получатель
   * @param item - переносимый предмет
   * @returns обновлённые копии обеих сущностей либо `null`, если перенос невозможен
   */
  // eslint-disable-next-line class-methods-use-this
  transferItemBetweenEntities(
    source: SceneEntity,
    target: SceneEntity,
    item: BaseGameItem,
  ): { source: SceneEntity; target: SceneEntity } | null {
    return transferItem(source, target, item);
  }

  /**
   * Вычисляет итоговые характеристики актера с учетом активных эффектов.
   */
  // eslint-disable-next-line class-methods-use-this
  resolveActorStats(
    actor: BaseActor,
    effects?: readonly unknown[],
  ): Record<string, unknown> {
    if (!isDndSceneEntity(actor)) {
      return {};
    }

    const dndEffects = effects?.filter(isActiveEffect);

    // Копией, а не приведением: контракт ядра объявляет итог свободной записью,
    // а `ResolvedActorStats` — интерфейс без индексной сигнатуры, и структурно
    // он такой записи не соответствует. Тот же приём, что и в SDK для
    // `BaseGameItem`: туда, где ждут свободную форму, значение идёт копией.
    return { ...resolveActorStats(actor, dndEffects) };
  }

  /**
   * Собирает все активные эффекты, привязанные к актеру.
   */
  // eslint-disable-next-line class-methods-use-this
  collectActiveEffects(actor: BaseActor): readonly unknown[] {
    return isDndSceneEntity(actor) ? collectActiveEffects(actor) : [];
  }

  /**
   * Нормализует полного актёра D&D на месте при загрузке (миграция формата).
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeActor(actor: BaseActor): void {
    normalizeActor(actor);
  }

  /**
   * Выполняет нормализацию данных существа.
   *
   * Здесь же пересчитывается метка смерти: Ядро прогоняет существо через этот
   * метод при каждом изменении (создание и обновление на клиенте, загрузка мира
   * на сервере), поэтому череп на токене появляется и снимается одинаково,
   * какой бы путь ни поменял хиты.
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeCreature(creature: BaseCreature): void {
    normalizeCreature(creature);
    syncCreatureDeathCondition(creature);
  }

  /**
   * Возвращает список доступных классов в системе для компендиума.
   */
  // eslint-disable-next-line class-methods-use-this
  getClassKeyOptions(): Array<{ value: string; label: string }> {
    return [...CLASS_KEY_OPTIONS];
  }

  /**
   * Возвращает форматтер значений компендиума по имени формата.
   */
  // eslint-disable-next-line class-methods-use-this
  getCompendiumValueFormatter(
    format: string,
  ): CompendiumValueFormatter | undefined {
    return COMPENDIUM_VALUE_FORMATTERS[format];
  }

  /**
   * Возвращает производный булев предикат компендиума по ключу.
   */
  // eslint-disable-next-line class-methods-use-this
  getCompendiumPredicate(
    key: string,
  ): ((entry: unknown) => boolean) | undefined {
    return COMPENDIUM_PREDICATES[key];
  }

  /**
   * Проверяет, активно ли конкретное состояние у актора.
   */
  // eslint-disable-next-line class-methods-use-this
  isConditionActive(
    activeEffects: readonly unknown[],
    conditionKey: string,
  ): boolean {
    return activeEffects
      .filter(isActiveEffect)
      .some(
        (effect) =>
          !(effect.aura && !effect.aura.applyToSelf)
          && resolveEffectConditionKey(effect) === conditionKey,
      );
  }

  /**
   * Переключает (добавляет/удаляет) состояние в списке эффектов актора.
   */

  toggleCondition(
    activeEffects: readonly unknown[],
    conditionKey: string,
    generateIdFn: (prefix: string) => string,
  ): unknown[] {
    const condition = getConditionEntry(conditionKey);

    if (!condition) {
      return [...activeEffects];
    }

    const effects = activeEffects.filter(isActiveEffect);

    if (this.isConditionActive(effects, conditionKey)) {
      return effects.filter(
        (effect) => resolveEffectConditionKey(effect) !== conditionKey,
      );
    } else {
      // Единый источник правды: builder проставляет conditionKey,
      // conditionImmunities и динамические changes Истощения.
      // Ключ берётся у найденного состояния, а не у входной строки: он уже
      // типизирован справочником, и лишняя проверка не нужна
      const newEffect = buildConditionActiveEffect(condition.key);

      if (!newEffect) {
        return [...effects];
      }

      newEffect.id = generateIdFn('effect');

      return [...effects, newEffect];
    }
  }

  /**
   * Определяет состояние здоровья по текущим и максимальным ХП по правилам системы.
   */
  // eslint-disable-next-line class-methods-use-this
  getHealthCondition(
    currentHp: number,
    maxHp: number,
    isActor?: boolean,
    customConditions?: unknown[],
  ):
    { key: string; nameEn: string; nameRu: string; color: string } | undefined {
    return getHealthCondition(
      currentHp,
      maxHp,
      isActor,
      isHealthConditionArray(customConditions) ? customConditions : undefined,
    );
  }

  /**
   * Возвращает таблицу состояний здоровья D&D 5e по умолчанию (пороги %ХП).
   */
  // eslint-disable-next-line class-methods-use-this
  getDefaultHealthConditions(): readonly HealthCondition[] {
    return HEALTH_CONDITIONS;
  }

  /**
   * Возвращает сводку ХП актёра для HUD выбранного токена (панель над сценой).
   * Читает `system.hitPoints` защитно из нейтрального блоба — ядро не знает
   * имён D&D-полей.
   *
   * Максимум берётся с учётом эффектов (ключ `hitPoints.max`) — тем же
   * расчётом, что у плитки хитов листа и у ограничения текущих хитов сверху.
   * Иначе после «Ложной жизни» HUD показывал бы 25/20: текущие хиты выше
   * собственного максимума.
   */
  // eslint-disable-next-line class-methods-use-this
  getActorHudSummary(actor: BaseActor): {
    hp: { current: number; max: number; temp: number };
  } {
    const hitPoints = isRecord(actor.system.hitPoints)
      ? actor.system.hitPoints
      : undefined;

    const baseMax = typeof hitPoints?.max === 'number' ? hitPoints.max : 0;

    return {
      hp: {
        current: typeof hitPoints?.current === 'number' ? hitPoints.current : 0,
        max: isDndSceneEntity(actor) ? resolveEntityMaxHp(actor) : baseMax,
        temp: typeof hitPoints?.temp === 'number' ? hitPoints.temp : 0,
      },
    };
  }

  /**
   * Возвращает хиты сущности для полосы и подписи НАД ТОКЕНОМ на сцене.
   *
   * Ядро читало `system.hitPoints` непрозрачным блобом и брало поле `max`, где
   * записан исходный запас листа. Но записанный максимум — не весь максимум:
   * эффект с ключом `hitPoints.max` («Помощь») поднимает потолок, и вылеченная
   * до 25 сущность с `max: 20` рисовалась над токеном как «25/20» — полоса
   * упиралась в край и спорила с листом.
   *
   * Поэтому максимум считается тем же `resolveEntityMaxHp`, что и плитка хитов
   * листа, лечение и ограничение текущих хитов сверху: разнобой не должен
   * вернуться с другой стороны. Текущие хиты — `resolveEntityCurrentHp`: у
   * существа без явного `current` это полный запас ЛИСТА (см. `hitPoints.ts`).
   *
   * Сущность не в форме D&D — `undefined`, ядро откатится на чтение блоба само.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityHitPoints(
    entity: SceneEntity,
  ): { current: number; max: number; temp: number } | undefined {
    if (!isDndSceneEntity(entity)) {
      return undefined;
    }

    return {
      current: resolveEntityCurrentHp(entity),
      max: resolveEntityMaxHp(entity),
      // Временные хиты необязательны у обоих видов сущностей — читаем защитно,
      // как это делает `getActorHudSummary`
      temp: resolveEntityTempHp(entity),
    };
  }

  /**
   * Возвращает бейдж «ПО X» (показатель опасности) для существа в списках ядра.
   * `undefined` — у существа нет показателя опасности.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityListBadge(creature: BaseCreature): string | undefined {
    const challengeRating = creature.system.challengeRating;

    // ПО хранится строкой ('1/4'), но в старых мирах/импортах встречается и
    // числом (normalizeCreature его к строке не коэрсит) — бейдж обязан
    // показываться в обоих случаях, как в UI до расшивки ядра.
    if (typeof challengeRating === 'number') {
      return `ПО ${challengeRating}`;
    }

    return typeof challengeRating === 'string' && challengeRating.length > 0
      ? `ПО ${challengeRating}`
      : undefined;
  }

  /**
   * Возвращает список всех доступных состояний: канон PHB плюс состояния,
   * заведённые в мире («Мастерская» → «Состояния»).
   */
  // eslint-disable-next-line class-methods-use-this
  getConditions(): ConditionDefinition[] {
    return listConditions().map((condition) => ({
      key: condition.key,
      label: condition.nameRu,
      icon: condition.icon,
      description: condition.description,
      systemId: 'dnd5e-2024',
      customImage: condition.customImage,
      overlay: condition.overlay,
    }));
  }
}

/** Экземпляр системы D&D 5e по умолчанию */
export const dnd5eSystemInstance = new Dnd5eVttSystem();
