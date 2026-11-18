/* Облачный черновик — за флагом: кнопки в шапке появляются, только когда задан
   адрес API. До деплоя статический сайт не меняется (CTA и монетизация нетронуты).
   Механика: черновик (state из конструктора) уходит в FastAPI и хранится в
   PostgreSQL по случайному коду устройства — без регистрации и профиля ПД.
   Перенос между устройствами: пользователь вводит код черновика. */
(function(){
  "use strict";
  var CLOUD_URL = ""; /* ← адрес API после деплоя, например "https://dooffera-cloud-draft.onrender.com" */
  var CODE_KEY = "dd_cloud_code";

  if (!CLOUD_URL) return;

  function deviceCode(){
    try{
      var c = localStorage.getItem(CODE_KEY);
      if (c && /^[a-f0-9]{16}$/.test(c)) return c;
      var buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      c = Array.prototype.map.call(buf, function(b){
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
      localStorage.setItem(CODE_KEY, c);
      return c;
    }catch(e){ return null; }
  }

  function flash(msg, ok){
    var tx = document.getElementById("saveText");
    if (!tx) return;
    var prev = tx.textContent;
    tx.textContent = msg;
    setTimeout(function(){ tx.textContent = prev; }, 3500);
  }

  function save(){
    var code = deviceCode();
    if (!code || typeof state === "undefined") return;
    var btn = document.getElementById("cloudSave");
    btn.disabled = true;
    fetch(CLOUD_URL + "/draft/" + code, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(state)
    }).then(function(r){
      btn.disabled = false;
      if (!r.ok){ flash("Облако: не сохранилось", false); return; }
      flash("Облако: сохранено, код " + code, true);
      btn.title = "Код черновика: " + code;
    }).catch(function(){
      btn.disabled = false;
      flash("Облако: недоступно", false);
    });
  }

  function load(){
    var code = prompt("Код черновика (16 знаков):", "");
    if (!code) return;
    code = code.trim().toLowerCase();
    if (!/^[a-f0-9]{16}$/.test(code)){ flash("Код должен быть 16 знаков", false); return; }
    fetch(CLOUD_URL + "/draft/" + code)
      .then(function(r){ if (!r.ok) throw new Error("нет такого черновика"); return r.json(); })
      .then(function(data){
        if (typeof data !== "object" || !data) throw new Error("пустой черновик");
        try{
          localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(blankState(), data)));
        }catch(e){ flash("Облако: не влезло в браузер", false); return; }
        location.reload();
      })
      .catch(function(e){ flash("Облако: " + e.message, false); });
  }

  function ready(){
    var saveBtn = document.getElementById("cloudSave");
    var loadBtn = document.getElementById("cloudLoad");
    if (!saveBtn || !loadBtn) return;
    saveBtn.hidden = false;
    loadBtn.hidden = false;
    saveBtn.addEventListener("click", save);
    loadBtn.addEventListener("click", load);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
