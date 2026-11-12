// carousel: a row of slides that scrolls with snap points, with Previous and Next buttons and a polite
// announcement of the slide shown. Markup: data-use="carousel" around a list of slides ([data-slides], its
// children the slides) and, optionally, buttons [data-prev] and [data-next].
export default function (el) {
  const track = el.querySelector('[data-slides]') ?? el.firstElementChild;
  if (!track) return;
  Object.assign(track.style, { display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', scrollBehavior: 'smooth' });
  for (const s of track.children) Object.assign(s.style, { flex: '0 0 100%', scrollSnapAlign: 'start' });
  const live = document.createElement('p');
  live.setAttribute('aria-live', 'polite');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  el.append(live);
  const at = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const go = (d) => {
    const n = Math.min(track.children.length - 1, Math.max(0, at() + d));
    track.scrollTo({ left: n * track.clientWidth });
    live.textContent = `${n + 1} / ${track.children.length}`;
  };
  const prev = el.querySelector('[data-prev]'), next = el.querySelector('[data-next]');
  const back = () => go(-1), on = () => go(1);
  prev?.addEventListener('click', back);
  next?.addEventListener('click', on);
  return () => {
    prev?.removeEventListener('click', back);
    next?.removeEventListener('click', on);
    live.remove();
  };
}
