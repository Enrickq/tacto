/*
 * Chooses the page language before the styles and modules load, and writes it
 * to <html lang>; i18n.js reads it from there.
 * Order: ?lang=es|en in the address, then #es or #en (hosts that keep only the
 * hash, such as some embedded pages), then a saved choice, then the page's own
 * default (data-default-lang on this script tag), then the browser languages.
 * Spanish-speaking browsers (also Catalan, Galician and Basque) get Spanish;
 * every other browser gets English.
 * The markup is written in Spanish, so an English page stays hidden until
 * app.js has translated it, or for 2.5 seconds at most.
 */
(function () {
  var root = document.documentElement;
  var script = document.currentScript;
  function pick(value) {
    var code = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return code === 'es' || code === 'en' ? code : null;
  }
  var language = null;
  try { language = pick(new URLSearchParams(location.search).get('lang')); } catch (error) { /* Old browser. */ }
  if (!language && /^#(es|en)$/i.test(location.hash || '')) language = pick(location.hash.slice(1));
  if (!language) {
    try { language = pick(localStorage.getItem('tacto-language')); } catch (error) { /* Storage blocked. */ }
  }
  if (!language && script && script.getAttribute) language = pick(script.getAttribute('data-default-lang'));
  if (!language) {
    var preferred = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    language = 'en';
    for (var i = 0; i < preferred.length; i += 1) {
      var tag = String(preferred[i] || '').toLowerCase();
      if (/^(es|ca|gl|eu)\b/.test(tag)) { language = 'es'; break; }
      if (/^en\b/.test(tag)) break;
    }
  }
  root.lang = language;
  if (language !== 'es') {
    root.classList.add('i18n-pending');
    setTimeout(function () { root.classList.remove('i18n-pending'); }, 2500);
  }
})();
