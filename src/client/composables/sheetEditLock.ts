/**
 * Лист в режиме правки не действует. Ждут, пока правку сохранят или отменят:
 *
 * - каст и кнопка урона заклинания персонажа, заклинание существа;
 * - удар и урон оружием, действие существа;
 * - «Применить» у умения и «Использовать» у предмета;
 * - переключатели умения и предмета;
 * - «Вырваться» (за себя и помощью соседу), кнопка «При действии»;
 * - «Прервать концентрацию»;
 * - отдых (кнопка и «Применить» окна отдыха);
 * - бросок спасброска от смерти;
 * - приём предмета, переданного с другого листа.
 *
 * В режиме правки лист держит черновик и мир в него не подтягивает. Действие
 * тратит ресурсы и накладывает эффекты через мир — черновик этого не видит,
 * а строки листа (заряды, предметы) показывают уже не то, что в мире. Поэтому
 * правило одно на все входы действия — лист, быстрые панели, горячую панель:
 * пока лист ЭТОЙ сущности у этого пользователя в правке, действие не
 * выполняется и объясняет почему.
 *
 * Приём один: вход действия НАЧИНАЕТСЯ с `refuseWhileSheetEditing` — первой
 * инструкцией, до чтения сущности из мира, и id берётся из аргументов входа,
 * а не из прочитанной сущности. У нового, ещё не сохранённого листа сущности
 * в мире нет: вход, который сначала искал её, выходил молча и до проверки не
 * доходил. Проверка стоит во входах действий, а не в кнопках: вход у листа и
 * панели один. Перечень входов и место проверки держит тест
 * `tests/sheetEditLock.test.mjs` — новый вход без неё его роняет.
 *
 * Правкой НЕ останавливается то, что меняет сам черновик: поля листа, хиты,
 * ячейки и счётчики, снаряжение, владение спасброском, переключатель эффекта
 * и плитка состояния на вкладке эффектов, редактор действия существа — всё
 * это уходит в мир одним «Сохранить». И броски проверок, спасбросков и
 * инициативы: они ничего не тратят и не пишут.
 *
 * Чужие правки мира за время правки (урон от другого клиента, срабатывания
 * сервера) запрет не ловит — их при «Сохранить» сливает с черновиком
 * `mergeEntityDraft`.
 */

import { onScopeDispose, watch } from 'vue';

import { useSystemToastStore } from '../stores/systemToastStore';
import { SHEET_EDIT_LOCK_LABELS } from '../ui/actor/constants';

/** Сколько открытых листов сущности сейчас в режиме правки — по её id */
const editingSheetCounts = new Map<string, number>();

/**
 * Отмечает, что лист сущности вошёл в режим правки.
 *
 * @param entityId - сущность
 */
function holdSheetEdit(entityId: string): void {
  editingSheetCounts.set(entityId, (editingSheetCounts.get(entityId) ?? 0) + 1);
}

/**
 * Отмечает, что лист сущности вышел из режима правки.
 *
 * @param entityId - сущность
 */
function releaseSheetEdit(entityId: string): void {
  const left = (editingSheetCounts.get(entityId) ?? 0) - 1;

  if (left > 0) {
    editingSheetCounts.set(entityId, left);
  } else {
    editingSheetCounts.delete(entityId);
  }
}

/**
 * В правке ли сейчас лист сущности у этого пользователя.
 *
 * @param entityId - сущность
 * @returns `true`, если хоть один её открытый лист в режиме правки
 */
export function isSheetEditing(entityId: string | null | undefined): boolean {
  return !!entityId && editingSheetCounts.has(entityId);
}

/**
 * Останавливает действие сущности, чей лист в режиме правки, и говорит
 * почему. Зовётся первой инструкцией входа действия — до чтения мира, окон и
 * вопросов: отказ ничего не тратит и ничего не пишет.
 *
 * @param entityId - кто действует
 * @returns `true`, если действие надо остановить
 */
export function refuseWhileSheetEditing(
  entityId: string | null | undefined,
): boolean {
  if (!isSheetEditing(entityId)) {
    return false;
  }

  useSystemToastStore().add({
    title: SHEET_EDIT_LOCK_LABELS.title,
    description: SHEET_EDIT_LOCK_LABELS.description,
    color: 'warning',
  });

  return true;
}

/**
 * Держит отметку «лист в правке», пока лист сущности в режиме правки.
 * Закрытый лист отметку снимает: размонтированный лист ничего не правит.
 *
 * Сущность называется по id черновика листа — тому же, с которым действуют его
 * вкладки и блоки. У нового, ещё не сохранённого листа id мира нет: отметка на
 * id мира такой лист не закрывала, и его действия молча ничего не делали
 * (сущности в мире ещё нет), вместо того чтобы попросить сохранить лист.
 *
 * @param readEntityId - сущность, которую показывает лист; нет — черновик ещё
 *   не собран
 * @param isEditMode - в режиме ли правки лист
 */
export function useSheetEditLock(
  readEntityId: () => string | null | undefined,
  isEditMode: () => boolean,
): void {
  let heldId: string | null = null;

  /**
   * Приводит отметку к состоянию листа.
   *
   * @param nextId - чья отметка нужна сейчас; `null` — ничья
   */
  function hold(nextId: string | null): void {
    if (nextId === heldId) {
      return;
    }

    if (heldId !== null) {
      releaseSheetEdit(heldId);
    }

    if (nextId !== null) {
      holdSheetEdit(nextId);
    }

    heldId = nextId;
  }

  // Сразу, а не перед отрисовкой: щелчок по действию в том же тике, что и
  // вход в правку, уже должен видеть отметку
  watch(() => (isEditMode() ? (readEntityId() ?? null) : null), hold, {
    immediate: true,
    flush: 'sync',
  });

  onScopeDispose(() => hold(null));
}
