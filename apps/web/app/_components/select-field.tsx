'use client';

import { useEffect } from 'react';

import styles from './select-field.module.css';

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 8;
const MIN_MENU_HEIGHT = 120;
const MENU_WIDTH = 240;
const VALUE_EVENT = 'kobako-select-value';
const ENHANCED_ATTR = 'data-kobako-select-enhanced';

type SelectState = {
  select: HTMLSelectElement;
  parent: HTMLElement;
  trigger: HTMLButtonElement;
  menu: HTMLDivElement;
  originalId: string;
  originalAriaHidden: string | null;
  originalTabIndex: string | null;
  originalStyle: string;
  open: boolean;
  cleanups: (() => void)[];
};

function optionLabel(option: HTMLOptionElement): string {
  return option.textContent?.trim() ?? '';
}

function syncState(state: SelectState): void {
  const { select, trigger, menu } = state;
  const selected = select.selectedOptions[0];
  const label = selected ? optionLabel(selected) : '';
  trigger.querySelector('[data-select-value]')!.textContent = label;
  trigger.className = [
    styles.trigger!,
    select.className,
    state.parent.classList.contains('selectChevronWrap') && 'native-select-trigger',
  ]
    .filter(Boolean)
    .join(' ');
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-expanded', String(state.open));
  if (select.hasAttribute('aria-invalid')) {
    trigger.setAttribute('aria-invalid', select.getAttribute('aria-invalid') ?? 'true');
  } else {
    trigger.removeAttribute('aria-invalid');
  }
  const describedBy = select.getAttribute('aria-describedby');
  if (describedBy) trigger.setAttribute('aria-describedby', describedBy);
  else trigger.removeAttribute('aria-describedby');
  menu.replaceChildren(
    ...Array.from(select.options, (option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.role = 'menuitemradio';
      item.tabIndex = -1;
      item.disabled = option.disabled;
      item.setAttribute('aria-checked', String(option.value === select.value));
      item.dataset.value = option.value;
      item.className = styles['menu-item']!;
      const text = document.createElement('span');
      text.className = styles['menu-label']!;
      text.textContent = optionLabel(option);
      item.append(text);
      const meta = option.dataset.meta;
      if (meta) {
        const metaElement = document.createElement('span');
        metaElement.className = styles['menu-meta']!;
        metaElement.textContent = meta;
        item.append(metaElement);
      }
      item.addEventListener('click', () => choose(state, option.value));
      return item;
    }),
  );
}

function close(state: SelectState, returnFocus: boolean): void {
  state.open = false;
  state.menu.hidden = true;
  delete state.menu.dataset.slot;
  state.trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) state.trigger.focus();
}

function choose(state: SelectState, value: string): void {
  if (state.select.disabled) return;
  state.select.value = value;
  state.select.dispatchEvent(new Event('input', { bubbles: true }));
  state.select.dispatchEvent(new Event('change', { bubbles: true }));
  syncState(state);
  close(state, true);
}

function placeMenu(state: SelectState): void {
  if (!state.open) return;
  const rect = state.trigger.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, MENU_WIDTH), window.innerWidth - VIEWPORT_MARGIN * 2);
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.left),
    window.innerWidth - VIEWPORT_MARGIN - width,
  );
  const bottom = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
  const above = rect.top - MENU_GAP - VIEWPORT_MARGIN;
  const natural = Math.min(state.menu.scrollHeight, state.menu.getBoundingClientRect().height);
  const placement = natural > bottom && above > bottom;
  const available = Math.max(placement ? above : bottom, MIN_MENU_HEIGHT);
  state.menu.style.width = `${width}px`;
  state.menu.style.left = `${left}px`;
  state.menu.style.top = placement ? '' : `${rect.bottom + MENU_GAP}px`;
  state.menu.style.bottom = placement ? `${window.innerHeight - rect.top + MENU_GAP}px` : '';
  state.menu.dataset.placement = placement ? 'top' : 'bottom';
  state.menu.style.maxHeight = natural > available ? `${available}px` : '';
}

function open(state: SelectState): void {
  if (state.select.disabled) return;
  syncState(state);
  state.open = true;
  state.menu.hidden = false;
  state.menu.dataset.slot = 'select-field-menu';
  state.trigger.setAttribute('aria-expanded', 'true');
  placeMenu(state);
  const target =
    state.menu.querySelector<HTMLElement>('[aria-checked="true"]') ??
    state.menu.querySelector<HTMLElement>('[role="menuitemradio"]');
  target?.focus({ preventScroll: true });
  if (target) {
    state.menu.scrollTop = Math.max(
      0,
      target.offsetTop - state.menu.clientHeight / 2 + target.offsetHeight / 2,
    );
  }
}

function enhance(select: HTMLSelectElement): SelectState {
  const parent = select.parentElement as HTMLElement;
  const originalId = select.id;
  const originalStyle = select.getAttribute('style') ?? '';
  const triggerId = originalId
    ? `${originalId}-trigger`
    : `select-${Math.random().toString(36).slice(2)}`;
  const menuId = `${triggerId}-menu`;
  trigger.id = triggerId;
  trigger.className = [styles.trigger!, select.className].filter(Boolean).join(' ');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', menuId);
  if (select.hasAttribute('aria-label')) {
    trigger.setAttribute('aria-label', select.getAttribute('aria-label')!);
  } else if (originalId) {
    const label = Array.from(document.querySelectorAll('label')).find(
      (candidate) => candidate.htmlFor === originalId,
    );
    if (label) {
      if (!label.id) label.id = `${triggerId}-label`;
      trigger.setAttribute('aria-label', label.textContent?.trim() ?? '');
    }
  }
  const value = document.createElement('span');
  value.className = styles.value!;
  value.dataset.selectValue = '';
  trigger.append(value);
  const menu = document.createElement('div');
  menu.id = menuId;
  menu.role = 'menu';
  menu.className = styles.menu!;
  menu.hidden = true;
  menu.setAttribute('aria-labelledby', triggerId);
  document.body.append(menu);
  if (parent.classList.contains('selectChevronWrap')) {
    trigger.classList.add('native-select-trigger');
  }
  const state: SelectState = {
    select,
    parent,
    trigger,
    menu,
    originalId,
    originalAriaHidden: select.getAttribute('aria-hidden'),
    originalTabIndex: select.getAttribute('tabindex'),
    originalStyle,
    open: false,
    cleanups: [],
  };
  parent.insertBefore(trigger, select);
  select.setAttribute(ENHANCED_ATTR, '');
  select.setAttribute('aria-hidden', 'true');
  select.tabIndex = -1;
  select.style.cssText = `${originalStyle}${originalStyle && !originalStyle.endsWith(';') ? ';' : ''}position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;`;

  const onTriggerClick = () => (state.open ? close(state, false) : open(state));
  const onTriggerKeyDown = (event: KeyboardEvent) => {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    open(state);
  };
  const onMenuKeyDown = (event: KeyboardEvent) => {
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      event.preventDefault();
      close(state, true);
      return;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[index];
      if (item) choose(state, item.dataset.value ?? '');
      return;
    }
    if (next === null || !items.length) return;
    event.preventDefault();
    items[next]?.focus();
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && (trigger.contains(target) || menu.contains(target))) return;
    close(state, false);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.open) {
      event.preventDefault();
      event.stopPropagation();
      close(state, true);
    }
  };
  const onSync = () => syncState(state);
  const onInvalid = () => {
    state.trigger.focus();
  };
  const onReset = () => window.setTimeout(onSync, 0);
  trigger.addEventListener('click', onTriggerClick);
  trigger.addEventListener('keydown', onTriggerKeyDown);
  menu.addEventListener('keydown', onMenuKeyDown);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  select.addEventListener(VALUE_EVENT, onSync);
  select.addEventListener('input', onSync);
  select.addEventListener('change', onSync);
  select.addEventListener('invalid', onInvalid);
  select.form?.addEventListener('reset', onReset);
  state.cleanups.push(
    () => trigger.removeEventListener('click', onTriggerClick),
    () => trigger.removeEventListener('keydown', onTriggerKeyDown),
    () => menu.removeEventListener('keydown', onMenuKeyDown),
    () => document.removeEventListener('pointerdown', onPointerDown, true),
    () => document.removeEventListener('keydown', onKeyDown, true),
    () => select.removeEventListener(VALUE_EVENT, onSync),
    () => select.removeEventListener('input', onSync),
    () => select.removeEventListener('change', onSync),
    () => select.removeEventListener('invalid', onInvalid),
    () => select.form?.removeEventListener('reset', onReset),
  );
  syncState(state);
  return state;
}

function restore(state: SelectState): void {
  state.cleanups.forEach((cleanup) => cleanup());
  state.menu.remove();
  state.trigger.remove();
  state.select.removeAttribute(ENHANCED_ATTR);
  if (state.originalId) state.select.id = state.originalId;
  if (state.originalAriaHidden === null) state.select.removeAttribute('aria-hidden');
  else state.select.setAttribute('aria-hidden', state.originalAriaHidden);
  if (state.originalTabIndex === null) state.select.removeAttribute('tabindex');
  else state.select.setAttribute('tabindex', state.originalTabIndex);
  if (state.originalStyle) state.select.setAttribute('style', state.originalStyle);
  else state.select.removeAttribute('style');
}

function installValueObserver(): () => void {
  const selectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const selectIndex = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  const optionSelected = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected');
  const cleanups: (() => void)[] = [];
  if (selectValue?.set && selectValue.get) {
    const setter = selectValue.set;
    Object.defineProperty(HTMLSelectElement.prototype, 'value', {
      ...selectValue,
      set(value: string) {
        setter.call(this, value);
        this.dispatchEvent(new Event(VALUE_EVENT));
      },
    });
    cleanups.push(() => Object.defineProperty(HTMLSelectElement.prototype, 'value', selectValue));
  }
  if (selectIndex?.set && selectIndex.get) {
    const setter = selectIndex.set;
    Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', {
      ...selectIndex,
      set(value: number) {
        setter.call(this, value);
        this.dispatchEvent(new Event(VALUE_EVENT));
      },
    });
    cleanups.push(() =>
      Object.defineProperty(HTMLSelectElement.prototype, 'selectedIndex', selectIndex),
    );
  }
  if (optionSelected?.set && optionSelected.get) {
    const setter = optionSelected.set;
    Object.defineProperty(HTMLOptionElement.prototype, 'selected', {
      ...optionSelected,
      set(value: boolean) {
        setter.call(this, value);
        this.closest('select')?.dispatchEvent(new Event(VALUE_EVENT));
      },
    });
    cleanups.push(() =>
      Object.defineProperty(HTMLOptionElement.prototype, 'selected', optionSelected),
    );
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

export function SelectFieldEnhancer(): null {
  useEffect(() => {
    const states = new Map<HTMLSelectElement, SelectState>();
    const enhanceAll = (root: ParentNode) => {
      if (
        root instanceof HTMLSelectElement &&
        !root.hasAttribute('data-native-select') &&
        !root.hasAttribute(ENHANCED_ATTR) &&
        root.parentElement
      ) {
        states.set(root, enhance(root));
      }
      root
        .querySelectorAll('select:not([data-native-select]):not([data-kobako-select-enhanced])')
        .forEach((select) => {
          if (select instanceof HTMLSelectElement && select.parentElement)
            states.set(select, enhance(select));
        });
    };
    const restoreValueObserver = installValueObserver();
    enhanceAll(document);
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) enhanceAll(node);
        });
        if (record.type === 'childList' || record.type === 'characterData') {
          const target =
            record.target instanceof HTMLSelectElement
              ? record.target
              : record.target instanceof Element
                ? record.target.closest('select')
                : record.target.parentElement?.closest('select');
          const state = target ? states.get(target) : undefined;
          if (state) syncState(state);
        }
        if (record.type === 'attributes' && record.target instanceof HTMLSelectElement) {
          const state = states.get(record.target);
          if (state) {
            syncState(state);
          }
        }
      });
      states.forEach((state, select) => {
        if (!select.isConnected) {
          restore(state);
          states.delete(select);
        }
      });
    });
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'id',
        'disabled',
        'aria-invalid',
        'aria-describedby',
        'aria-label',
        'class',
      ],
    });
    return () => {
      observer.disconnect();
      restoreValueObserver();
      states.forEach(restore);
    };
  }, []);
  return null;
}
