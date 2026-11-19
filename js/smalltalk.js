/** Cortesía en español. Sin DOM, almacenamiento, modelo ni acceso al corpus. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./util.js') : root.NCUtil);
  if (node) module.exports = api;
  root.NCSmalltalk = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';
  // Quitar solo puntuación conversacional. «"hola"», «-hola» y «hola =pag:2»
  // son consultas válidas del buscador, no mensajes sociales.
  const words = s => U.normalize(s).replace(/👋[🏻🏼🏽🏾🏿]?/gu, ' hola ')
    .replace(/[¡!¿?,.;:…🙂😊\s]+/gu, ' ').trim();
  const greeting = /^(buenos dias|buen dia|buenas tardes|buenas noches|hol+a+|holi|hey|ey|buenas|saludos)(?: |$)/;
  const greetings = { 'buenos dias':'Buenos días', 'buen dia':'Buen día', 'buenas tardes':'Buenas tardes', 'buenas noches':'Buenas noches' };
  const thanks = /^(?:(?:muchas|muchisimas|mil) )?gracias(?: por (?:todo|(?:la|tu) ayuda|escucharme|preguntar))?$/;
  const goodbye = /^(?:adios|chao|chau|nos vemos|hasta (?:luego|pronto|manana|la proxima)|que (?:tengas|pases) (?:un )?(?:buen|bonito) dia)$/;
  const status = /^(?:como (?:estas(?: tu)?(?: hoy)?|esta(?: usted)?|le va|te (?:va|encuentras|sientes)|andas|amaneciste|has estado)|que tal(?: (?:estas|todo|te va|tu dia))?|que (?:cuentas|mas)|como va (?:todo|tu dia)|estas bien|todo bien|y tu)$/;

  // Solo se acepta una frase COMPLETA (o saludo + otra fórmula completa).
  function recognize(text, { address = 'Spyder', afterCheckin = false } = {}) {
    if (!text || text.length > 180) return null;
    const name = words(address);
    function unaddress(s) {
      if (!name) return s;
      if (s === name) return '';
      if (s.startsWith(name + ' ')) s = s.slice(name.length + 1);
      return s.endsWith(' ' + name) ? s.slice(0,-name.length-1) : s;
    }
    let s = unaddress(words(text)), salutation = '';
    // «Hola, buenos días, Spyder» conserva el saludo más específico.
    for (let i = 0; i < 2; i++) {
      const m = greeting.exec(s); if (!m) break;
      salutation = greetings[m[1]] || salutation || 'Hola'; s = unaddress(s.slice(m[0].length));
    }
    const as = kind => ({ kind, salutation });
    if (!s) return salutation ? as('hello') : null;
    if (afterCheckin || / (?:gracias|y tu)\b/.test(s)) {
      if (/^(?:(?:estoy|me va) )?(?:bien|muy bien|genial|todo bien)(?: gracias)?(?: y tu)?$/.test(s) && !(s === 'todo bien' && /[¿?]/.test(text))) return { ...as('good'), reciprocal:s.endsWith('y tu') };
      if (/^(?:no (?:muy|tan) bien|no (?:estoy|me siento) (?:muy )?bien|(?:estoy|me siento) triste|regular|mas o menos|mal)(?: gracias)?(?: y tu)?$/.test(s)) return as('rough');
    }
    if (status.test(s)) return as('checkin');
    if (/^(?:estas ahi|sigues ahi|me lees)$/.test(s)) return as('available');
    if (thanks.test(s) || s === 'te lo agradezco' || s === 'muy amable') return as('thanks');
    if (goodbye.test(s)) return as('bye');
    if (goodbye.test(s.replace(/^(?:muchas )?gracias (?:y )?/,''))) return as('thanksBye');
    if (/^(?:mucho gusto|encantad[oa] de conocerte)$/.test(s)) return as('meet');
    if (/^(?:quien eres|como te llamas)$/.test(s)) return as('identity');
    if (/^(?:que (?:puedes|sabes) hacer|en que (?:puedes ayudarme|me puedes ayudar))$/.test(s)) return as('help');
    return null;
  }

  function parse(text, opts) {
    const raw = String(text ?? '').trim(), social = recognize(raw,opts);
    if (social) return { social, request:raw };
    // Si hay una petición, quitar solo una introducción inequívoca. Cortar en
    // el ORIGINAL para conservar comillas, filtros, tildes, fórmulas y comandos.
    // Un término aislado («hola mundo», «gracias a la luz») se sigue buscando tal cual.
    let start = 0;
    const head = raw.slice(0,180);
    for (const match of head.matchAll(/[\s!,.;:…?]+/gu)) {
      const end = match.index + match[0].length;
      if (end === raw.length) break;
      if (match[0] === '.' && !/[¿¡]/u.test(raw[end])) continue; // hola.pdf no es una introducción.
      if (!match[0].trim() && !/^(?:[¿¡]|(?:qu[eé]|cu[aá]nto|c[oó]mo|por qu[eé]|calcula|aprende|recuerda|resume|explica\w*|compara|contrasta|revisa|dime|puedes)\b)/iu.test(raw.slice(end,end+24))) continue;
      const lead = recognize(head.slice(0,match.index),opts);
      if (lead && ['hello','thanks','checkin'].includes(lead.kind)) start = end;
    }
    return { social:null, request:raw.slice(start).trimStart() };
  }

  function reply({ kind, salutation, reciprocal }, { tutor = false, personal = false, again = false } = {}) {
    const hi = salutation ? `¡${salutation}! ` : '';
    switch (kind) {
      case 'hello': return hi + (tutor ? '¿Qué te gustaría repasar hoy?' : again || salutation === 'Buenas noches' ? '¿Qué tienes en mente?' : '¿Cómo va tu día?');
      case 'checkin': return hi + '¡Gracias por preguntar! Estoy aquí, listo para conversar. ¿Cómo vas tú?';
      case 'available': return hi + 'Sí, te leo. ¿Qué tienes en mente?';
      case 'good': return reciprocal ? '¡Qué bueno! Por aquí, listo para charlar. ¿Qué tienes en mente?' : '¡Qué bueno! ¿De qué te gustaría hablar?';
      case 'rough': return personal ? 'Siento que el día no vaya tan bien. ¿Prefieres que te escuche o que pensemos en un paso pequeño?' : 'Siento que el día no vaya tan bien. Si prefieres hablar en un espacio separado del chat de estudio, puedes abrir ✦ HABLAR.';
      case 'thanks': return '¡De nada!';
      case 'thanksBye': return '¡De nada! Hasta la próxima.';
      case 'bye': return '¡Hasta luego! Que te vaya bien.';
      case 'meet': return '¡Mucho gusto! Soy Spyder. ¿Por dónde empezamos?';
      case 'identity': return 'Soy Spyder, tu asistente virtual local. Podemos conversar o trabajar con tus apuntes.';
      case 'help': return 'Podemos charlar sin cargar nada. Si quieres estudiar, puedo resumir tus apuntes o ayudarte a contrastar pasajes en Tutor con fuentes.';
    }
  }
  return { parse, reply };
});
