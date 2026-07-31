import type {
  CompendiumValueFormatter,
  DiceRollData,
  HealthCondition,
} from '@vtt/shared';
import type {
  BaseActor,
  BaseCreature,
  BaseGameItem,
  CustomArea,
  Feature,
  GridSettings,
  MeasurementTemplate,
  SceneEntity,
  Token,
} from '@vtt/shared';
import type { BaseActiveEffect } from '@vtt/shared';
import type { ConditionDefinition } from '@vtt/shared';
import type { SystemRollResult, VttSystem } from '@vtt/shared';
import type { ActiveEffect, EffectOrigin } from './activeEffectTypes.js';
import type { BackgroundDefinition } from './backgroundTypes.js';
import type { ConditionKey } from './consts.js';
import type { DamageApplyResult } from './damageUtils.js';
import type {
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
  Spell,
} from './dndEntities.js';
import type { IncomingAttackContext } from './effectPipeline.js';

import {
  generateId,
  getHealthCondition,
  HEALTH_CONDITIONS,
} from '@vtt/shared';
import { isRecord } from '@vtt/shared';
import { ActiveEffectsArraySchema } from './activeEffectTypes.js';
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
import { buildConditionActiveEffect } from './conditionTemplates.js';
import { CONDITIONS, CREATURE_CATEGORIES, DEFAULT_ACTOR } from './consts.js';
import {
  applyEffectsToEntity as applyEffectsToEntityImpl,
  applyTargetDamage as applyTargetDamageImpl,
  getEntityActiveFlags as getEntityActiveFlagsImpl,
  getEntityArmorClass as getEntityArmorClassImpl,
} from './damageApplication.js';
import { getSpellDamageParts } from './damageParts.js';
import { rollDamageFormula as rollDamageFormulaImpl } from './diceFormula.js';
import { collectActiveEffects, resolveActorStats } from './effectPipeline.js';
import { buildFeatGrantsSummary } from './featGrantsSummary.js';
import { validateFormula } from './formulaParser.js';
import { validateGameItem } from './itemSchemas.js';
import {
  applyAuraTriggerEffects as computeAuraTriggerEffects,
  syncActorAreaEffects,
} from './positionalEffects.js';
import { damagePartIsHealing } from './spellUtils.js';
import { isPointInTemplate as isPointInTemplateGeometry } from './templateGeometry.js';
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
 * Type-guard: запись компендиума — заклинание (для предиката лечения).
 *
 * @param entry - проверяемая запись
 */
function isSpellEntry(entry: unknown): entry is Spell {
  return isRecord(entry) && entry.type === 'spell';
}

/**
 * Type-guard: у сущности сцены есть инвентарь, то есть это актёр D&D 5e.
 * Массив `equipment` объявлен только на `DnDActor` — у существ инвентаря нет.
 *
 * @param entity - проверяемая сущность сцены
 */
function hasInventory(entity: SceneEntity): entity is DnDActor {
  return 'equipment' in entity && Array.isArray(entity.equipment);
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

  readonly version = '0.3.0';

  /**
   * Выполняет валидацию данных актера по правилам системы D&D 5e.
   *
   * @param actor Объект актера для валидации
   */
  // eslint-disable-next-line class-methods-use-this
  validateActor(actor: BaseActor): void {
    const dndActor = actor as DnDActor;

    if ('activeEffects' in dndActor && Array.isArray(dndActor.activeEffects)) {
      ActiveEffectsArraySchema.parse(dndActor.activeEffects);

      for (const effect of dndActor.activeEffects) {
        for (const change of effect.changes) {
          validateFormula(change.value);
        }
      }
    }
  }

  /**
   * Возвращает шаблон нового актёра D&D 5e по умолчанию (без `id`).
   */
  // eslint-disable-next-line class-methods-use-this
  createDefaultActor(): Partial<BaseActor> {
    return { ...DEFAULT_ACTOR };
  }

  /**
   * Валидирует данные актёра D&D 5e для формы создания/редактирования.
   */
  // eslint-disable-next-line class-methods-use-this
  validateActorData(actor: Partial<BaseActor>): void {
    validateDndActorData(actor as Partial<DnDActor>);
  }

  /**
   * Нормализует частичные данные актёра D&D 5e (зажимает значения в границы).
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeActorData(actor: Partial<BaseActor>): Partial<BaseActor> {
    return normalizeDndActorData(actor as Partial<DnDActor>);
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
    return buildFeatGrantsSummary(
      feat as Feature | DnDGameItem | BackgroundDefinition,
    );
  }

  /**
   * Вычисляет модификатор инициативы для D&D 5e с учетом баффов и дебаффов (Active Effects).
   */
  // eslint-disable-next-line class-methods-use-this
  getInitiativeModifier(actor: BaseActor): number {
    // В D&D системе мы точно знаем, что BaseActor имеет структуру DnDActor
    const dndActor = actor as DnDActor;

    // Вызываем полный пайплайн активных эффектов, чтобы получить итоговое значение инициативы
    const resolvedStats = resolveActorStats(dndActor);

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
    const result = processTurnEffects(entity as DnDSceneEntity, timing);
    const chatSummary = formatTurnEffectsMessage(entity.name, timing, result);

    return { changed: result.changed, chatSummary };
  }

  /**
   * Снимает точные `turn`-эффекты на границе хода участника `turnActorId`.
   */
  // eslint-disable-next-line class-methods-use-this
  expireTurnEffects(
    entity: SceneEntity,
    turnActorId: string,
    timing: 'start' | 'end',
  ): boolean {
    return expireEntityTurnEffects(
      entity as DnDSceneEntity,
      turnActorId,
      timing,
    );
  }

  /**
   * Уменьшает длительность (в раундах) всех эффектов на сущности, снимая истёкшие.
   */
  // eslint-disable-next-line class-methods-use-this
  decrementEffectDurations(entity: SceneEntity): boolean {
    return decrementActorEffectDurations(entity as DnDSceneEntity);
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
    options?: { triggerOneShots?: boolean },
  ): { changed: boolean; chatSummary: string | null } {
    const result = syncActorAreaEffects(
      entity as DnDSceneEntity,
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
    const outcomes = computeAuraTriggerEffects(
      scene,
      movedToken,
      movedEntity as DnDSceneEntity,
      previousToken,
      (actorId) => getEntity(actorId) as DnDSceneEntity | undefined,
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
    return collectAllAuraEffects(entity as DnDSceneEntity);
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
    // (та же доверенность, что и `entity as DnDSceneEntity` выше).
    return computeAmbientAuras(
      targetToken,
      sources as Array<{ token: Token; effects: ActiveEffect[] }>,
      gridSettings,
    );
  }

  /**
   * Суммарная скорость сущности по всем режимам движения с учётом эффектов —
   * ядро использует её как гейт «может ли токен двигаться» (0 — нельзя).
   */
  // eslint-disable-next-line class-methods-use-this
  getTotalMovementSpeed(entity: SceneEntity): number {
    const dndEntity = entity as DnDSceneEntity;
    const activeEffects = collectActiveEffects(dndEntity);
    const { movement } = resolveActorStats(dndEntity, activeEffects);

    return (
      (movement.walk || 0)
      + (movement.fly || 0)
      + (movement.swim || 0)
      + (movement.climb || 0)
      + (movement.burrow || 0)
    );
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
    return applyTargetDamageImpl(
      entity as DnDSceneEntity,
      amount,
      isHealing,
      damageType,
    );
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
    return applyEffectsToEntityImpl(
      entity as DnDSceneEntity,
      effects as ActiveEffect[],
      origin as EffectOrigin,
    );
  }

  /**
   * Возвращает итоговый КД сущности D&D 5e с учётом контекста входящей атаки.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityArmorClass(entity: SceneEntity, attackContext?: unknown): number {
    return getEntityArmorClassImpl(
      entity as DnDSceneEntity,
      attackContext as IncomingAttackContext | undefined,
    );
  }

  /**
   * Возвращает набор активных боевых флагов сущности D&D 5e.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityActiveFlags(entity: SceneEntity): ReadonlySet<string> {
    return getEntityActiveFlagsImpl(entity as DnDSceneEntity);
  }

  /**
   * Переносит предмет из инвентаря отправителя в инвентарь получателя.
   *
   * Инвентарь D&D 5e — массив `equipment` актёра, поэтому у сущностей без него
   * (существа) перенос невозможен. Предмет берётся из инвентаря отправителя, а
   * не из переданного объекта: так исключается перенос по устаревшему снимку.
   * Копия у получателя получает новый идентификатор (иначе в мире окажутся два
   * предмета с одним id) и снимается со снаряжения — слоты у нового владельца
   * свои. Сущности не мутируются: ядру возвращаются их обновлённые копии.
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
    // Перенос самому себе удалил бы предмет из копии-отправителя и добавил в
    // копию-получателя: какая из двух копий одной сущности победит при записи —
    // не определено, поэтому жест игнорируется целиком.
    if (source.id === target.id) {
      return null;
    }

    if (!hasInventory(source) || !hasInventory(target)) {
      return null;
    }

    const transferredItem = source.equipment.find(
      (entry) => entry.id === item.id,
    );

    if (!transferredItem) {
      return null;
    }

    const receivedItem: DnDGameItem = {
      ...transferredItem,
      id: generateId('eq'),
      equipped: false,
    };

    // Промежуточные переменные, а не литералы прямо в `return`: инвентарь не
    // входит в нейтральный `SceneEntity`, и проверка лишних свойств отвергла бы
    // литерал с `equipment`
    const updatedSource: DnDActor = {
      ...source,
      equipment: source.equipment.filter((entry) => entry.id !== item.id),
    };

    const updatedTarget: DnDActor = {
      ...target,
      equipment: [...target.equipment, receivedItem],
    };

    return { source: updatedSource, target: updatedTarget };
  }

  /**
   * Вычисляет итоговые характеристики актера с учетом активных эффектов.
   */
  // eslint-disable-next-line class-methods-use-this
  resolveActorStats(
    actor: BaseActor,
    effects?: readonly unknown[],
  ): Record<string, unknown> {
    return resolveActorStats(
      actor as DnDActor,
      effects as ActiveEffect[],
    ) as unknown as Record<string, unknown>;
  }

  /**
   * Собирает все активные эффекты, привязанные к актеру.
   */
  // eslint-disable-next-line class-methods-use-this
  collectActiveEffects(actor: BaseActor): readonly unknown[] {
    return collectActiveEffects(actor as DnDActor);
  }

  /**
   * Нормализует полного актёра D&D на месте при загрузке (миграция формата).
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeActor(actor: BaseActor): void {
    normalizeActor(actor as DnDActor);
  }

  /**
   * Выполняет нормализацию данных существа.
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeCreature(creature: BaseCreature): void {
    // Та же доверенность к границе системы, что и в `normalizeActor` выше:
    // внутри D&D-системы нейтральное существо ядра — это `DnDCreature`.
    normalizeCreature(creature as DnDCreature);
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
    const condition = CONDITIONS.find((entry) => entry.key === conditionKey);

    if (!condition) {
      return false;
    }

    return (activeEffects as ActiveEffect[]).some(
      (effect) =>
        effect.origin === 'condition'
        && !(effect.aura && !effect.aura.applyToSelf)
        && (effect.name === condition.nameRu
          || effect.name === condition.nameEn),
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
    const condition = CONDITIONS.find((entry) => entry.key === conditionKey);

    if (!condition) {
      return activeEffects as unknown[];
    }

    const effects = activeEffects as ActiveEffect[];
    const key = conditionKey as ConditionKey;

    if (this.isConditionActive(effects, conditionKey)) {
      return effects.filter(
        (effect) =>
          !(
            effect.origin === 'condition'
            && (effect.name === condition.nameRu
              || effect.name === condition.nameEn)
          ),
      );
    } else {
      // Единый источник правды: builder проставляет conditionKey,
      // conditionImmunities и динамические changes Истощения.
      const newEffect = buildConditionActiveEffect(key);

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
    | { key: string; nameEn: string; nameRu: string; color: string }
    | undefined {
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
   */
  // eslint-disable-next-line class-methods-use-this
  getActorHudSummary(actor: BaseActor): {
    hp: { current: number; max: number; temp: number };
  } {
    const hitPoints = isRecord(actor.system.hitPoints)
      ? actor.system.hitPoints
      : undefined;

    return {
      hp: {
        current: typeof hitPoints?.current === 'number' ? hitPoints.current : 0,
        max: typeof hitPoints?.max === 'number' ? hitPoints.max : 0,
        temp: typeof hitPoints?.temp === 'number' ? hitPoints.temp : 0,
      },
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
   * Возвращает список всех доступных состояний (conditions) в D&D 5e.
   */
  // eslint-disable-next-line class-methods-use-this
  getConditions(): ConditionDefinition[] {
    return CONDITIONS.map((condition) => ({
      key: condition.key,
      label: condition.nameRu,
      icon: condition.icon,
      description: condition.description,
      systemId: 'dnd5e-2024',
      customImage: condition.customImage,
    }));
  }
}

/** Экземпляр системы D&D 5e по умолчанию */
export const dnd5eSystemInstance = new Dnd5eVttSystem();
