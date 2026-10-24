import { isAndroidTouchDevice } from '../../src/lib/select-dismiss-tap';

/** ピッカーを開いた後、ページへフォーカスが戻るのを待っている input の後片付け。 */
let stopWatchingPickerInput: (() => void) | null = null;

/**
 * Android のタッチ端末では、ピッカーを閉じた後も隠れた input にフォーカスが残ることがあり、
 * 別の `<select>` のダイアログを閉じたときのフォーカス復元でピッカーが開き直ります。
 * ページがフォーカスを取り戻した時点（`window` の `focus` と、`visibilitychange` で visible に
 * なったとき、それぞれ1回）でまだその input にフォーカスがあれば外します。値が変わったら終えます。
 */
function blurWhenPageRegainsFocus(input: HTMLInputElement): void {
  stopWatchingPickerInput?.();
  let pending = 2;
  const blurIfStillFocused = () => {
    if (document.activeElement === input) input.blur();
  };
  const handleWindowFocus = () => {
    window.removeEventListener('focus', handleWindowFocus);
    blurIfStillFocused();
    if (--pending === 0) stop();
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    blurIfStillFocused();
    if (--pending === 0) stop();
  };
  const stop = () => {
    window.removeEventListener('focus', handleWindowFocus);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    input.removeEventListener('change', stop);
    if (stopWatchingPickerInput === stop) stopWatchingPickerInput = null;
  };
  window.addEventListener('focus', handleWindowFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  input.addEventListener('change', stop);
  stopWatchingPickerInput = stop;
}

/**
 * Open the browser's own picker for a hidden date or month input. Some browsers
 * reject showPicker() unless the input is focused first, so fall back to click().
 */
export function openNativePicker(input: HTMLInputElement): void {
  if (isAndroidTouchDevice(navigator.userAgent, navigator.maxTouchPoints)) {
    blurWhenPageRegainsFocus(input);
  }
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
