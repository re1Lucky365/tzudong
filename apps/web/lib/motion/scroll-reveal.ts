const SELECTOR = '[data-scroll-reveal]';
const MAX_WAITING_PANELS = 40;

/** One-shot, opt-in section reveals. Never scan the map document on every tile mutation. */
export function installScrollReveals(host: Document = document, view = window): () => void {
  if (!view.IntersectionObserver || !view.MutationObserver) return () => {};
  const media = view.matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet<Element>();
  const waiting = new Set<HTMLElement>();
  const queued = new Set<HTMLElement>();
  let intersection: IntersectionObserver | undefined;
  let mutations: MutationObserver | undefined;
  let frame: number | undefined;
  let disposed = false;

  const retire = (element: HTMLElement) => {
    intersection?.unobserve(element);
    waiting.delete(element);
    queued.delete(element);
    delete element.dataset.revealState;
  };
  const finish = (element: HTMLElement) => {
    if (!waiting.has(element)) return;
    intersection?.unobserve(element);
    waiting.delete(element);
    element.dataset.revealState = 'visible';
  };
  const prepare = (element: HTMLElement) => {
    if (!intersection || media.matches || !element.isConnected || seen.has(element)) return;
    // Overflow stays immediately readable rather than joining an unbounded queue.
    if (waiting.size >= MAX_WAITING_PANELS) return;
    seen.add(element);
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || (rect.top < view.innerHeight && rect.bottom > 0)) return;
    element.dataset.revealState = 'waiting';
    waiting.add(element);
    intersection.observe(element);
  };
  const collect = (element: Element) => {
    const queue = (candidate: Element) => {
      if (candidate instanceof view.HTMLElement && !seen.has(candidate)
          && queued.size + waiting.size < MAX_WAITING_PANELS) queued.add(candidate);
    };
    if (element.matches(SELECTOR)) queue(element);
    if (element.firstElementChild) element.querySelectorAll(SELECTOR).forEach(queue);
  };
  const schedule = () => {
    if (frame !== undefined || queued.size === 0 || media.matches || disposed) return;
    frame = view.requestAnimationFrame(() => {
      frame = undefined;
      if (disposed || media.matches) return;
      for (const element of queued) prepare(element);
      queued.clear();
    });
  };
  const onFocus = (event: FocusEvent) => {
    const target = event.target;
    if (target instanceof view.Element) {
      const panel = target.closest<HTMLElement>(SELECTOR);
      if (panel) finish(panel);
    }
  };
  const stop = () => {
    mutations?.disconnect(); mutations = undefined;
    intersection?.disconnect(); intersection = undefined;
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    waiting.forEach(element => { delete element.dataset.revealState; });
    waiting.clear(); queued.clear();
  };
  const start = () => {
    if (disposed || media.matches || intersection) return;
    const observer = new view.IntersectionObserver(entries => {
      // A queued callback from a disconnected observer must not alter new state.
      if (disposed || media.matches || intersection !== observer) return;
      for (const entry of entries) if (entry.isIntersecting) finish(entry.target as HTMLElement);
    }, { threshold: 0.08 });
    intersection = observer;
    host.querySelectorAll<HTMLElement>(SELECTOR).forEach(prepare);
    mutations = new view.MutationObserver(records => {
      if (disposed || media.matches) return;
      for (const record of records) {
        // Reparented/removed panels become visible; do not retain detached nodes.
        if (waiting.size) for (const removed of record.removedNodes) {
          for (const element of waiting) if (removed === element || removed.contains(element)) retire(element);
        }
        for (const node of record.addedNodes) if (node instanceof view.Element) collect(node);
      }
      schedule();
    });
    mutations.observe(host.body, { childList: true, subtree: true });
  };
  const onPreferenceChange = () => { if (media.matches) stop(); else start(); };
  media.addEventListener('change', onPreferenceChange);
  host.addEventListener('focusin', onFocus);
  start();
  return () => {
    disposed = true;
    stop();
    media.removeEventListener('change', onPreferenceChange);
    host.removeEventListener('focusin', onFocus);
  };
}
