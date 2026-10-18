// Shadow DOM retargets these events to the host outside the extension, so a
// page shortcut handler that checks event.target cannot recognise our inputs.
// Bubble at the ShadowRoot, after native target and React root handlers run.
// Never preventDefault: editing, composition, clipboard, Tab and form submit
// still belong to the focused control. Outer capture handlers run before this
// boundary and cannot be isolated here without swallowing target handlers.
export function isolateEditableKeyboard(shadowRoot) {
  const types = ['keydown', 'keypress', 'keyup'];
  function stopEditableKey(event) {
    const origin = event.composedPath().find(node => node.nodeType === 1);
    if (!origin) return;
    const control = origin.closest('input, textarea, select');
    const textInput = control?.localName === 'input'
      && !['button', 'checkbox', 'radio', 'reset', 'submit', 'image', 'hidden', 'file', 'color', 'range'].includes(control.type);
    if ((control && !control.disabled && !control.readOnly
      && (textInput || control.localName === 'textarea' || control.localName === 'select'))
      || origin.isContentEditable) event.stopPropagation();
  }
  for (const type of types) shadowRoot.addEventListener(type, stopEditableKey);
  return () => { for (const type of types) shadowRoot.removeEventListener(type, stopEditableKey); };
}
