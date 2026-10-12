/**
 * Кнопки под уроном атаки в карточке чата: «Отменить урон» и «Нанести урон»,
 * а рядом — переключатели «Половина» / «Полный урон» и «Крит» / «Не крит».
 *
 * Ядро про урон не знает: оно хранит в дополнении сообщения вид и строку
 * данных системы и рисует кнопки, которые система зарегистрировала для этого
 * вида. Здесь — что эти кнопки делают: отмена возвращает целям ровно снятые
 * хиты, снимает наложенное ударом (эффекты, провалы спасбросков от смерти) и
 * ставит на место урона отметку об отмене, повтор перебрасывает только
 * кости урона (без броска попадания, с тем же критом и по тем же целям) и
 * возвращает на место отметки новый урон.
 *
 * Переключатели урон не перебрасывают: они меняют, сколько записанного
 * броска досталось целям, и правят хиты ровно на разницу (правила расчёта —
 * в `attackDamageModes.ts` движка). «Половина» — половина урона цели после
 * её защит, вниз. «Крит» бросает кости урона ещё раз, без модификаторов, и
 * добавляет их; «Не крит» убирает ровно эти кости — и у попадания, которое
 * критом и было. Вместе — половина от урона с костями крита. Над нанесённым
 * уроном меняются только хиты; над отменённым кнопка наносит записанный
 * бросок заново в выбранном режиме. Режимы записаны в данных карточки:
 * «Отменить урон» возвращает всё снятое в любом режиме, «Нанести урон»
 * перебрасывает кости и наносит урон в том же режиме.
 *
 * «Половина» и «Крит» под нанесённым уроном доступны мастеру и автору атаки.
 * «Отменить урон», «Нанести урон» и те же переключатели над отменённым уроном
 * (там они наносят его заново) — мастеру, а автору атаки только с правом роли
 * «Отмена урона из чата» (`REVERT_CHAT_DAMAGE`, таблица прав ролей ядра).
 * Кнопку, которая смотрящему не дана, прячет её вид (`hidden`), а обработчики
 * отказывают сами — замену дополнения сервер разрешает любому автору
 * сообщения. Правило — в `attackDamageAccess.ts` движка.
 */

import type {
  ChatFollowUpActionContext,
  ChatFollowUpActionView,
} from '@/core/registries';
import type {
  ChatBadge,
  ChatBlock,
  ChatBlockRow,
  ChatFollowUpInput,
  ChatMessageFollowUp,
  DiceRollData,
} from '@vtt/shared';
import type {
  AppliedDamagePart,
  AppliedRecordedDamage,
  AttackDamageAction,
  AttackDamageActionRefusal,
  AttackDamageModes,
  AttackDamageRecord,
  AttackDamageTarget,
  ChangedDamageModes,
  DnDSceneEntity,
  HpChangeRowPlacement,
} from '@vtt/shared/system/dnd.js';

import { usePermissions } from '@/shared_ui/composables';
import { useChatStore } from '@/stores/chatStore';
import { useDiceRollerStore } from '@/stores/diceRollerStore';
import { useWorldStore } from '@/stores/worldStore';
import {
  applyRecordedDamage,
  attachHpChangeDetails,
  ATTACK_DAMAGE_FOLLOW_UP_KIND,
  ATTACK_DAMAGE_REVERTED_FOLLOW_UP_KIND,
  buildDamageChatBlock,
  buildDamageChatRowLabel,
  buildDamageLabel,
  captureHitConsequences,
  changeRecordedDamageModes,
  formatDamageDefenseNote,
  formatDamageDefenseSuffix,
  formatDiceFormula,
  formatHpChangeValue,
  hasCritDice,
  isEntityHpShownToPlayers,
  joinChatDetail,
  listRolledDiceValues,
  listUnrolledCritDice,
  parseAttackDamageRecord,
  pickRowTargetName,
  planDamageReroll,
  readDamageModes,
  resolveAttackDamageActionRefusal,
  resolveEntityCurrentHp,
  resolveEntityTempHp,
  REVERT_CHAT_DAMAGE_PERMISSION,
  revertRecordedDamage,
  revertRecordedDeathSaves,
  serializeAttackDamageRecord,
  supportsDamageModes,
  toRollerFormula,
  withCritDiceRolls,
  withHpChangeDetail,
  withRerolledDamage,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  ATTACK_DAMAGE_ACTION_LABELS,
  DAMAGE_DEDUCTION_LABELS,
} from '../ui/actor/constants';
import { buildAttackDamageChatOptions } from './damageChatMessage';
import { changeEntityCombatState } from './entityCombatWrite';
import { changeEntitySheet } from './entitySheetWrite';
import { getPartKindLabel } from './spellResolutionShared';

/** Повторный урон одной цели: что с неё снято и чем это показать в чате */
interface ReappliedTarget {
  /** Цель записи с новыми снятыми хитами */
  target: AttackDamageTarget;
  /** Итог применения — для строк чата */
  applied: AppliedRecordedDamage;
}

/**
 * Урон одной цели в режимах записи — то, из чего собирается строка карточки:
 * и после переключения режима, и после повторного урона
 */
type DamageModeView = Pick<
  ChangedDamageModes,
  'target' | 'total' | 'damage' | 'parts' | 'hpChange'
>;

/** Чем объяснить отказ в действии над уроном */
const ATTACK_DAMAGE_REFUSAL_TITLES: Readonly<
  Record<AttackDamageActionRefusal, string>
> = {
  authorOnly: ATTACK_DAMAGE_ACTION_LABELS.authorOnlyTitle,
  revertForbidden: ATTACK_DAMAGE_ACTION_LABELS.revertForbiddenTitle,
};

/**
 * Есть ли у роли пользователя право «Отмена урона из чата». Мастеру ядро
 * отвечает «да» всегда; ядро старше этого права проверку ролей системе не
 * отдаёт — там отмена остаётся мастеру.
 *
 * @returns `true`, если пользователь вправе отменять урон своей атаки
 */
function canRevertDamage(): boolean {
  return (
    typeof usePermissions === 'function'
    && usePermissions().hasPermission.value(REVERT_CHAT_DAMAGE_PERMISSION)
  );
}

/**
 * Прятать ли кнопку действия от того, кто смотрит ленту. Кнопки ядро
 * показывает только автору сообщения и мастеру, поэтому смотрящий не-мастер
 * здесь — автор атаки.
 *
 * @param action - действие кнопки
 * @param followUp - дополнение, под которым она стоит
 * @returns `true`, если действие смотрящему не дано
 */
function isActionHidden(
  action: AttackDamageAction,
  followUp: ChatMessageFollowUp,
): boolean {
  return (
    resolveAttackDamageActionRefusal({
      action,
      isGM: useWorldStore().isGM,
      isAuthor: true,
      isApplied: followUp.kind === ATTACK_DAMAGE_FOLLOW_UP_KIND,
      canRevertDamage: canRevertDamage(),
    }) !== null
  );
}

/**
 * Показывает отказ: действие над уроном не выполнено.
 *
 * @param title - что случилось
 * @param description - пояснение
 */
function refuse(title: string, description?: string): void {
  useSystemToastStore().add({ title, description, color: 'warning' });
}

/**
 * Запись дополнения, если с ней сейчас можно работать. Кому какое действие
 * разрешено, решает `resolveAttackDamageActionRefusal`; лишние кнопки
 * спрятаны от игрока, а здесь — отказ на случай, если действие вызвали в
 * обход кнопки.
 *
 * @param context - сообщение и дополнение, под которым нажали кнопку
 * @param action - действие, кнопку которого нажали
 * @returns запись или `null` — отказ уже показан
 */
function readActionableRecord(
  context: ChatFollowUpActionContext,
  action: AttackDamageAction,
): AttackDamageRecord | null {
  const worldStore = useWorldStore();

  const refusal = resolveAttackDamageActionRefusal({
    action,
    isGM: worldStore.isGM,
    isAuthor: worldStore.currentUser?.id === context.message.authorId,
    isApplied: context.followUp.kind === ATTACK_DAMAGE_FOLLOW_UP_KIND,
    canRevertDamage: canRevertDamage(),
  });

  if (refusal) {
    refuse(ATTACK_DAMAGE_REFUSAL_TITLES[refusal]);

    return null;
  }

  const record = parseAttackDamageRecord(context.followUp.payload);

  if (!record) {
    refuse(
      ATTACK_DAMAGE_ACTION_LABELS.unreadableTitle,
      ATTACK_DAMAGE_ACTION_LABELS.unreadableDescription,
    );

    return null;
  }

  return record;
}

/**
 * Заменяет дополнение карточки. Ядро без замены дополнений действий не
 * регистрирует вовсе, поэтому отсутствие метода здесь — только страховка.
 *
 * @param context - сообщение и заменяемое дополнение
 * @param replacement - новое дополнение
 */
function replaceFollowUp(
  context: ChatFollowUpActionContext,
  replacement: ChatFollowUpInput,
): void {
  useChatStore().replaceFollowUp?.(
    context.message.id,
    context.followUp.id,
    replacement,
  );
}

/**
 * Имена эффектов, которые отмена сняла с цели.
 *
 * @param before - цель до возврата
 * @param after - цель после возврата
 * @returns имена снятых эффектов
 */
function listRemovedEffectNames(
  before: DnDSceneEntity,
  after: DnDSceneEntity,
): string[] {
  const keptIds = new Set(
    (after.activeEffects ?? []).map((effect) => effect.id),
  );

  return (before.activeEffects ?? [])
    .filter((effect) => !keptIds.has(effect.id))
    .map((effect) => effect.name);
}

/**
 * Строка об одной цели в отметке отмены: сколько хитов ей вернулось и какие
 * эффекты удара с неё сняты.
 *
 * @param name - имя цели
 * @param before - цель до возврата
 * @param after - цель после возврата
 * @returns строка для чата
 */
function formatRestoredLine(
  name: string,
  before: DnDSceneEntity,
  after: DnDSceneEntity,
): string {
  const restoredHp =
    resolveEntityCurrentHp(after) - resolveEntityCurrentHp(before);

  const restoredTemp = resolveEntityTempHp(after) - resolveEntityTempHp(before);

  const tempSuffix =
    restoredTemp > 0
      ? `${ATTACK_DAMAGE_ACTION_LABELS.restoredTempPrefix}${restoredTemp}${ATTACK_DAMAGE_ACTION_LABELS.restoredTempSuffix}`
      : '';

  const removedEffects = listRemovedEffectNames(before, after);

  const effectsSuffix =
    removedEffects.length > 0
      ? `${ATTACK_DAMAGE_ACTION_LABELS.removedEffectsPrefix}${removedEffects.join(', ')}`
      : '';

  return `→ ${name}: +${restoredHp}${ATTACK_DAMAGE_ACTION_LABELS.restoredHpSuffix}${tempSuffix}${effectsSuffix}`;
}

/**
 * Строка блока об одной цели в отметке отмены: «Урон отменён» и сколько
 * хитов ей вернулось, пометкой — снятые эффекты удара, а в подробностях —
 * временные хиты и хиты цели до и после. Имя цели — только когда целей несколько: единственную
 * называет шапка карточки атаки.
 *
 * @param targetName - имя цели для строки; нет — цель у удара одна
 * @param before - цель до возврата
 * @param after - цель после возврата
 * @returns строка блока карточки чата
 */
function buildRestoredRow(
  targetName: string | undefined,
  before: DnDSceneEntity,
  after: DnDSceneEntity,
): ChatBlockRow {
  const restoredTemp = resolveEntityTempHp(after) - resolveEntityTempHp(before);
  const removedEffects = listRemovedEffectNames(before, after);

  const restoredRow: ChatBlockRow = {
    icon: ATTACK_DAMAGE_ACTION_LABELS.revertIcon,
    name: ATTACK_DAMAGE_ACTION_LABELS.reverted,
    ...(targetName ? { target: targetName } : {}),
    ...formatHpChangeValue(
      resolveEntityCurrentHp(after) - resolveEntityCurrentHp(before),
      { isHealing: true },
    ),
    // Снятое отменой — тоже итог: видно сразу, а не в подробностях
    ...(removedEffects.length > 0
      ? {
          note: `${ATTACK_DAMAGE_ACTION_LABELS.removedEffectsDetail}${removedEffects.join(', ')}`,
        }
      : {}),
    ...(restoredTemp > 0
      ? {
          detail: `${ATTACK_DAMAGE_ACTION_LABELS.restoredTempDetail}${restoredTemp}`,
        }
      : {}),
  };

  // Хиты цели до и после возврата: видны всем, только если её хиты открыты
  // игрокам, иначе — одному мастеру
  return withHpChangeDetail(restoredRow, {
    hpBefore: resolveEntityCurrentHp(before),
    hpAfter: resolveEntityCurrentHp(after),
    tempBefore: resolveEntityTempHp(before),
    tempAfter: resolveEntityTempHp(after),
    isPublic: isEntityHpShownToPlayers(after),
  });
}

/**
 * Возвращает персонажу серию спасбросков от смерти, какой она была до удара.
 * Серия лежит в листе, а не в боевом состоянии, поэтому пишется записью
 * листа — отдельно от хитов и эффектов.
 *
 * @param target - цель записи: что удар сделал с серией
 */
function revertTargetDeathSaves(target: AttackDamageTarget): void {
  if (!target.deathSaves) {
    return;
  }

  changeEntitySheet(target.entityId, (current) => {
    // Хиты цели читаются до возврата: запись листа уходит первой
    const deathSaves = revertRecordedDeathSaves(current, target);

    return deathSaves && current.entityType === 'actor'
      ? { ...current, system: { ...current.system, deathSaves } }
      : null;
  });
}

/**
 * «Отменить урон»: возвращает целям снятые хиты (и временные) и ставит на
 * место урона отметку об отмене — под ней появится «Нанести урон».
 *
 * Возврат считается от нынешних хитов цели: лечение и урон, случившиеся после
 * удара, остаются. Вместе с хитами снимается наложенное этим ударом: его
 * эффекты и состояния (по `id` — такое же состояние от другого источника
 * остаётся), провалы спасбросков от смерти и метка «Мёртв» у лежавшего на
 * нуле. Состояния от нуля хитов сервер снимает сам, когда хиты возвращаются.
 *
 * @param context - сообщение и дополнение с уроном
 */
export function revertAttackDamage(context: ChatFollowUpActionContext): void {
  const record = readActionableRecord(context, 'revert');

  if (!record) {
    return;
  }

  const lines: string[] = [ATTACK_DAMAGE_ACTION_LABELS.reverted];
  const rows: ChatBlockRow[] = [];

  for (const target of record.targets) {
    // Серия спасбросков — до хитов: ей нужны хиты цели, какими они были
    revertTargetDeathSaves(target);

    // Цель перечитывается в момент записи: копия из карточки давно устарела
    changeEntityCombatState(target.entityId, (current) => {
      const restored = revertRecordedDamage(current, target);

      lines.push(formatRestoredLine(current.name, current, restored));

      rows.push(
        buildRestoredRow(
          pickRowTargetName(current.name, record.targets.length),
          current,
          restored,
        ),
      );

      return restored;
    });
  }

  // Ни одной цели в мире уже нет — возвращать некому, карточка остаётся
  if (lines.length === 1) {
    refuse(ATTACK_DAMAGE_ACTION_LABELS.noTargetsTitle);

    return;
  }

  replaceFollowUp(context, {
    type: 'text',
    content: lines.join('\n'),
    blocks: [{ rows }],
    // Окраска не трогается: карточка броска атаки выделена и без урона
    kind: ATTACK_DAMAGE_REVERTED_FOLLOW_UP_KIND,
    // Последствия удара отменены и повтору не нужны: он считает их заново
    payload: serializeAttackDamageRecord({
      ...record,
      targets: record.targets.map(toBareTarget),
    }),
  });
}

/**
 * Цель записи без последствий удара: только то, по чему урон наносится заново.
 *
 * @param target - цель записи
 * @returns цель с хитами и вкладами частей
 */
function toBareTarget(target: AttackDamageTarget): AttackDamageTarget {
  return {
    entityId: target.entityId,
    name: target.name,
    hpLost: target.hpLost,
    tempLost: target.tempLost,
    contributions: target.contributions,
    // Полный урон цели остаётся: «Половина» и «Крит» над отменённым уроном
    // наносят его, как он был посчитан
    ...(target.totals ? { totals: target.totals } : {}),
  };
}

/**
 * Бросок урона для карточки: одна часть по одной цели показывается кубиками,
 * как первый бросок урона.
 *
 * @param record - запись об уроне
 * @param roll - новый бросок единственной части
 * @param reapplied - единственная цель
 * @returns дополнение-бросок
 */
function buildRollFollowUp(
  record: AttackDamageRecord,
  roll: DiceRollData,
  reapplied: ReappliedTarget,
): Pick<ChatFollowUpInput, 'type' | 'content' | 'rollData'> {
  const [part] = record.parts;

  const applyResult = {
    actorName: reapplied.target.name,
    hpBefore: reapplied.applied.hpBefore,
    hpAfter: reapplied.applied.hpAfter,
    tempAbsorbed: reapplied.applied.tempLost,
    defenseOutcome: reapplied.applied.outcome,
    hpChange: reapplied.applied.hpChange,
  };

  return {
    type: 'roll',
    content: part?.formula ?? roll.formula,
    rollData: {
      ...roll,
      label: buildDamageLabel(record.label, applyResult, part?.types[0]),
      block: buildDamageChatBlock(applyResult, part?.types[0]),
    },
  };
}

/**
 * Сводка урона для карточки: несколько частей или целей — строками, в том же
 * виде, что сводка первого разбора (строка на часть и цель: вид урона и
 * снятые хиты; имя цели — когда целей несколько).
 *
 * @param record - запись об уроне
 * @param rolls - новые броски частей по порядку
 * @param reapplied - цели, получившие урон
 * @returns дополнение-текст
 */
function buildSummaryFollowUp(
  record: AttackDamageRecord,
  rolls: readonly DiceRollData[],
  reapplied: readonly ReappliedTarget[],
): Pick<ChatFollowUpInput, 'type' | 'content' | 'blocks'> {
  const lines: string[] = [record.label];
  const blocks: ChatBlock[] = [];

  /**
   * Последняя строка каждой цели: в неё встанут хиты цели до и после — урон
   * разложен по частям, а хиты у цели одни
   */
  const hpRowByEntity = new Map<string, HpChangeRowPlacement>();

  /**
   * Имя цели для строки сводки: только когда целей несколько — единственную
   * называет шапка карточки атаки.
   *
   * @param targetName - имя цели строки
   * @returns поле `target` строки или пусто
   */
  function rowTarget(targetName: string): Pick<ChatBlockRow, 'target'> {
    const target = pickRowTargetName(targetName, reapplied.length);

    return target ? { target } : {};
  }

  record.parts.forEach((part, partIndex) => {
    const roll = rolls[partIndex];

    const hits = reapplied.flatMap(({ target, applied }) =>
      applied.parts
        .filter((appliedPart) => appliedPart.part === partIndex)
        .map((appliedPart) => ({
          name: target.name,
          entityId: target.entityId,
          hpChange: applied.hpChange,
          appliedPart,
        })),
    );

    if (!roll || hits.length === 0) {
      return;
    }

    const values = roll.dice.flatMap((group) => group.values);
    const breakdown = values.length > 0 ? `[${values.join(', ')}] = ` : '';
    const isDeduction = roll.total < 0;

    lines.push(
      isDeduction
        ? DAMAGE_DEDUCTION_LABELS.header
        : getPartKindLabel({
            isHealing: false,
            type: part.types[0],
            types: part.types,
          }),
    );

    const rollDetail = `${formatDiceFormula(part.formula)} ${breakdown}${roll.total}`;

    hits.forEach((hit, rowIndex) => {
      hpRowByEntity.set(hit.entityId, {
        blockIndex: blocks.length,
        rowIndex,
        change: hit.hpChange,
      });
    });

    blocks.push({
      rows: hits.map(({ name, appliedPart }) => ({
        ...(isDeduction
          ? {
              icon: DAMAGE_DEDUCTION_LABELS.icon,
              name: DAMAGE_DEDUCTION_LABELS.header,
            }
          : buildDamageChatRowLabel({ types: part.types })),
        ...rowTarget(name),
        ...(isDeduction
          ? { value: `${appliedPart.applied}` }
          : formatHpChangeValue(appliedPart.applied)),
        detail: joinChatDetail([
          rollDetail,
          formatDamageDefenseNote(appliedPart.outcome),
        ]),
      })),
    });

    for (const { name, appliedPart } of hits) {
      const amount = isDeduction
        ? `${appliedPart.applied}`
        : `-${appliedPart.applied} HP${formatDamageDefenseSuffix(appliedPart.outcome)}`;

      lines.push(
        `→ ${name}: ${formatDiceFormula(part.formula)} ${breakdown}${amount}`,
      );
    }
  });

  return {
    type: 'text',
    content: lines.join('\n'),
    blocks: attachHpChangeDetails(blocks, [...hpRowByEntity.values()]),
  };
}

/**
 * Содержимое карточки для записи без бросков по отдельности (карточка старой
 * версии системы): одна часть по одной цели — кубиками, иначе — сводкой.
 *
 * @param record - запись об уроне
 * @param rolls - новые броски частей по порядку
 * @param reapplied - цели, получившие урон
 * @param onlyRoll - первый бросок
 * @param onlyTarget - первая цель
 * @returns содержимое дополнения
 */
function buildLegacyFollowUp(
  record: AttackDamageRecord,
  rolls: readonly DiceRollData[],
  reapplied: readonly ReappliedTarget[],
  onlyRoll: DiceRollData,
  onlyTarget: ReappliedTarget,
): Pick<ChatFollowUpInput, 'type' | 'content' | 'rollData' | 'blocks'> {
  return rolls.length === 1 && reapplied.length === 1
    ? buildRollFollowUp(record, onlyRoll, onlyTarget)
    : buildSummaryFollowUp(record, rolls, reapplied);
}

/**
 * Полный урон цели для записи — в том режиме, в котором он посчитан.
 *
 * @param record - запись об уроне: по ней режим крита
 * @param total - полный урон цели после защит
 * @returns урон по режимам с одним заполненным
 */
function buildModeTotals(
  record: Pick<AttackDamageRecord, 'critical'>,
  total: number,
): NonNullable<AttackDamageTarget['totals']> {
  return record.critical ? { critical: total } : { normal: total };
}

/**
 * Плашка режима в строке урона: «Крит», «½» или обе.
 *
 * @param modes - режимы урона
 * @returns плашка или `undefined`, если урон обычный
 */
function buildModeBadge(modes: AttackDamageModes): ChatBadge | undefined {
  const labels = [
    ...(modes.critical ? [ATTACK_DAMAGE_ACTION_LABELS.criticalBadge] : []),
    ...(modes.half ? [ATTACK_DAMAGE_ACTION_LABELS.halfBadge] : []),
  ];

  return labels.length > 0
    ? {
        label: labels.join(ATTACK_DAMAGE_ACTION_LABELS.badgeSeparator),
        accent: 'primary',
      }
    : undefined;
}

/**
 * Пометка режима для текстовой строки карточки: « (крит, половина)».
 *
 * @param modes - режимы урона
 * @returns пометка или пустая строка
 */
function formatModeSuffix(modes: AttackDamageModes): string {
  const labels = [
    ...(modes.critical ? [ATTACK_DAMAGE_ACTION_LABELS.criticalSuffix] : []),
    ...(modes.half ? [ATTACK_DAMAGE_ACTION_LABELS.halfSuffix] : []),
  ];

  return labels.length > 0
    ? `${ATTACK_DAMAGE_ACTION_LABELS.modeSuffixOpen}${labels.join(ATTACK_DAMAGE_ACTION_LABELS.modeSuffixSeparator)}${ATTACK_DAMAGE_ACTION_LABELS.modeSuffixClose}`
    : '';
}

/**
 * Бросок одной строкой: «2к6 + 3 [4, 2] = 9», а без выпавших костей —
 * «2к6 + 3 = 9».
 *
 * @param formula - брошенная формула
 * @param dice - выпавшие кости
 * @param total - итог броска
 * @returns строка подробностей
 */
function formatRollLine(
  formula: string,
  dice: readonly number[] | undefined,
  total: number,
): string {
  const breakdown = dice && dice.length > 0 ? ` [${dice.join(', ')}]` : '';

  return `${formatDiceFormula(formula)}${breakdown} = ${total}`;
}

/**
 * Подробности одной части урона цели: бросок без крита, кости крита, что
 * дошло до цели после доли спасброска и защит и какая защита сработала.
 *
 * @param record - запись об уроне
 * @param applied - итог части для цели
 * @returns строка подробностей или `undefined`, если бросок части не записан
 */
function formatPartDetail(
  record: AttackDamageRecord,
  applied: AppliedDamagePart,
): string | undefined {
  const roll = record.parts[applied.part]?.roll;

  if (!roll) {
    return undefined;
  }

  const critTotal = record.critical ? roll.critTotal : undefined;

  const critLine =
    roll.critFormula !== undefined && critTotal !== undefined
      ? `${ATTACK_DAMAGE_ACTION_LABELS.critDetail}${formatRollLine(roll.critFormula, roll.critDice, critTotal)}`
      : undefined;

  const line = joinChatDetail([
    formatRollLine(roll.formula, roll.dice, roll.total),
    critLine,
    formatDamageDefenseNote(applied.outcome),
  ]);

  // Доля спасброска и защиты цели изменили урон части — называется итог
  return line && applied.applied !== roll.total + (critTotal ?? 0)
    ? `${line}${ATTACK_DAMAGE_ACTION_LABELS.detailArrow}${applied.applied}`
    : line;
}

/**
 * Строка блока об уроне одной цели в режимах записи: вид урона, плашка режима
 * («Крит», «½») и урон цели, а в подробностях — бросок каждой части, кости
 * крита, половина и хиты цели до и после.
 *
 * @param record - запись об уроне с новыми режимами
 * @param view - урон цели
 * @returns строка блока карточки чата
 */
function buildModeRow(
  record: AttackDamageRecord,
  view: DamageModeView,
): ChatBlockRow {
  const modes = readDamageModes(record);
  const badge = buildModeBadge(modes);

  // Вид урона называют части, которые урон нанесли: вычет из урона — не вид
  const types = [
    ...new Set(
      view.parts.flatMap((applied) =>
        applied.applied > 0 ? (record.parts[applied.part]?.types ?? []) : [],
      ),
    ),
  ];

  const rolledTotal = Math.max(
    0,
    view.parts.reduce((sum, applied) => sum + applied.applied, 0),
  );

  const details = [
    ...view.parts.map((applied) => formatPartDetail(record, applied)),
    // Урон, которого нет в частях записи: доп. урон наложенных эффектов
    view.total > rolledTotal
      ? `${ATTACK_DAMAGE_ACTION_LABELS.extraDetail}${view.total - rolledTotal}`
      : undefined,
    modes.half
      ? `${ATTACK_DAMAGE_ACTION_LABELS.halfDetail}${view.total}${ATTACK_DAMAGE_ACTION_LABELS.detailArrow}${view.damage}`
      : undefined,
  ].flatMap((line) => (line ? [line] : []));

  return withHpChangeDetail(
    {
      ...buildDamageChatRowLabel(
        { types },
        pickRowTargetName(view.target.name, record.targets.length),
      ),
      ...(badge ? { badge } : {}),
      ...formatHpChangeValue(view.damage),
      ...(details.length > 0 ? { detail: details.join('\n') } : {}),
    },
    view.hpChange,
  );
}

/**
 * Урон карточки в режимах записи: строка на цель — урон цели с плашкой
 * режима, подробности броска свёрнуты в строке.
 *
 * @param record - запись об уроне с новыми режимами
 * @param views - урон целей
 * @returns дополнение-текст
 */
function buildModesFollowUp(
  record: AttackDamageRecord,
  views: readonly DamageModeView[],
): Pick<ChatFollowUpInput, 'type' | 'content' | 'blocks'> {
  const suffix = formatModeSuffix(readDamageModes(record));

  return {
    type: 'text',
    content: [
      record.label,
      ...views.map(
        (view) => `→ ${view.target.name}: -${view.damage} HP${suffix}`,
      ),
    ].join('\n'),
    blocks: [{ rows: views.map((view) => buildModeRow(record, view)) }],
  };
}

/**
 * Запись дополнения для вида кнопки. Кнопки рисуются при каждой отрисовке
 * ленты: негодная запись — просто нет записи, без отказа.
 *
 * @param followUp - дополнение, под которым стоит кнопка
 * @returns запись с бросками по отдельности или `null`
 */
function readModesRecord(
  followUp: ChatMessageFollowUp,
): AttackDamageRecord | null {
  const record = parseAttackDamageRecord(followUp.payload);

  return record && supportsDamageModes(record) ? record : null;
}

/**
 * Вид кнопки «Отменить урон»: в ряду с переключателями — короткая подпись
 * и полный текст подсказкой. Под карточкой без режимов кнопка одна и
 * подписана целиком.
 *
 * @param followUp - дополнение с уроном
 * @returns вид кнопки или `null` — кнопка как зарегистрирована
 */
export function resolveRevertActionView(
  followUp: ChatMessageFollowUp,
): ChatFollowUpActionView | null {
  if (isActionHidden('revert', followUp)) {
    return { hidden: true };
  }

  return readModesRecord(followUp)
    ? {
        label: ATTACK_DAMAGE_ACTION_LABELS.revertShort,
        tooltip: ATTACK_DAMAGE_ACTION_LABELS.revertTooltip,
      }
    : null;
}

/**
 * Вид кнопки «Нанести урон» — как у {@link resolveRevertActionView}.
 *
 * @param followUp - дополнение с отметкой об отмене
 * @returns вид кнопки или `null` — кнопка как зарегистрирована
 */
export function resolveReapplyActionView(
  followUp: ChatMessageFollowUp,
): ChatFollowUpActionView | null {
  if (isActionHidden('reapply', followUp)) {
    return { hidden: true };
  }

  return readModesRecord(followUp)
    ? {
        label: ATTACK_DAMAGE_ACTION_LABELS.reapplyShort,
        tooltip: ATTACK_DAMAGE_ACTION_LABELS.reapplyTooltip,
      }
    : null;
}

/**
 * Вид переключателя половины урона: «Половина», а когда урон уже идёт
 * половиной — «Полный». Под карточкой без записанного броска кнопки нет.
 *
 * @param followUp - дополнение с уроном или отметкой об отмене
 * @returns вид кнопки или `null` — кнопка как зарегистрирована
 */
export function resolveHalfActionView(
  followUp: ChatMessageFollowUp,
): ChatFollowUpActionView | null {
  const record = readModesRecord(followUp);

  if (!record || isActionHidden('modes', followUp)) {
    return { hidden: true };
  }

  return record.half
    ? {
        label: ATTACK_DAMAGE_ACTION_LABELS.full,
        icon: ATTACK_DAMAGE_ACTION_LABELS.fullIcon,
        tooltip: ATTACK_DAMAGE_ACTION_LABELS.fullTooltip,
      }
    : null;
}

/**
 * Вид переключателя крита: «Крит», а когда к урону уже идут кости крита — «Не
 * крит». Под карточкой без записанного броска и под уроном без костей кнопки
 * нет.
 *
 * @param followUp - дополнение с уроном или отметкой об отмене
 * @returns вид кнопки или `null` — кнопка как зарегистрирована
 */
export function resolveCriticalActionView(
  followUp: ChatMessageFollowUp,
): ChatFollowUpActionView | null {
  const record = readModesRecord(followUp);

  if (!record || !hasCritDice(record) || isActionHidden('modes', followUp)) {
    return { hidden: true };
  }

  return record.critical
    ? {
        label: ATTACK_DAMAGE_ACTION_LABELS.notCritical,
        icon: ATTACK_DAMAGE_ACTION_LABELS.notCriticalIcon,
        tooltip: ATTACK_DAMAGE_ACTION_LABELS.notCriticalTooltip,
      }
    : null;
}

/**
 * Бросает кости крита для частей, у которых они ещё не брошены: попадание
 * критом не было. Уже брошенные остаются — повторное «Крит» после «Не крит»
 * возвращает прежние кости, а не бросает новые.
 *
 * @param record - запись об уроне
 * @returns запись с костями крита или `null` — отказ уже показан
 */
function rollMissingCritDice(
  record: AttackDamageRecord,
): AttackDamageRecord | null {
  if (!hasCritDice(record)) {
    refuse(ATTACK_DAMAGE_ACTION_LABELS.noCritDiceTitle);

    return null;
  }

  const unrolled = listUnrolledCritDice(record);

  if (unrolled.length === 0) {
    return record;
  }

  if (useWorldStore().currentUserRestrictions.isDiceBanned) {
    refuse(ATTACK_DAMAGE_ACTION_LABELS.diceBannedTitle);

    return null;
  }

  const diceRollerStore = useDiceRollerStore();

  return withCritDiceRolls(
    record,
    unrolled.map(({ part, formula }) => {
      const roll = diceRollerStore.parseAndRoll(toRollerFormula(formula));

      return { part, total: roll.total, values: listRolledDiceValues(roll) };
    }),
  );
}

/**
 * Переводит урон карточки в другие режимы: над нанесённым уроном правит хиты
 * целей на разницу, над отменённым — наносит записанный бросок заново.
 * Карточка получает урон в новых режимах и запись с ними.
 *
 * @param context - сообщение и дополнение, под которым нажали кнопку
 * @param pickNext - новые режимы по нынешним
 */
function changeAttackDamageModes(
  context: ChatFollowUpActionContext,
  pickNext: (modes: AttackDamageModes) => AttackDamageModes,
): void {
  const storedRecord = readActionableRecord(context, 'modes');

  if (!storedRecord) {
    return;
  }

  if (!supportsDamageModes(storedRecord)) {
    refuse(
      ATTACK_DAMAGE_ACTION_LABELS.modesUnavailableTitle,
      ATTACK_DAMAGE_ACTION_LABELS.modesUnavailableDescription,
    );

    return;
  }

  const next = pickNext(readDamageModes(storedRecord));

  // Кости крита — до хитов: отказ в броске не должен оставить урон
  // наполовину изменённым
  const record = next.critical
    ? rollMissingCritDice(storedRecord)
    : storedRecord;

  if (!record) {
    return;
  }

  const isApplied = context.followUp.kind === ATTACK_DAMAGE_FOLLOW_UP_KIND;
  const changes: ChangedDamageModes[] = [];

  for (const target of record.targets) {
    // Цель перечитывается в момент записи: копия из карточки давно устарела
    changeEntityCombatState(target.entityId, (current) => {
      const change = changeRecordedDamageModes(
        current,
        record,
        target,
        next,
        isApplied,
      );

      changes.push(change);

      return change.updatedEntity;
    });
  }

  if (changes.length === 0) {
    refuse(ATTACK_DAMAGE_ACTION_LABELS.noTargetsTitle);

    return;
  }

  const nextRecord: AttackDamageRecord = {
    ...record,
    half: next.half,
    critical: next.critical,
    targets: changes.map((change) => change.target),
  };

  replaceFollowUp(context, {
    ...buildAttackDamageChatOptions(nextRecord),
    ...buildModesFollowUp(nextRecord, changes),
  });
}

/**
 * «Половина» / «Полный урон»: цели достаётся половина записанного урона (с
 * округлением вниз, после её защит) либо снова весь. Бросок не повторяется.
 *
 * @param context - сообщение и дополнение с уроном или отметкой об отмене
 */
export function toggleAttackDamageHalf(
  context: ChatFollowUpActionContext,
): void {
  changeAttackDamageModes(context, (modes) => ({
    ...modes,
    half: !modes.half,
  }));
}

/**
 * «Крит» / «Не крит»: к записанному урону добавляются кости крита (кости
 * урона, брошенные ещё раз, без модификаторов) либо убираются ровно они.
 *
 * @param context - сообщение и дополнение с уроном или отметкой об отмене
 */
export function toggleAttackDamageCritical(
  context: ChatFollowUpActionContext,
): void {
  changeAttackDamageModes(context, (modes) => ({
    ...modes,
    critical: !modes.critical,
  }));
}

/**
 * «Нанести урон»: перебрасывает только кости урона отменённой атаки и наносит
 * его тем же целям. Броска попадания нет: попадание, режимы урона (крит —
 * кости бросаются удвоенными, половина) и доля урона по спасброску остаются
 * прежними; защиты цели берутся нынешние. Новый урон встаёт в карточку на место отметки об отмене.
 *
 * Наносятся только хиты. Эффекты, которые первый удар накладывал вместе с
 * уроном, заново не накладываются: им нужен свой спасбросок цели или выбор
 * игрока, а повтор их не спрашивает. Последствия нуля хитов (спасброски от
 * смерти, смерть, проверка концентрации) сервер считает сам, как при обычном
 * уроне.
 *
 * @param context - сообщение и дополнение с отметкой об отмене
 */
export function reapplyAttackDamage(context: ChatFollowUpActionContext): void {
  const record = readActionableRecord(context, 'reapply');

  if (!record) {
    return;
  }

  // До броска: запрет кубиков не дал бы показать урон, а хиты уже ушли бы
  if (useWorldStore().currentUserRestrictions.isDiceBanned) {
    refuse(ATTACK_DAMAGE_ACTION_LABELS.diceBannedTitle);

    return;
  }

  const diceRollerStore = useDiceRollerStore();
  const hasModes = supportsDamageModes(record);

  const rerolls = record.parts.map((part) => {
    const plan = planDamageReroll(record, part);

    // Вычет («−1к8 к урону») роллер читает только с нулём впереди
    const roll = diceRollerStore.parseAndRoll(toRollerFormula(plan.formula));

    return {
      roll,
      part: withRerolledDamage(part, plan, {
        total: roll.total,
        values: listRolledDiceValues(roll),
      }),
    };
  });

  const rolls = rerolls.map((reroll) => reroll.roll);
  const rolledAmounts = rolls.map((roll) => roll.total);

  // Запись с новыми бросками: по ней «Половина» и «Крит» считают дальше
  const rerolledRecord: AttackDamageRecord = {
    ...record,
    parts: rerolls.map((reroll) => reroll.part),
  };

  const reapplied: ReappliedTarget[] = [];

  for (const target of record.targets) {
    changeEntityCombatState(target.entityId, (current) => {
      const applied = applyRecordedDamage(
        current,
        rerolledRecord,
        target,
        rolledAmounts,
      );

      reapplied.push({
        target: {
          ...toBareTarget(target),
          name: current.name,
          hpLost: applied.hpBefore - applied.hpAfter,
          tempLost: applied.tempLost,
          // Полный урон нового броска: прежний к новым костям не относится
          ...(hasModes
            ? { totals: buildModeTotals(record, applied.total) }
            : {}),
          // Следующая отмена вернёт и то, что этот удар сделал с серией
          // спасбросков от смерти
          ...captureHitConsequences(current, applied.updatedEntity),
        },
        applied,
      });

      return applied.updatedEntity;
    });
  }

  const [onlyRoll] = rolls;
  const [onlyTarget] = reapplied;

  if (!onlyRoll || !onlyTarget) {
    refuse(ATTACK_DAMAGE_ACTION_LABELS.noTargetsTitle);

    return;
  }

  // Новая запись — с новыми снятыми хитами: следующая отмена вернёт их
  const nextRecord: AttackDamageRecord = {
    ...rerolledRecord,
    targets: reapplied.map((entry) => entry.target),
  };

  const content = hasModes
    ? buildModesFollowUp(
        nextRecord,
        reapplied.map(({ target, applied }) => ({
          target,
          total: applied.total,
          damage: applied.damage,
          parts: applied.parts,
          hpChange: applied.hpChange,
        })),
      )
    : buildLegacyFollowUp(record, rolls, reapplied, onlyRoll, onlyTarget);

  // Содержимое идёт после параметров урона: блоки сводки остаются его
  replaceFollowUp(context, {
    ...buildAttackDamageChatOptions(nextRecord),
    ...content,
  });
}
