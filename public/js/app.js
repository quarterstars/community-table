// Enhance server-rendered reservation forms. Numeric inputs work without JS.
document.querySelectorAll('[data-quantity-selector]').forEach((panel) => {
  const input = panel.querySelector('input[name="quantity"]');
  const buttons = panel.querySelectorAll('[data-quantity-step]');
  const announcement = panel.querySelector('[data-quantity-announcement]');
  const minimum = Number(input.min);
  const maximum = Number(input.max);

  function updateQuantity(value) {
    const parsed = Number(value);
    const quantity = Number.isFinite(parsed)
      ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
      : minimum;

    input.value = quantity;
    buttons.forEach((button) => {
      const step = Number(button.dataset.quantityStep);
      button.disabled = step < 0 ? quantity <= minimum : quantity >= maximum;
    });
    announcement.textContent = quantity === 1 ? document.body.dataset.quantitySingularMessage : document.body.dataset.quantityMessage.replace('{count}', quantity);
  }

  buttons.forEach((button) => {
    button.hidden = false;
    button.addEventListener('click', () => {
      updateQuantity(Number(input.value) + Number(button.dataset.quantityStep));
    });
  });
  input.addEventListener('change', () => updateQuantity(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      updateQuantity(input.value);
    }
  });
  updateQuantity(input.value);
});

// Convenience only: unique database keys also prevent duplicates without JS.
document.querySelectorAll('[data-reservation-form]').forEach((form) => {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  let pending = false;
  form.addEventListener('submit', (event) => {
    if (pending) { event.preventDefault(); return; }
    if (form.checkValidity()) { pending = true; button.disabled = true; button.textContent = document.body.dataset.reservingMessage; }
  });
  window.addEventListener('pageshow', () => { pending = false; button.disabled = false; button.textContent = document.body.dataset.reserveMessage; });
});

// Supply validation feedback in the selected app language, including browsers
// whose native validation language differs from the selected language.
document.querySelectorAll('input, select, textarea').forEach(input => {
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('change', () => input.setCustomValidity(''));
  input.addEventListener('invalid', () => {
    input.setCustomValidity('');
    const validity = input.validity;
    const messages = document.body.dataset;
    input.setCustomValidity(validity.valueMissing ? messages.requiredMessage : validity.typeMismatch && input.type === 'email' ? messages.emailMessage : validity.tooShort || validity.tooLong ? messages.lengthMessage : validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch ? messages.numberMessage : messages.invalidMessage);
  });
});
// Keep the device's native file picker/camera choices, with a local preview.
document.querySelectorAll('[data-food-photo]').forEach(input => {
  const preview = input.form.querySelector('[data-photo-preview]');
  const image = preview.querySelector('img');
  const original = image.getAttribute('src');
  const initiallyHidden = preview.hidden;
  let objectUrl;
  input.addEventListener('change', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    const file = input.files[0];
    if (!file) { image.src = original; preview.hidden = initiallyHidden; return; }
    objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    preview.hidden = false;
  });
  image.addEventListener('error', () => { preview.hidden = true; });
  window.addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
});
