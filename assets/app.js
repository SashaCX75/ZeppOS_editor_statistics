(function () {
  "use strict";

  const config = window.APP_CONFIG;
  const I18N = window.I18N;
  const LANGS = Object.keys(I18N);
  const COLLAPSED_ROWS = 8;

  const PANELS = {
    windows: {
      full: (d) => d.windows_versions,
      grouped: (d) => (d.windows_by_number || []).map((r) => ({ ...r, name: "Windows " + r.name })),
    },
    winLang: {
      full: (d) => d.windows_languages,
      grouped: (d) => d.windows_languages_grouped,
    },
    appLang: { full: (d) => d.app_languages },
    watch: { full: (d) => d.watch_models },
  };

  const state = {
    lang: detectLang(),
    theme: document.documentElement.dataset.theme || "dark",
    data: null,
    modes: loadJSON("panelModes", {}),
    expanded: {},
  };

  // ---------- storage helpers ----------
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function loadJSON(key, fallback) {
    try { return JSON.parse(load(key)) || fallback; } catch (e) { return fallback; }
  }

  // ---------- i18n ----------
  function detectLang() {
    const saved = load("lang");
    if (LANGS.includes(saved)) return saved;
    const prefs = navigator.languages || [navigator.language || "en"];
    for (const l of prefs) {
      const code = String(l).toLowerCase().split("-")[0];
      if (LANGS.includes(code)) return code;
    }
    return "en";
  }

  function t(key, vars) {
    let s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
    if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
    return s;
  }

  function fmtNum(n) {
    return new Intl.NumberFormat(state.lang).format(n);
  }
  function fmtPct(part, total) {
    if (!total) return "—";
    return new Intl.NumberFormat(state.lang, {
      style: "percent",
      maximumFractionDigits: part / total < 0.1 ? 1 : 0,
    }).format(part / total);
  }

  function applyLang() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });
    document.querySelectorAll("[data-lang]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang));
    });
    document.title = config.appName + " — " + t("title");
    applyThemeLabel();
    render();
  }

  // ---------- theme ----------
  function applyThemeLabel() {
    const btn = document.getElementById("theme-toggle");
    const label = state.theme === "dark" ? t("themeToLight") : t("themeToDark");
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    save("theme", state.theme);
    applyThemeLabel();
  }

  // ---------- data ----------
  async function fetchStats() {
    const demo = new URLSearchParams(location.search).has("demo");
    setLoading(true);
    showError(null);
    try {
      const res = demo
        ? await fetch(config.demoUrl, { cache: "no-store" })
        : await fetch(config.statsUrl, {
            headers: { apikey: config.publishableKey },
            cache: "no-store",
          });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.data = await res.json();
      render();
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function setLoading(on) {
    document.body.classList.toggle("is-loading", on);
    document.getElementById("refresh").disabled = on;
    if (on && !state.data) document.getElementById("updated").textContent = t("loading");
  }

  function showError(msg) {
    const box = document.getElementById("error");
    box.hidden = !msg;
    document.getElementById("error-text").textContent = msg || "";
  }

  // ---------- rendering ----------
  function render() {
    const d = state.data;
    renderUpdated(d);
    renderKpis(d);
    for (const id in PANELS) renderPanel(id, d);
  }

  function renderUpdated(d) {
    const el = document.getElementById("updated");
    if (!d) return;
    const date = d.generated_at ? new Date(d.generated_at) : null;
    el.textContent = date && !isNaN(date)
      ? t("updated", {
          date: new Intl.DateTimeFormat(state.lang, { dateStyle: "medium", timeStyle: "short" }).format(date),
        })
      : "";
  }

  function renderKpis(d) {
    document.querySelectorAll("[data-kpi]").forEach((el) => {
      const v = d && d[el.dataset.kpi];
      el.textContent = typeof v === "number" ? fmtNum(v) : "—";
    });
    document.querySelectorAll("[data-kpi-share]").forEach((el) => {
      const v = d && d[el.dataset.kpiShare];
      el.textContent = d && typeof v === "number" && d.total_devices
        ? t("shareOfTotal", { pct: fmtPct(v, d.total_devices) })
        : "";
    });
  }

  function renderPanel(id, d) {
    const panel = document.querySelector('[data-panel="' + id + '"]');
    const def = PANELS[id];
    const mode = def[state.modes[id]] ? state.modes[id] : "full";

    panel.querySelectorAll("[data-mode]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    });

    const box = panel.querySelector(".bars");
    if (!d) {
      box.innerHTML = '<div class="skeleton"></div>'.repeat(5);
      return;
    }

    const rows = (def[mode](d) || []).slice().sort((a, b) => b.count - a.count);
    if (!rows.length) {
      box.innerHTML = '<p class="empty">' + escapeHtml(t("noData")) + "</p>";
      return;
    }

    const total = rows.reduce((s, r) => s + r.count, 0);
    const max = rows[0].count;
    const expanded = !!state.expanded[id];
    const visible = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

    let html = '<ol class="bar-list">';
    visible.forEach((r, i) => {
      const w = max ? Math.max((r.count / max) * 100, 1.5) : 0;
      html +=
        '<li class="bar-row" title="' + escapeHtml(r.name) + ": " + fmtNum(r.count) + " " + escapeHtml(t("devices")) + '">' +
          '<span class="bar-name">' + escapeHtml(r.name) + "</span>" +
          '<span class="bar-count">' + fmtNum(r.count) + "</span>" +
          '<span class="bar-pct">' + fmtPct(r.count, total) + "</span>" +
          '<span class="bar-track"><span class="bar-fill' + (i === 0 ? " is-top" : "") + '" style="width:' + w + '%"></span></span>' +
        "</li>";
    });
    html += "</ol>";

    if (rows.length > COLLAPSED_ROWS) {
      html +=
        '<button type="button" class="link-btn more" data-expand="' + id + '">' +
        escapeHtml(expanded ? t("showLess") : t("showAll", { n: rows.length })) +
        "</button>";
    }
    box.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- events ----------
  document.getElementById("app-name").textContent = config.appName;

  document.querySelectorAll("[data-lang]").forEach((b) => {
    b.addEventListener("click", () => {
      state.lang = b.dataset.lang;
      save("lang", state.lang);
      applyLang();
    });
  });

  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("refresh").addEventListener("click", fetchStats);
  document.getElementById("retry").addEventListener("click", fetchStats);

  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const id = panel.dataset.panel;
    panel.addEventListener("click", (e) => {
      const modeBtn = e.target.closest("[data-mode]");
      if (modeBtn) {
        state.modes[id] = modeBtn.dataset.mode;
        save("panelModes", JSON.stringify(state.modes));
        renderPanel(id, state.data);
        return;
      }
      if (e.target.closest("[data-expand]")) {
        state.expanded[id] = !state.expanded[id];
        renderPanel(id, state.data);
      }
    });
  });

  applyLang();
  fetchStats();
})();
