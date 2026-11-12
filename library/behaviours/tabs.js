// tabs: buttons that each show one panel. Markup: data-use="tabs" around [role=tablist] with buttons
// [role=tab][aria-controls=<panel id>], and the panels [role=tabpanel][id]. The arrow keys, Home and End move
// between tabs; the chosen one is aria-selected, the others' panels hidden.
export default function (el) {
  const tabs = [...el.querySelectorAll('[role=tab]')];
  if (!tabs.length) return;
  const panel = (tab) => el.querySelector(`#${CSS.escape(tab.getAttribute('aria-controls') ?? '')}`);
  const choose = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const p = panel(t);
      if (p) p.hidden = !on;
    }
    if (focus) tab.focus();
  };
  const click = (e) => {
    const tab = e.target.closest('[role=tab]');
    if (tab && tabs.includes(tab)) choose(tab);
  };
  const key = (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    choose(tabs[(next + tabs.length) % tabs.length], true);
  };
  choose(tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0]);
  el.addEventListener('click', click);
  el.addEventListener('keydown', key);
  return () => {
    el.removeEventListener('click', click);
    el.removeEventListener('keydown', key);
  };
}
