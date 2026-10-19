"use strict";
/* Текст резюме → поля конструктора, чтобы посчитать балл тем же кодом, что в
   конструкторе (js/score.js). Понимает два частых вида: резюме с hh (страница
   или PDF) и резюме из Word. Разбор приблизительный, поэтому вместе с полями
   возвращаем, что удалось найти, — страница показывает это человеку.
   Всё считается в браузере, текст никуда не отправляется. */

const PR_MON = {янв:1,фев:2,мар:3,апр:4,май:5,мая:5,июн:6,июл:7,авг:8,сен:9,окт:10,ноя:11,дек:12,
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const PR_MON_RE = "(?:янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-zа-яё]*\\.?";
const PR_DATE = `(?:${PR_MON_RE}\\s*(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[./](?:19|20)\\d{2}|(?:19|20)\\d{2})`;
const PR_NOW = "(?:по\\s+)?(?:настоящее\\s+время|наст\\.?\\s*вр(?:емя|\\.)?|н\\.\\s?в\\.?|сейчас|текущее\\s+время|по\\s+сей\\s+день|present|now)";
const PR_RANGE = new RegExp(`(${PR_DATE})(?:\\s*г(?:ода?|г)?\\.?)?\\s*(?:—|–|-|по|до)\\s*(${PR_DATE}|${PR_NOW})`, "i");
const PR_RANGE_TAIL = new RegExp(`^(?:${PR_DATE}|${PR_NOW})`, "i");
const PR_NOW_ONLY = new RegExp(`^${PR_NOW}$`, "i");
const PR_DURATION = /\(?\s*\d+\s*(?:года|год|лет)(?:\s+\d+\s*(?:месяцев|месяца|месяц))?\s*\)?|\(?\s*\d+\s*(?:месяцев|месяца|месяц)\s*\)?/gi;

/* Заголовки разделов. Совпадение — по всей строке, чтобы «Образование клиентов»
   в описании опыта не открыло раздел «Образование». */
const PR_HEADS = [
  ["about", ["о себе","обо мне","коротко о себе","кратко о себе","профиль","summary","about me"]],
  ["exp", ["опыт работы","опыт","трудовая деятельность","места работы","профессиональный опыт","опыт и достижения","work experience","experience"]],
  ["edu", ["образование","основное образование","education"]],
  ["courses", ["курсы","повышение квалификации","повышение квалификации, курсы","дополнительное образование","сертификаты","тесты, экзамены","электронные сертификаты","courses"]],
  ["skills", ["ключевые навыки","навыки","профессиональные навыки","компетенции","ключевые компетенции","технические навыки","skills","hard skills","soft skills"]],
  ["langs", ["знание языков","языки","иностранные языки","владение языками","languages"]],
  ["title", ["желаемая должность и зарплата","желаемая должность","цель","objective"]],
  ["other", ["дополнительная информация","гражданство, время в пути до работы","гражданство","контакты","контактная информация","рекомендации","портфолио","хобби","увлечения","личная информация"]]
];
/* hh в PDF ставит подзаголовок и текст в одну строку: «Обо мне Текст…», «Навыки Excel  1С» */
const PR_INLINE = [["обо мне","about"],["ключевые навыки","skills"],["навыки","skills"],["знание языков","langs"]];

const PR_SKIP = /^(?:резюме|cv|curriculum vitae)$|^резюме обновлено|^был[аи]?\s+(?:сегодня|вчера|\d)|^(?:активно\s+)?ищ(?:у|ет)\s+работу$|^не\s+ищ(?:у|ет)\s+работу$|^рассматрива[а-яё]*\s+предложения$/i;
const PR_PERSONAL = /мужчина|женщина|возраст|родил|гражданств|разрешени[а-яё]*\s+на\s+работу|переезд|командировк|способ связи|время в пути|тип занятости|занятость|график работы|формат работы|специализаци/i;
const PR_CONTACT = /@|https?:|www\.|t\.me|telegram|телеграм|skype|whatsapp|vk\.com|linkedin|github|телефон|e-?mail|почта|^\+?[\d\s()+.-]{7,}$/i;
const PR_SALARY = /₽|руб|\$|€|на руки|до вычета/i;
const PR_CITY = /^(?:проживает|город(?:\s+проживания)?|место (?:жительства|проживания)|адрес|г\.)\s*:?\s*(.+)$/i;
/* Город в шапке: «Москва», «Санкт-Петербург», «Ростов-на-Дону», «Нижний Новгород» — и слова о месте после запятой */
const PR_CITY_NAME = /^[А-ЯЁ][а-яё]+(?:-(?:на-|он-)?[А-ЯЁ][а-яё]+)*(?:\s[А-ЯЁ][а-яё]+)?$/;
const PR_PLACE = /готов[а-яё]*\s+к|переезд|командиров|релокац|(?:^|\s)м\.\s*[А-ЯЁ]|метро|район|област|край|росси/i;
const PR_NAME = /^[А-ЯЁA-Z][а-яёa-zА-ЯЁA-Z-]+(?:\s+[А-ЯЁA-Z][а-яёa-zА-ЯЁA-Z-]+){1,2}$/;
const PR_EDU_WORD = /университет|институт|академи[яи]|колледж|техникум|училищ|лицей|высшее|среднее специальное|бакалавр|магистр|специалитет/i;
const PR_BULLET = /^(?:[—–\-•*·●▪►✓]|\d+[.)])\s*/;

const prNorm = s => s.toLowerCase().replace(/ё/g, "е").trim();

function prHead(line, cur){
  let t = prNorm(line)
    .replace(/\s*[—–-]?\s*\d+\s*(?:год|года|лет)(?:\s+\d+\s*месяц[а-яё]*)?\s*$/, "")
    .replace(/\s*[—–-]?\s*\d+\s*месяц[а-яё]*\s*$/, "")
    .replace(/[\s:.—–-]+$/, "");
  for(const [kind, names] of PR_HEADS) if(names.includes(t)) return {kind, rest:""};
  const m = /^([^:]{2,40}):\s*(.+)$/.exec(line.trim());
  if(m){
    const h = prNorm(m[1]);
    for(const [kind, names] of PR_HEADS) if(names.includes(h)) return {kind, rest:m[2].trim()};
  }
  if(cur === "other" || cur === "skills" || cur === "langs"){
    for(const [h, kind] of PR_INLINE){
      if(t.startsWith(h + " ")) return {kind, rest:line.trim().slice(h.length).trim()};
    }
  }
  return null;
}

function prMonth(tok, isEnd){
  const t = prNorm(tok);
  let m = /^(\d{1,2})[./](\d{4})/.exec(t);
  if(m) return `${m[2]}-${String(+m[1]).padStart(2, "0")}`;
  m = /^([a-zа-я]+)\.?\s*(\d{4})/.exec(t);
  if(m && PR_MON[m[1].slice(0, 3)]) return `${m[2]}-${String(PR_MON[m[1].slice(0, 3)]).padStart(2, "0")}`;
  m = /(\d{4})/.exec(t);
  return m ? `${m[1]}-${isEnd ? "12" : "01"}` : "";
}

const prIsDuration = l => /\d/.test(l) && l.replace(PR_DURATION, "").replace(/[\s,()]/g, "") === "";
const prBodyLike = l => PR_BULLET.test(l) || /[.;!]$/.test(l) || l.length >= 90;

/* Место работы: в начале — шапка (компания, город, сфера, должность), дальше — описание */
function prEntry(lines, start, end, current){
  const ls = lines.filter(l => !prIsDuration(l) && !/^(?:www\.|https?:)/i.test(l));
  const head = [];
  let i = 0;
  while(i < ls.length && head.length < 4 && !prBodyLike(ls[i])) head.push(ls[i++]);
  if(i >= ls.length && head.length > 2){ i = 2; head.length = 2; }
  return {
    role: head.length ? head[head.length - 1] : "",
    company: head.length > 1 ? head[0] : "",
    start, end, current,
    desc: ls.slice(i).join("\n")
  };
}

function prExperience(lines){
  const at = [];
  lines.forEach((l, i) => { if(PR_RANGE.test(l)) at.push(i); });
  if(!at.length) return lines.length ? [prEntry(lines, "", "", false)] : [];
  const lead = lines.slice(0, at[0]);
  const bodies = at.map((a, k) => {
    const m = PR_RANGE.exec(lines[a]);
    const rest = lines[a].replace(m[0], "").replace(PR_DURATION, "").replace(/^[\s,;|()—–-]+|[\s,;|()—–-]+$/g, "");
    const body = lines.slice(a + 1, k + 1 < at.length ? at[k + 1] : lines.length);
    if(rest.length > 2) body.unshift(rest);
    const current = PR_NOW_ONLY.test(m[2].trim());
    return {body, start:prMonth(m[1], false), end:current ? "" : prMonth(m[2], true), current};
  });
  /* Word: «Компания, должность» стоит перед периодом — значит, хвост прошлого места
     после маркированного описания относится к следующему */
  for(let k = 0; k + 1 < bodies.length; k++){
    const b = bodies[k].body;
    let j = b.length;
    while(j > 0 && b.length - j < 2 && !prBodyLike(b[j - 1])) j--;
    if(j < b.length && j > 0 && prBodyLike(b[j - 1])) bodies[k + 1].body.unshift(...b.splice(j));
  }
  if(lead.length) bodies[0].body.unshift(...lead);
  return bodies.map(x => prEntry(x.body, x.start, x.end, x.current));
}

function prSkills(lines){
  const out = [];
  for(const l of lines){
    // «Личные качества: a, b, c» — подпись перед списком; «1С: Предприятие» — сам навык
    const t = l.replace(/^[A-Za-zА-ЯЁа-яё ]{5,30}:\s*(?=.*,)/, "").replace(/\([^)]*\)/g, m => m.replace(/,/g, "\u0001"));
    if(/^(?:уровни владения навыками|базовый|средний|продвинутый|эксперт|начальный)(?: уровень)?$/i.test(t.trim())) continue;
    for(const part of t.split(/\s*(?:[,;•·|●▪]|\t|\s{2,})\s*/)){
      const v = part.replace(/\u0001/g, ",").replace(PR_BULLET, "").replace(/[.;]$/, "").trim();
      if(v.length >= 2 && v.length <= 60 && !out.some(x => x.toLowerCase() === v.toLowerCase())) out.push(v);
    }
  }
  return out;
}

function parseResumeText(text){
  const raw = String(text || "").replace(/\r\n?/g, "\n").replace(/[   ]/g, " ");
  const src = raw.split("\n").map(l => l.trim()).filter(Boolean);

  // hh в PDF переносит период на две строки: «Март 2019 —» / «настоящее время»
  const L = [];
  for(let i = 0; i < src.length; i++){
    let l = src[i];
    if(/[—–-]$/.test(l) && i + 1 < src.length && PR_RANGE_TAIL.test(src[i + 1])) l += " " + src[++i];
    L.push(l);
  }

  const sec = {header:[], about:[], exp:[], edu:[], courses:[], skills:[], langs:[], title:[], other:[]};
  let cur = "header", heads = 0;
  for(const l of L){
    const h = prHead(l, cur);
    if(h){ cur = h.kind; heads++; if(h.rest) sec[cur].push(h.rest); continue; }
    // резюме без заголовков: первый период работы открывает опыт
    if(cur === "header" && PR_RANGE.test(l)) cur = PR_EDU_WORD.test(l) ? "edu" : "exp";
    sec[cur].push(l);
  }
  // без заголовков вуз и строка-список навыков оказываются внутри опыта — достаём
  if(!heads){
    const skillList = l => !/[.!?]$/.test(l) && l.split(",").length >= 3 && l.split(",").every(x => x.trim().length <= 30);
    sec.exp = sec.exp.filter(l => {
      if(PR_RANGE.test(l) || PR_BULLET.test(l)) return true;
      if(/университет|институт|академи[яи]|колледж|техникум|училищ/i.test(l)){ sec.edu.push(l); return false; }
      if(skillList(l)){ sec.skills.push(l); return false; }
      return true;
    });
  }

  const emailM = raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  const phoneM = raw.match(/(?:^|[^\d+])((?:\+7|8)[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2})(?!\d)/) ||
                 raw.match(/(?:^|[^\d])(\+\d{1,3}[\s(.-]*\d{2,4}[\s).-]*\d{2,4}[\s.-]*\d{2,4}(?:[\s.-]*\d{2,4})?)(?!\d)/);

  // шапка: имя, город, должность; остальное длинное — «о себе», если раздела нет
  let name = "", city = "", title = "";
  const rest = [];
  sec.header.forEach((l, i) => {
    if(PR_SKIP.test(l)) return;
    const cm = PR_CITY.exec(l);
    if(cm){ city = city || cm[1].split(",")[0].trim(); return; }
    // «Москва, готова к удалённой работе», «Москва, м. Курская», «Санкт-Петербург, готов к переезду».
    // Ищем только в шапке: названия компаний в опыте сюда не попадают
    const parts = l.split(",").map(x => x.trim());
    if(parts.length > 1 && PR_CITY_NAME.test(parts[0]) && PR_PLACE.test(parts.slice(1).join(","))){
      city = city || parts[0];
      return;
    }
    if(/готов[а-яё]*\s+к\s+переезду/i.test(l)) return;
    // «Пермь, +7 950 123-45-67» — город часто стоит в одной строке с контактами
    if((phoneM && l.includes(phoneM[1].trim())) || PR_CONTACT.test(l)){
      if(!city) city = l.split(/[,|;]/).map(x => x.trim()).find(x => /^[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?$/.test(x)) || "";
      return;
    }
    if(PR_PERSONAL.test(l) || PR_SALARY.test(l)) return;
    if(!name && i < 6 && PR_NAME.test(l)){ name = l; return; }
    rest.push(l);
  });
  const looksTitle = l => l.length >= 3 && l.length <= 80 && l.split(/\s+/).length <= 8 && !/[.!?]$/.test(l) && !/\.\s/.test(l) && !PR_BULLET.test(l);
  title = sec.title.find(l => looksTitle(l) && !PR_PERSONAL.test(l) && !PR_SALARY.test(l) && !PR_SKIP.test(l)) || "";
  if(!title){
    const k = rest.findIndex(looksTitle);
    if(k >= 0) title = rest.splice(k, 1)[0];
  }

  let about = sec.about.join("\n");
  if(!about) about = rest.filter(l => l.length >= 40).join("\n");

  const experience = prExperience(sec.exp);

  let education = [];
  if(sec.edu.length){
    const place = sec.edu.find(l => PR_EDU_WORD.test(l) && !/^(?:высшее|среднее)/i.test(l)) || sec.edu.find(l => /[a-zа-яё]{3}/i.test(l)) || sec.edu[0];
    education = [{place, degree:sec.edu.filter(l => l !== place && !/^\d{4}$/.test(l)).join(", "), years:""}];
  } else {
    const line = [...sec.header, ...sec.other].find(l => PR_EDU_WORD.test(l));
    if(line) education = [{place:line, degree:"", years:""}];
  }

  const languages = sec.langs.filter(l => /[a-zа-яё]{3}/i.test(l))
    .map(l => { const [n, ...lv] = l.split(/\s+[—–-]\s+/); return {name:n.trim(), level:lv.join(" — ").trim()}; });
  const courses = sec.courses.filter(l => !/^\d{4}$/.test(l)).map(l => ({name:l, org:"", year:""}));
  const skills = prSkills(sec.skills);

  const state = {
    personal:{name, title, city, phone:phoneM ? phoneM[1].trim() : "", email:emailM ? emailM[0] : "", telegram:"", site:"", photo:""},
    about, experience, education, skills, languages, courses,
    vacancy:"",
    theme:{accent:"#16324F", font:"serif"}
  };
  const found = {
    name:!!name, title, contacts:!!(state.personal.phone || state.personal.email), city,
    about:about.trim().length, experience:experience.length,
    experienceDated:experience.filter(e => e.start).length,
    education:education.length > 0, skills:skills.length
  };
  return {state, found};
}
