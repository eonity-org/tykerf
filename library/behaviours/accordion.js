// accordion: a group of <details>, one open at a time; each still opens with the keyboard (Enter, Space) as
// <details> does. Markup: an element with data-use="accordion" around the <details>.
export default function (el) {
  const items = () => [...el.querySelectorAll(':scope details, :scope > * > details')];
  const toggled = (e) => {
    if (!e.target.open) return;
    for (const d of items()) if (d !== e.target) d.open = false;
  };
  el.addEventListener('toggle', toggled, true);
  return () => el.removeEventListener('toggle', toggled, true);
}
