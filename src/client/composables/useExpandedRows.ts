import { ref } from 'vue';

/** Раскрытые строки списка и действия над ними. */
interface ExpandedRows {
  /** Раскрыта ли строка. */
  isExpanded: (key: string) => boolean;
  /** Раскрывает строку: добавленную запись сразу дают заполнить. */
  expand: (key: string) => void;
  /** Раскрывает свёрнутую строку и сворачивает раскрытую. */
  toggle: (key: string) => void;
  /** Забывает строку — её удалили из списка. */
  drop: (key: string) => void;
  /** Сворачивает все строки — список открыли заново. */
  clear: () => void;
}

/**
 * Раскрытые строки редактора-списка.
 *
 * Длинные списки формы — умения класса, особенности вида, варианты умения —
 * показываются свёрнутыми строками: развёрнутые все разом они заслоняют друг
 * друга. Так же раскрываются подвиды под видом в компендиуме и окне выбора. Состояние у всех троих одинаковое, а подписи и значки свёртки свои,
 * поэтому здесь только набор раскрытых ключей.
 *
 * Ключ строки выбирает вызывающий: у умения это его ключ, у варианта —
 * `uid` записи формы.
 *
 * @returns действия над набором раскрытых строк
 */
export function useExpandedRows(): ExpandedRows {
  const expandedKeys = ref<Set<string>>(new Set());

  function isExpanded(key: string): boolean {
    return expandedKeys.value.has(key);
  }

  function expand(key: string): void {
    expandedKeys.value.add(key);
  }

  function toggle(key: string): void {
    if (expandedKeys.value.has(key)) {
      expandedKeys.value.delete(key);
    } else {
      expandedKeys.value.add(key);
    }
  }

  function drop(key: string): void {
    expandedKeys.value.delete(key);
  }

  function clear(): void {
    expandedKeys.value.clear();
  }

  return { isExpanded, expand, toggle, drop, clear };
}
