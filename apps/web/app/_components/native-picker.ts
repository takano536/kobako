/**
 * Open the browser's own picker for a hidden date or month input. Some browsers
 * reject showPicker() unless the input is focused first, so fall back to click().
 */
export function openNativePicker(input: HTMLInputElement): void {
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  if (typeof pickerInput.showPicker === 'function') {
    try {
      pickerInput.showPicker();
      return;
    } catch {
      // Some browsers reject showPicker unless the input is focused first.
    }
  }
  input.focus();
  input.click();
}
