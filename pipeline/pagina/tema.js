// Tema da página de dados: sistema, claro ou escuro, no mesmo cookie do portfólio e da demo
// (domínio lucasrikelmi.dev). Carregado sem defer no <head> para aplicar o tema salvo antes da
// primeira pintura; o seletor é montado quando o DOM fica pronto. Arquivo próprio (e não script
// inline) porque a CSP da raiz só aceita script do próprio site.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  const KEY = "tema";
  const media = matchMedia("(prefers-color-scheme: dark)");
  const DOMINIO = /(^|\.)lucasrikelmi\.dev$/.test(location.hostname) ? "; Domain=lucasrikelmi.dev" : "";
  const SEGURO = location.protocol === "https:" ? "; Secure" : "";

  const inicial = (document.cookie.match(/(?:^|; )tema=(light|dark)/) || [])[1];
  if (inicial) root.dataset.theme = inicial;

  const salvo = () => (document.cookie.match(/(?:^|; )tema=(light|dark|system)/) || [])[1] || "system";
  const efetivo = () => root.dataset.theme || (media.matches ? "dark" : "light");

  function sincronizarMeta() {
    const cor = getComputedStyle(root).getPropertyValue("--bg").trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) =>
      m.setAttribute("content", root.dataset.theme ? cor : m.dataset.default || cor));
  }

  function aplicar(modo, gravar) {
    if (modo === "light" || modo === "dark") root.dataset.theme = modo; else delete root.dataset.theme;
    // "system" também é gravado: vale como escolha explícita no portfólio.
    if (gravar) document.cookie = `${KEY}=${modo}; Path=/; Max-Age=31536000; SameSite=Lax${DOMINIO}${SEGURO}`;
    document.querySelectorAll(".tema button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.modo === modo)));
    sincronizarMeta();
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: efetivo() } }));
  }

  const ICONES = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>',
  };
  const ROTULOS = { system: "Tema do sistema", light: "Tema claro", dark: "Tema escuro" };

  function montar() {
    document.querySelectorAll(".tema").forEach((sw) => {
      sw.innerHTML = ["system", "light", "dark"].map((m) =>
        `<button type="button" role="radio" data-modo="${m}" aria-label="${ROTULOS[m]}" title="${ROTULOS[m]}">${ICONES[m]}</button>`).join("");
      sw.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        // Crossfade da página na troca, onde houver View Transitions e movimento não reduzido.
        const trocar = () => aplicar(b.dataset.modo, true);
        if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(trocar);
        else trocar();
      });
      sw.addEventListener("keydown", (e) => {
        if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
        const bs = [...sw.querySelectorAll("button")];
        const n = bs[(bs.indexOf(document.activeElement) + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length];
        n.focus(); n.click();
      });
    });

    aplicar(salvo(), false);
    // Sem tema fixo, acompanha o sistema em tempo real.
    media.addEventListener("change", () => { if (!root.dataset.theme) aplicar("system", false); });
    // Volta de outra aba (ex.: tema trocado no portfólio): reaplica o que estiver salvo.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && salvo() !== (root.dataset.theme || "system")) aplicar(salvo(), false);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar); else montar();
})();
