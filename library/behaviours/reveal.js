// reveal: the element fades in as it scrolls into view, once; nothing moves for people who ask for less motion
// (prefers-reduced-motion). Markup: data-use="reveal" on any element.
export default function (el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  el.style.opacity = '0';
  el.style.transition = 'opacity .6s ease, transform .6s ease';
  el.style.transform = 'translateY(12px)';
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    el.style.opacity = '';
    el.style.transform = '';
    seen.disconnect();
  }, { threshold: 0.15 });
  seen.observe(el);
  return () => {
    seen.disconnect();
    el.style.opacity = el.style.transform = el.style.transition = '';
  };
}
