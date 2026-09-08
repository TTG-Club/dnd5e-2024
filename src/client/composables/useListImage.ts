/**
 * Картинка строки списка: грузим по очереди и показываем только готовую.
 *
 * Картинки существ компендиума лежат не в мире, а на сайте
 * (`https://new.ttg.club/s3/bestiary/…`), и тянет их из интернета сам клиент.
 * Сайт ограничивает частоту: залп из полутора сотен запросов (а браузер делает
 * ровно залп, когда список пролистывают быстро) наполовину получает отказ
 * «слишком часто», и отказавшие строки остаются пустыми навсегда — при том, что
 * картинка у существа есть и на сцене токен рисуется.
 *
 * Поэтому загрузкой распоряжаемся сами:
 * - строка просит картинку, только когда доехала до экрана (общий наблюдатель);
 * - одновременно грузится не больше {@link MAX_PARALLEL_LOADS} — залпа нет;
 * - очередь разбирается ПО МЕСТУ НА ЭКРАНЕ, сверху вниз: сначала то, что видно
 *   сейчас, и только потом запас за краем экрана. Иначе картинки проявлялись в
 *   случайном порядке, а видимая строка ждала, пока догрузится соседняя за
 *   краем;
 * - строка, улетевшая с экрана, из очереди выбрасывается, а начатую для неё
 *   загрузку мы обрываем: держать ею место, пока ждёт видимая строка, незачем;
 * - отказ не приговор: попытка повторяется с растущей паузой;
 * - в тег `img` ссылка попадает уже загруженной, поэтому «сломанный» значок
 *   браузера не мелькает в принципе — до готовности в строке стоит значок.
 */

import type { ComputedRef, ShallowRef } from 'vue';

import { computed, onScopeDispose, ref, watch } from 'vue';

/** Сколько картинок списка грузится одновременно */
const MAX_PARALLEL_LOADS = 4;

/** Паузы перед повторными попытками: сайту нужно время остыть */
const RETRY_DELAYS_MS = [1000, 3000, 8000, 20_000];

/** Запас вокруг экрана: картинка успевает подъехать до того, как её увидят */
const VISIBILITY_MARGIN = '300px';

/**
 * Очерёдность строки за краем экрана: после любой видимой.
 *
 * Слагаемое к расстоянию до края — не «магическое число», а разделитель двух
 * групп: любая видимая строка получает очерёдность меньше этой границы, любая
 * заэкранная — больше, и внутри своей группы они по-прежнему сравниваются между
 * собой по расстоянию.
 */
const OFFSCREEN_PRIORITY_BASE = 1_000_000;

/** Просьба загрузить картинку, ждущая своей очереди */
interface QueuedLoad {
  /** Ссылка на картинку */
  url: string;
  /** Номер попытки: 0 — первая */
  attempt: number;
  /** Картинка всё ещё нужна: строка на экране и ссылка у неё та же */
  wanted: () => boolean;
  /** Очерёдность: чем меньше, тем раньше грузим (см. {@link getRowPriority}) */
  priority: () => number;
  /** Итог загрузки для строки */
  settle: (loaded: boolean) => void;
}

/** Загрузка, которая идёт прямо сейчас */
interface RunningLoad {
  /** Чью картинку грузим */
  task: QueuedLoad;
  /** Обрывает загрузку и освобождает место в очереди */
  cancel: () => void;
}

/** Ссылки, уже загруженные в этом сеансе: второй раз в очередь не встают */
const loadedUrls = new Set<string>();

/** Просьбы, ждущие своей очереди; порядок задаёт {@link takeNextTask} */
const queue: QueuedLoad[] = [];

/** Загрузки, идущие прямо сейчас */
const running = new Set<RunningLoad>();

/**
 * Очерёдность строки по её месту на экране.
 *
 * Видимые строки идут сверху вниз — так картинки проявляются в том же порядке,
 * в каком их читают. Строки запаса за краем экрана становятся в очередь после
 * всех видимых, ближайшие к краю — первыми.
 *
 * @param element - кружок строки в вёрстке
 * @returns очерёдность: чем меньше, тем раньше грузим
 */
function getRowPriority(element: HTMLElement | null): number {
  if (!element) {
    return Number.POSITIVE_INFINITY;
  }

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight;

  // Строка ниже экрана: чем ближе к нижнему краю, тем раньше
  if (rect.top >= viewportHeight) {
    return OFFSCREEN_PRIORITY_BASE + (rect.top - viewportHeight);
  }

  // Строка выше экрана: чем ближе к верхнему краю, тем раньше
  if (rect.bottom <= 0) {
    return OFFSCREEN_PRIORITY_BASE - rect.bottom;
  }

  return Math.max(rect.top, 0);
}

/**
 * Достаёт из очереди самую нужную просьбу, попутно выбрасывая отпавшие.
 *
 * @returns просьба или `undefined`, если очередь пуста
 */
function takeNextTask(): QueuedLoad | undefined {
  let bestIndex = -1;
  let bestPriority = Number.POSITIVE_INFINITY;

  // С конца: удалять по индексу можно, не сбивая ещё не просмотренные
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const task = queue[index];

    if (!task?.wanted()) {
      queue.splice(index, 1);
      // Строке говорим, что просьбы больше нет: вернётся на экран — попросит
      // заново, а без этого осталась бы ждать ответа, который не придёт
      task?.settle(false);

      continue;
    }

    const priority = task.priority();

    if (priority < bestPriority) {
      bestPriority = priority;
      bestIndex = index;
    }
  }

  return bestIndex === -1 ? undefined : queue.splice(bestIndex, 1)[0];
}

/** Обрывает загрузки строк, которые успели уйти с экрана. */
function cancelUnwantedLoads(): void {
  for (const load of running) {
    if (!load.task.wanted()) {
      load.cancel();
    }
  }
}

/** Раздаёт свободные места очереди тем просьбам, которые ещё в силе. */
function pumpQueue(): void {
  if (running.size >= MAX_PARALLEL_LOADS && queue.length > 0) {
    // Мест нет, а желающие есть — освобождаем те, что заняты впустую
    cancelUnwantedLoads();
  }

  while (running.size < MAX_PARALLEL_LOADS) {
    const task = takeNextTask();

    if (!task) {
      return;
    }

    startLoad(task);
  }
}

/**
 * Запускает загрузку одной картинки и по её итогу двигает очередь дальше.
 *
 * @param task - просьба загрузить картинку
 */
function startLoad(task: QueuedLoad): void {
  const image = new Image();

  /** Снимает обработчики и освобождает место в очереди — ровно один раз */
  function release(load: RunningLoad): boolean {
    if (!running.delete(load)) {
      return false;
    }

    image.onload = null;
    image.onerror = null;

    return true;
  }

  const load: RunningLoad = {
    task,
    cancel: () => {
      if (release(load)) {
        // Пустой src обрывает начатый запрос
        image.src = '';
        // Строке говорим, что просьба закрыта: вернётся на экран — попросит
        // заново (а картинка к тому времени может уже лежать в кэше мира)
        task.settle(false);
      }
    },
  };

  running.add(load);

  /**
   * Завершает попытку: успех отдаём строке, отказ откладываем на повтор.
   *
   * @param loaded - картинка загрузилась
   */
  function finish(loaded: boolean): void {
    if (!release(load)) {
      return;
    }

    const retryDelay = RETRY_DELAYS_MS[task.attempt];

    if (loaded) {
      loadedUrls.add(task.url);
      task.settle(true);
    } else if (retryDelay !== undefined && task.wanted()) {
      setTimeout(() => {
        if (!task.wanted()) {
          // Строка ушла с экрана, пока ждали паузу: повтор не нужен, но просьбу
          // за ней закрываем — иначе, вернувшись, она не попросит заново
          task.settle(false);

          return;
        }

        queue.push({ ...task, attempt: task.attempt + 1 });
        pumpQueue();
      }, retryDelay);
    } else {
      task.settle(false);
    }

    pumpQueue();
  }

  image.onload = () => finish(true);
  image.onerror = () => finish(false);
  image.src = task.url;
}

/** Общий наблюдатель за видимостью строк — один на весь список */
let visibilityObserver: IntersectionObserver | undefined;

/** Что делать, когда строка появилась на экране или ушла с него */
const visibilityWatchers = new WeakMap<Element, (visible: boolean) => void>();

/**
 * Отдаёт общий наблюдатель, создавая его при первом обращении.
 *
 * @returns наблюдатель или `undefined`, если среда его не поддерживает
 */
function getVisibilityObserver(): IntersectionObserver | undefined {
  if (typeof IntersectionObserver === 'undefined') {
    return undefined;
  }

  visibilityObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        visibilityWatchers.get(entry.target)?.(entry.isIntersecting);
      }
    },
    { rootMargin: VISIBILITY_MARGIN },
  );

  return visibilityObserver;
}

/**
 * Управляет картинкой строки списка: очередь, повторы, показ только готового.
 *
 * @param getImageUrl - геттер ссылки на картинку (реактивный источник)
 * @param elementRef - кружок строки в вёрстке: по нему следят за видимостью и
 *   считают очерёдность
 * @returns `imageSrc` (ссылка готовой картинки; пусто — показывается значок) и
 *   обработчик ошибки для `@error` на случай, если браузер потеряет картинку из
 *   своего кеша
 */
export function useListImage(
  getImageUrl: () => string | null | undefined,
  elementRef: Readonly<ShallowRef<HTMLElement | null>>,
): {
  imageSrc: ComputedRef<string | undefined>;
  handleImageError: () => void;
} {
  /** Ссылка, которая уже загрузилась и которую можно ставить в тег */
  const readyUrl = ref<string | undefined>(undefined);

  /** Строка на экране (или рядом с ним) */
  const isVisible = ref(false);

  /** Ссылка, которая сейчас в очереди или грузится */
  let requestedUrl: string | undefined;

  /**
   * Картинка всё ещё нужна: строка на экране и ссылка у неё не сменилась.
   *
   * @param url - ссылка, ради которой заводилась просьба
   * @returns `true`, если результат ещё пригодится
   */
  function stillWants(url: string): boolean {
    return isVisible.value && getImageUrl() === url;
  }

  /** Ставит картинку в очередь, если она нужна и ещё не запрошена. */
  function requestImage(): void {
    const url = getImageUrl();

    if (!url || !isVisible.value || url === readyUrl.value) {
      return;
    }

    if (loadedUrls.has(url)) {
      readyUrl.value = url;

      return;
    }

    if (url === requestedUrl) {
      return;
    }

    requestedUrl = url;

    queue.push({
      url,
      attempt: 0,
      wanted: () => stillWants(url),
      priority: () => getRowPriority(elementRef.value),
      settle: (loaded) => {
        // Метку «уже просим» снимаем ВСЕГДА, даже когда строка ушла с экрана и
        // загрузку оборвали: иначе, вернувшись, строка сочла бы, что просьба
        // всё ещё в силе, и осталась бы со значком навсегда.
        if (requestedUrl === url) {
          requestedUrl = undefined;
        }

        if (loaded && stillWants(url)) {
          readyUrl.value = url;
        }
      },
    });

    pumpQueue();
  }

  // Строка появилась на экране — самое время попросить картинку
  watch(isVisible, (visible) => {
    if (visible) {
      requestImage();
    }
  });

  // Сменилась запись строки — прежняя картинка больше не её
  watch(getImageUrl, () => {
    readyUrl.value = undefined;
    requestedUrl = undefined;
    requestImage();
  });

  // Кружок строки появился в вёрстке — начинаем следить за его видимостью
  watch(elementRef, (element, previous) => {
    const observer = getVisibilityObserver();

    if (previous) {
      visibilityWatchers.delete(previous);
      observer?.unobserve(previous);
    }

    if (!element) {
      isVisible.value = false;

      return;
    }

    if (!observer) {
      // Наблюдателя нет — грузим сразу: очередь всё равно защищает от залпа
      isVisible.value = true;

      return;
    }

    visibilityWatchers.set(element, (visible) => {
      isVisible.value = visible;
    });

    observer.observe(element);
  });

  onScopeDispose(() => {
    const element = elementRef.value;

    if (element) {
      visibilityWatchers.delete(element);
      visibilityObserver?.unobserve(element);
    }

    // Просьбы этой строки больше не нужны — очередь их выбросит
    isVisible.value = false;
  });

  /** Браузер потерял картинку из своего кеша — просим её заново */
  function handleImageError(): void {
    const url = getImageUrl();

    if (url) {
      loadedUrls.delete(url);
    }

    readyUrl.value = undefined;
    requestedUrl = undefined;
    requestImage();
  }

  return {
    imageSrc: computed(() => readyUrl.value),
    handleImageError,
  };
}
