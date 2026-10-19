"use strict";
/* Балл резюме 0–100 — общие правила для конструктора (index.html) и страницы
   «Проверить резюме». Функции принимают состояние резюме в форме черновика
   конструктора: personal, about, experience, education, skills, languages,
   courses, vacancy. Ничего не отправляют: только считают в браузере. */

/* ================= Словари ================= */
const CLICHES = [
  ["стрессоустойчив","стрессоустойчивость"],
  ["коммуникабельн","коммуникабельность"],
  ["ответственн","ответственность"],
  ["обучаем","обучаемость"],
  ["многозадачн","многозадачность"],
  ["командный игрок","командный игрок"],
  ["активная жизненная позиция","активная жизненная позиция"],
  ["нацеленность на результат","нацеленность на результат"],
  ["целеустремл","целеустремлённость"],
  ["пунктуальн","пунктуальность"],
  ["исполнительн","исполнительность"],
  ["креативн","креативность"]
];
const WEAK_VERBS = ["занимался","занималась","участвовал","участвовала","помогал","помогала","отвечал за","отвечала за","содействовал","содействовала","обеспечивал","обеспечивала","осуществлял","осуществляла","курировал","курировала","вносил вклад","принимал участие","принимала участие"];

/* Процессные формулировки: описывают обязанность, а не результат */
const PROCESS_RE = /в (?:мои )?обязанност[ие] вход|в обязанности вход|выполнение обязанност|было выполнено|была выполнена|был выполнен|было проведено|была проведена|был провед[её]н|осуществлял[оа]сь|производил[оа]сь/;

/* Ред-флаги раздела «О себе»: витрина, а не список условий к работодателю */
const ABOUT_REDFLAGS = [
  {re:/не дав(?:и|ите)\b|не беспоко|только письменно|строго письменно|звонк[иа]?\s+(?:на\s+телефон\s+)?не\s+принима|не\s+принима\w*\s+звонк|неприемлем|категорическ|график\s+6\/1|строго\s+до\s+\d/, label:"ультиматумы и жёсткие условия"},
  {re:/медицинск|инвалидн|ограничени\w*\s+по\s+здоров|по\s+состоянию\s+здоров|последствия\s+.{0,15}травм/, label:"личные и медицинские данные"},
  {re:/\bклан\b|онлайн[\s-]?игр|гильди/, label:"несерьёзные доводы (игры и т.п.)"}
];
const ABOUT_METRIC_RE = /\d+\s*%|\d+\s*(?:₽|руб|тыс\.?|млн|млрд|раз|шт|чел|клиент|контакт|сотрудник|проект|заявк|договор|балл|мин|час)/i;

/* ================= Соответствие вакансии ================= */
const VAC_STOP = new Set(("и в во не на что с со как а то все но да ты к у же за бы по только ее мне было вот от меня еще нет о из ему теперь когда ли если уже или ни быть был до вас вам ведь там потом себя ей может они тут где есть надо для тебя их чем была сам без будто чего тоже себе под будет тогда кто этот того этого какой здесь этом один мой тем чтобы нее были куда всех можно при два об другой хоть после над больше тот через эти нас про всего них какая эту моя перед иногда лучше том нельзя такой им более всегда конечно всю между это мы вы наш ваш наши ваши свой свои также итд др пр" +
" обязанности требования условия компания компании компанию работа работы работу работе опыт лет год года годах желательно преимуществом плюсом плюс знание знания умение умения наличие высшее образование график гибкий оформление зарплата оклад премия премии дмс офис офисе удаленно удаленка гибрид команда команде команду коллектив развитие возможность возможности карьерный карьерного рост роста соцпакет тк рф собеседование кандидат кандидата кандидатов ищем ждем предлагаем ожидаем нужно нужен нужна будете вакансия вакансии должность должности обязателен обязательна обязательно готовность желание ответственность стрессоустойчивость коммуникабельность обучаемость исполнительность пунктуальность конкурентная конкурентн несколько нескольк").split(/\s+/));

const VAC_SUF = ["иями","ями","ами","ого","его","ому","ему","ыми","ими","ение","ения","ению","ством","ство","ства","ости","ость","ует","уют","ает","ают","яет","яют","ить","ыть","ать","ять","еть","ой","ей","ом","ем","ам","ям","ах","ях","ов","ев","ых","их","ый","ий","ая","яя","ое","ее","ие","ые","ую","юю","а","я","о","е","ы","и","у","ю","ь","й"].sort((x,y)=>y.length-x.length);

function vacStem(w){
  let s = w, guard = 0;
  while(guard++ < 3){
    let cut = false;
    for(const suf of VAC_SUF){
      if(s.length - suf.length >= 4 && s.endsWith(suf)){ s = s.slice(0, -suf.length); cut = true; break; }
    }
    if(!cut) break;
  }
  return s;
}

function vacTokens(text){
  return (String(text||"").toLowerCase().replace(/ё/g,"е").match(/[a-zа-я0-9][a-zа-я0-9+#./-]*/g) || [])
    .map(t => t.replace(/[./-]+$/,"")).filter(Boolean);
}

function analyzeVacancy(state){
  const vt = (state.vacancy||"").trim();
  if(vt.length < 40) return null;
  const resumeText = [
    state.personal.title, state.about,
    ...state.experience.map(e=>[e.role,e.company,e.desc].filter(Boolean).join(" ")),
    ...state.education.map(e=>e.degree||""),
    state.skills.join(" "),
    ...state.courses.map(c=>c.name||""),
    ...state.languages.map(l=>l.name||"")
  ].join(" ");
  const rstems = new Set(vacTokens(resumeText).map(vacStem));
  if(rstems.size < 3) return {empty:true};

  const freq = new Map();
  for(const tok of vacTokens(vt)){
    if(VAC_STOP.has(tok)) continue;
    if(/^\d+([.,]\d+)?$/.test(tok)) continue;
    const lat = /[a-z0-9]/.test(tok);
    if(lat ? tok.length < 2 : tok.length < 4) continue;
    const st = vacStem(tok);
    if(VAC_STOP.has(st)) continue;
    const e = freq.get(st) || {word:tok, n:0};
    e.n++; freq.set(st, e);
  }
  let items = [...freq.entries()].map(([st,e])=>({stem:st, word:e.word, n:e.n}));
  items.sort((a,b)=> b.n-a.n || b.stem.length-a.stem.length);
  items = items.slice(0, 24); // ядро вакансии: самые частые значимые слова
  const isHit = it => {
    if(rstems.has(it.stem)) return true;
    if(it.stem.length >= 5){
      for(const r of rstems){
        if(r.length >= 5 && (r.startsWith(it.stem) || it.stem.startsWith(r))) return true;
      }
    }
    return false;
  };
  const hits = [], miss = [];
  items.forEach(it => (isHit(it) ? hits : miss).push(it));
  const pct = items.length ? Math.round(hits.length / items.length * 100) : 0;
  return {pct, hits, miss, total: items.length};
}

/* ================= Балл резюме ================= */
/* Полнота формы — что ещё не заполнено. Подсказка «следующий шаг», пока
   резюме пустое и считать балл не по чему. */
function completeness(state){
  const p = state.personal;
  let pct = 0;
  const tips = [];
  if(p.name) pct += 10; else tips.push("Укажите <b>имя</b> — без него резюме не рассматривают.");
  if(p.title) pct += 10; else tips.push("Добавьте <b>желаемую должность</b> — рекрутёр ищет по ней.");
  if(p.phone || p.email) pct += 10; else tips.push("Оставьте <b>телефон или почту</b>, иначе с вами не свяжутся.");
  if(state.about.trim().length >= 60) pct += 12; else tips.push("Напишите 2–4 предложения <b>о себе</b> с результатом в цифрах.");
  if(state.experience.length) pct += 15; else tips.push("Добавьте <b>опыт работы</b> — это главная секция резюме.");
  if(state.experience.some(e=>e.desc && e.desc.trim().length>40)) pct += 15; else if(state.experience.length) tips.push("Опишите <b>результаты</b> на последнем месте: цифры убеждают сильнее слов.");
  if(state.education.length) pct += 8; else tips.push("Укажите <b>образование</b> — многие фильтры его требуют.");
  if(state.skills.length >= 4) pct += 12; else tips.push("Добавьте хотя бы <b>4 навыка</b> — по ним резюме находят в поиске.");
  if(state.languages.length) pct += 4;
  if(p.city) pct += 2;
  if(p.photo) pct += 2;
  return {pct:Math.min(100,pct), tips};
}

/* Шесть мест, где режут резюме, — те же, что в разборе и мини-диагнозе:
   поля, название, первый экран, слова вакансии, достижения, красные флаги.
   Каждое даёт очки из своего максимума; без вакансии «слова вакансии» не
   считаются, и балл нормируется на доступный максимум. */
const monthIdx = ym => { const m = /^(\d{4})-(\d{2})$/.exec(ym||""); return m ? (+m[1])*12 + (+m[2]) - 1 : null; };

/* Цифра результата в опыте: любая цифра, кроме голого года и «1С» */
const hasResultDigit = d => /\d/.test(d.replace(/(^|\D)(?:19|20)\d{2}(?!\d)/g,"$1").replace(/(^|\D)1с(?![a-zа-я0-9])/g,"$1"));

function scoreResume(state){
  const p = state.personal;
  const norm = s => (s||"").toLowerCase().replace(/ё/g,"е");
  const about = norm(state.about);
  const descs = state.experience.map(e=>norm(e.desc).trim()).filter(d=>d.length >= 40);
  const joined = about + "\n" + descs.join("\n");
  const vac = analyzeVacancy(state);
  const hasVac = !!(vac && !vac.empty);
  const parts = [];
  // каждое место копит причины с весом; в подпись идёт самая тяжёлая
  const part = (label, score, max, notes) => {
    notes.sort((x,y)=>y.w-x.w);
    parts.push({label, score:Math.max(0,score), max, note:notes.length ? notes[0].t : ""});
  };

  // 1. Поля — то, что читает автофильтр до текста
  let f = 0; const fN = [];
  if(p.name) f += 3; else fN.push({w:3,t:"нет имени"});
  if(p.phone || p.email) f += 3; else fN.push({w:3,t:"нет телефона или почты"});
  if(state.experience.length) f += 3; else fN.push({w:3,t:"нет опыта работы"});
  if(state.skills.length >= 4) f += 3; else fN.push({w:3,t:"меньше 4 навыков — по ним резюме ищут"});
  if(state.education.length) f += 2; else fN.push({w:2,t:"не указано образование"});
  if(p.city) f += 1; else fN.push({w:1,t:"не указан город"});
  part("поля", f, 15, fN);

  // 2. Название — совпадает ли с языком вакансии
  let t = 0; const tN = [];
  if(p.title){
    t += 5;
    if(hasVac){
      const vstems = new Set(vacTokens(state.vacancy).filter(w=>!VAC_STOP.has(w)).map(vacStem));
      const hit = vacTokens(p.title).filter(w=>!VAC_STOP.has(w) && w.length >= 3).map(vacStem).some(s=>vstems.has(s));
      if(hit) t += 5; else tN.push({w:5,t:"название резюме не совпадает со словами вакансии"});
    } else { t += 5; }
  } else tN.push({w:10,t:"нет желаемой должности"});
  part("название", t, 10, tN);

  // 3. Первый экран — «О себе»: коротко, с цифрой, без клише
  let s = 0; const sN = [];
  const aboutLen = state.about.trim().length;
  if(aboutLen >= 60){
    s += 5;
    if(aboutLen <= 600) s += 3; else sN.push({w:3,t:"«о себе» длиннее, чем дочитают"});
    if(ABOUT_METRIC_RE.test(about)) s += 4; else sN.push({w:4,t:"в «о себе» нет ни одной цифры"});
    if(!CLICHES.some(c=>about.includes(c[0]))) s += 3; else sN.push({w:3,t:"в «о себе» клише вместо фактов"});
  } else sN.push({w:15,t:"«о себе» пустое или короче двух предложений"});
  part("первый экран", s, 15, sN);

  // 4. Слова вакансии — только если вакансия вставлена
  if(hasVac){
    part("слова вакансии", Math.round(vac.pct/100*20), 20, [{w:1,t:`совпало ${vac.pct}% ключевых слов вакансии`}]);
  }

  // 5. Достижения — результат с цифрой, а не обязанности
  let a = 0; const aN = [];
  if(descs.length){
    a += 4;
    const withDigits = descs.filter(hasResultDigit).length;
    a += Math.round(12 * withDigits / descs.length);
    if(withDigits < descs.length) aN.push({w:12*(descs.length-withDigits)/descs.length, t:"в опыте есть места без единой цифры"});
    if(!WEAK_VERBS.some(v=>joined.includes(v))) a += 5; else aN.push({w:5,t:"слабые глаголы: «занимался», «участвовал»"});
    if(!PROCESS_RE.test(joined)) a += 4; else aN.push({w:4,t:"обязанности вместо результатов"});
  } else aN.push({w:25,t:"опыт без описания результатов"});
  part("достижения", a, 25, aN);

  // 6. Красные флаги — то, что рекрутёр додумает сам
  let r = 15; const rN = [];
  if(about.length >= 30 && ABOUT_REDFLAGS.some(fl=>fl.re.test(about))){ r -= 6; rN.push({w:6,t:"ультиматумы или личные данные в «о себе»"}); }
  if(state.skills.length > 15){ r -= 3; rN.push({w:3,t:"навыков больше 15"}); }
  if(p.email && !p.email.includes("@")){ r -= 3; rN.push({w:3,t:"почта без «@»"}); }
  const now = new Date(), nowIdx = now.getFullYear()*12 + now.getMonth();
  const jobs = state.experience
    .map(e=>({s:monthIdx(e.start), e:e.current ? nowIdx : monthIdx(e.end), cur:!!e.current}))
    .filter(j=>j.s !== null && j.e !== null && j.e >= j.s)
    .sort((x,y)=>x.s-y.s);
  // текущее место короче года — не флаг, человек просто недавно вышел
  const short = jobs.filter(j=>!j.cur && (j.e - j.s) < 12).length;
  if(short >= 2){ r -= 4; rN.push({w:4,t:"две и больше работы короче года"}); }
  // перерыв считаем от самого позднего окончания, иначе подработка внутри основной работы даёт ложный разрыв
  let gap = false, latestEnd = null;
  for(const j of jobs){
    if(latestEnd !== null && j.s - latestEnd > 3) gap = true;
    latestEnd = latestEnd === null ? j.e : Math.max(latestEnd, j.e);
  }
  if(gap){ r -= 4; rN.push({w:4,t:"перерыв больше трёх месяцев без объяснения"}); }
  part("красные флаги", r, 15, rN);

  const sum = parts.reduce((x,pt)=>x+pt.score,0), max = parts.reduce((x,pt)=>x+pt.max,0);
  return {total:Math.round(sum/max*100), parts, hasVac};
}

/* Что поправить первым: два самых слабых места, где взято меньше 70 % */
function weakParts(sc){
  return sc.parts.filter(pt=>pt.score/pt.max < 0.7).sort((x,y)=>x.score/x.max - y.score/y.max).slice(0,2);
}
