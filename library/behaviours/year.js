// year: the current year, so a footer's © never goes stale. Markup: <span data-use="year">2026</span>.
export default function (el) {
  const was = el.textContent;
  el.textContent = String(new Date().getFullYear());
  return () => (el.textContent = was);
}
