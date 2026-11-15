// Tripboard's language (2026-11): English or Hebrew, from Settings or the
// device. Runs in <head>, so <html> has its lang and dir before anything
// draws, and writes the Hebrew file's tag only when it's needed. Every
// script reads window.i18n: i18n.t("English text", { name }) and
// i18n.tn(n, "1 place", "{n} places"). Not t(), since t is a trip here.
window.i18n = Keel.i18n.create({ key: "tripboard.lang", langs: ["en", "he"], load: false });
(function () {
  const v = (/\?v=[^&#]+/.exec((document.currentScript && document.currentScript.src) || "") || [""])[0];
  if (window.i18n.lang !== "en") document.write('<script src="src/lang/' + window.i18n.lang + '.js' + v + '"><\/script>');
})();
