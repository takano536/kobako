/**
 * The API badge is a device preference, not household data: it is read in the browser before the
 * first paint so a hidden badge never flashes in.
 */
export const ORIGIN_BADGE_STORAGE_KEY = 'kobako.originBadge';
export const ORIGIN_BADGE_ATTRIBUTE = 'data-origin-badge';
export const ORIGIN_BADGE_HIDDEN_VALUE = 'hidden';

export const ORIGIN_BADGE_INIT_SCRIPT = `(function(){try{if(window.localStorage.getItem('${ORIGIN_BADGE_STORAGE_KEY}')==='${ORIGIN_BADGE_HIDDEN_VALUE}'){document.documentElement.setAttribute('${ORIGIN_BADGE_ATTRIBUTE}','${ORIGIN_BADGE_HIDDEN_VALUE}');}}catch(e){}})();`;
