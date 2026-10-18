import { computed, ref } from 'vue';

/** Действие контекстного меню */
export type ContextMenuAction =
  'copy' | 'edit' | 'delete' | 'add-to-compendium' | 'share' | 'cast';

/** Пропсы, необходимые для контекстного меню */
export interface ContextMenuProps {
  showCopy?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  /**
   * Показать «В компендиум». Флаг ставит ядро в «Мастерской» мастеру, когда
   * запись можно положить в компендиум мира.
   */
  showAddToCompendium?: boolean;
  /**
   * Обработчик «Поделиться в чат». Ядро передаёт его в «Мастерской» тем типам,
   * которым система разрешила `allowShareAttr`; есть обработчик — есть пункт.
   */
  onShare?: () => void;
}

/**
 * Composable для управления контекстным меню элемента списка.
 *
 * Инкапсулирует состояние открытия, позицию и действия меню.
 * Используется в WeaponListItem, ToolListItem, EquipmentListItem,
 * FeatListItem, SpellListItem, BackgroundListItem.
 *
 * @param props - реактивный источник пропсов с флагами видимости пунктов
 * @param emit - функция эмита событий компонента (Vue defineEmits)
 * @param onAddToCompendium - что делать по пункту «В компендиум»; у строк,
 *   которые этот пункт не показывают, не передаётся
 */
export function useContextMenu(
  props: ContextMenuProps,
  emit: {
    (event: 'copy'): void;
    (event: 'edit'): void;
    (event: 'delete'): void;
  },
  onAddToCompendium?: () => void,
) {
  const isMenuOpen = ref(false);
  const menuX = ref(0);
  const menuY = ref(0);

  /** Есть ли кому отправить запись в чат */
  const canShare = computed(() => props.onShare !== undefined);

  /** Есть ли пункты для контекстного меню */
  const hasContextMenu = computed(
    () =>
      props.showCopy
      || props.showEdit
      || props.showDelete
      || props.showAddToCompendium
      || canShare.value,
  );

  /**
   * Показывает контекстное меню по координатам клика.
   *
   * @param event - событие contextmenu
   */
  function openContextMenu(event: MouseEvent): void {
    if (!hasContextMenu.value) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    menuX.value = event.clientX;
    menuY.value = event.clientY;
    isMenuOpen.value = true;
  }

  /**
   * Обработчик выбора пункта меню.
   *
   * @param action - выбранный пункт меню
   */
  function handleAction(action: ContextMenuAction): void {
    isMenuOpen.value = false;

    if (action === 'copy') {
      emit('copy');
    } else if (action === 'edit') {
      emit('edit');
    } else if (action === 'add-to-compendium') {
      onAddToCompendium?.();
    } else if (action === 'share') {
      props.onShare?.();
    } else if (action === 'delete') {
      emit('delete');
    }
  }

  /** Закрывает меню */
  function closeMenu(): void {
    isMenuOpen.value = false;
  }

  return {
    isMenuOpen,
    menuX,
    menuY,
    hasContextMenu,
    canShare,
    openContextMenu,
    handleAction,
    closeMenu,
  };
}
