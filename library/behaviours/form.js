// form: a contact form that says thank you. With a real action (an address of your form service) it sends there
// first; without one (action="#", the placeholder), it only says thank you. Markup: <form data-use="form">.
export default function (el) {
  const form = el.matches('form') ? el : el.querySelector('form');
  if (!form) return;
  const send = async (e) => {
    e.preventDefault();
    const action = form.getAttribute('action');
    try {
      if (action && action !== '#') await fetch(action, { method: form.method || 'POST', body: new FormData(form), headers: { accept: 'application/json' } });
      const note = document.createElement('p');
      note.className = 'sent';
      note.setAttribute('role', 'status');
      note.textContent = form.dataset.thanks || 'Thank you! Your message is on its way.';
      form.replaceWith(note);
    } catch {
      form.querySelector('[type=submit]')?.setAttribute('aria-invalid', 'true');
    }
  };
  form.addEventListener('submit', send);
  return () => form.removeEventListener('submit', send);
}
