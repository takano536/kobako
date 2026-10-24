import { isAndroidTouchDevice } from '../../src/lib/select-dismiss-tap';

/**
 * Open the browser's own picker for a hidden date input. Some browsers
 * reject showPicker() unless the input is focused first, so fall back to click().
 * 月の選択はアプリ内の月グリッド（`month-picker.tsx`）で行い、ネイティブのピッカーは使いません。
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

/**
 * 日付の表示部（`<label htmlFor>`）のクリック。
 *
 * Android のタッチ端末では何もせず、ラベルから隠れた input への既定の起動に任せます。
 * それ以外の端末では、ラベルの既定動作は input にフォーカスを移すだけでピッカーを開かないため、
 * 既定動作を止めて `showPicker()` で開きます。
 */
export function handlePickerDisplayClick(
  event: { target: EventTarget | null; preventDefault(): void },
  input: HTMLInputElement | null,
): void {
  // ラベルの既定動作で input に送られたクリックが、ラベルまで伝わってきたものは扱いません。
  if (event.target === input) return;
  if (isAndroidTouchDevice(navigator.userAgent, navigator.maxTouchPoints)) return;
  event.preventDefault();
  if (input) openNativePicker(input);
}

/** 表示部（`role="button"`）を Enter／Space で操作したときに、ピッカーを開きます。 */
export function handlePickerDisplayKeyDown(
  event: { key: string; target: EventTarget | null; preventDefault(): void },
  input: HTMLInputElement | null,
): void {
  if (event.target === input || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  if (input) openNativePicker(input);
}
