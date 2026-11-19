/** Spyder personal. Diálogo local sin documentos, herramientas externas ni inferencias de perfil. */
(function (root, factory) {
  const node = typeof module !== 'undefined' && module.exports;
  const api = factory(node ? require('./util.js') : root.NCUtil);
  if (node) module.exports = api;
  root.NCCompanion = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U) {
  'use strict';
  const LIMIT = 20, MAX_INPUT = 1000, MAX_REPLY = 1500;
  const TONES = Object.freeze({ calm: 'Cálido y sereno', practical: 'Breve y práctico', curious: 'Curioso y reflexivo' });
  const intents = new Set(['hello','identity','recall','remember','switch','ordinary','plan','ideas','decide','offer','listen','step','pause','celebrate','people','health','urgent','care','tools']);
  const generative = new Set(['ordinary','ideas']); // Los planes con tiempos o notas se resuelven aquí.
  const transient = new Set(['urgent','care']);
  const cap = (v,n) => typeof v === 'string' ? v.trim().slice(0,n).trimEnd() : '';
  const clean = s => U.normalize(s).replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  function profile(v) {
    return { alias:cap(v?.alias,40), tone:Object.hasOwn(TONES,v?.tone) ? v.tone : 'calm', note:cap(v?.note,240) };
  }
  // Solo estas propiedades llegan al registro privado. No hay borradores,
  // prompts del sistema, pesos, contadores de ánimo ni campos del respaldo.
  function record(v) {
    if (v?.version !== 1) v = {};
    const keep = v.keep === true;
    const turns = keep && Array.isArray(v.turns) ? v.turns.slice(-LIMIT).filter(t =>
      t && intents.has(t.intent) && !transient.has(t.intent) && cap(t.question,MAX_INPUT) && cap(t.text,MAX_REPLY)
    ).map(t => ({ question:cap(t.question,MAX_INPUT), text:cap(t.text,MAX_REPLY), intent:t.intent,
      focus:cap(t.focus,110), engine:t.engine === 'qwen' ? 'qwen' : 'rules' })) : [];
    return { version:1, profile:profile(v.profile), keep, useQwen:v.useQwen === true, turns };
  }
  const styled = (tone,calm,practical,curious) => tone === 'practical' ? practical : tone === 'curious' ? curious : calm;
  function hello(p) {
    const name = p.alias ? `, ${p.alias}` : '';
    return `Hola${name}. ` + styled(p.tone,
      'Soy Spyder. Podemos hablar de tu día sin tener que resolverlo todo. ¿Qué te gustaría contarme?',
      'Soy Spyder. ¿Qué te vendría mejor hoy: hablar un rato, ordenar una idea o preparar un plan?',
      'Soy Spyder. Si pudieras dedicar este rato a una sola pregunta, ¿qué te gustaría explorar?');
  }

  // Señales orientativas en español, no una evaluación clínica. La ayuda
  // urgente tiene además una entrada manual independiente de cualquier frase.
  function urgent(q) {
    if (/\b(?:quiero|quiere|planeo|pienso|voy a|va a) (?:quitar(?:me|se|le) la vida|acabar con (?:mi|su) vida|morir(?:me|se)?|matar(?:me|se|le|lo|la)|matar a (?:alguien|otra persona)|hacer(?:me|se|le) (?:mucho )?dano|lastimar(?:me|se|lo|la)|hacer dano a (?:otros|alguien))\b/.test(q)) return true;
    if (/\b(?:no (?:aguanto|puedo) (?:seguir )?viviendo|no quiero despertar|no (?:me siento|estoy) segur[oa] (?:aqui|ahora)|estoy en peligro|me (?:amenaza|amenazan) de muerte|mi pareja me (?:pega|golpea|amenaza)|me estan golpeando|quiero terminar con (?:todo|mi vida)|i (?:want to die|want to hurt myself)|kill myself|end my life)\b/.test(q)) return true;
    return /\b(?:no quiero (?:seguir )?(?:vivir|viviendo|existir|estar viv[oa])|no vale la pena vivir|quieren? matarme|(?:estoy|corro) (?:en )?peligro (?:ahora|inmediato)|necesito ayuda urgente)\b/.test(q) ||
      /\b(?:suicid\w*|autolesion\w*|quitarme la vida|acabar con mi vida|matarme|me quiero morir|me voy a matar|quiero (?:morir|desaparecer para siempre)|mejor sin mi|me quiero (?:matar|hacer dano|lastimar)|sin ganas de vivir|hacerme dano a mi mism[oa]|me (?:hice|he hecho|estoy haciendo) dano|sobredosis)\b/.test(q) ||
      /\b(?:quiero|voy a|pienso en|he pensado en|estoy pensando en|tengo ganas de) (?:hacerme dano|lastimarme|herirme|hacerle dano a alguien)\b/.test(q) ||
      /\b(?:no (?:estoy|me siento) a salvo|me (?:van a|quieren) hacer dano|tome (?:demasiadas pastillas|mas pastillas de las debidas))\b/.test(q);
  }
  const helpText = 'Gracias por decirlo. Lo primero es tu seguridad. Si hay peligro inmediato o ya te hiciste daño, llama ahora al número de emergencias de donde estás o pide que te acompañen a urgencias. Si puedes, acércate a una persona de confianza y dile: «No me siento a salvo; necesito que te quedes conmigo». Desde aquí no puedo llamar por ti. ¿Estás a salvo en este momento?';
  const human = 'Hablar aquí puede ayudarte a ordenar lo que sientes. Soy un asistente virtual, no una persona; no tienes que elegir entre esta conversación y las personas de tu vida. Si te sirve, podemos pensar en alguien con quien te sentirías a gusto hablando.';
  const clinicalTerms = /\b(?:depresion|deprimid[oa]|trastorno|bipolar\w*|terapia)\b/;
  const feeling = [
    [/\b(?:falleci[oó]|murio|duelo|perdi a mi)\b/, 'Siento tu pérdida. No tienes que encontrar las palabras exactas ni pasar enseguida a otra cosa.'],
    [/\b(?:me despidieron|perdi mi (?:empleo|trabajo)|me echaron del trabajo)\b/, 'Perder el trabajo puede mover muchas cosas a la vez. No tienes que ordenar todas tus preocupaciones hoy.'],
    [/\b(?:discuti con|me pelee con|me dejaron fuera|se burlaron de mi|rompimos|terminamos nuestra relacion)\b/, 'Lo que pasó entre ustedes parece importarte. Puedes contar tu lado sin tener que decidir ahora qué hacer.'],
    [/\b(?:agotad[oa]|cansad[oa]|sin fuerzas|exhaust[oa])\b/, 'Cuando ya vas sin energía, hasta algo pequeño puede costar.'],
    [/\b(?:no valgo nada|soy (?:un fracaso|inutil)|no sirvo para nada)\b/, 'Suena doloroso hablarte así. Que algo haya salido mal no define todo lo que eres.'],
    [clinicalTerms, 'Gracias por contármelo. No necesitas ponerle otra etiqueta para hablar de cómo ha sido hoy.'],
    [/\b(?:triste|mal dia|dia (?:dificil|muy duro)|tristeza|desanimad[oa]|decaid[oa]|llorando|me siento mal)\b/, 'Siento que hoy esté siendo un día así. No hace falta quitarle importancia.'],
    [/\b(?:soledad|(?:me siento|estoy) (?:muy |tan )?sol[oa]|nadie me escucha)\b/, 'Si hoy te pesa la soledad, podemos hablar de ella sin prisas.'],
    [/\b(?:enojad[oa]|rabia|furios[oa]|frustrad[oa]|frustra|impotencia)\b/, 'Suena frustrante. Puedes contarme lo que pasó, sin tener que justificar cómo te sentiste.'],
    [/\b(?:abrumad[oa]|agobiad[oa]|agobia|nervios[oa]|ansios[oa]|ansiedad|estres\w*|angusti\w*|preocupa\w*|miedo|no puedo mas|no doy mas|no se que hacer|no aprobe|no me fue bien|no lo consegui|me fue mal|reprobe|suspendi)\b/, 'Suena a que tienes mucho encima. No hace falta resolverlo todo de golpe.']
  ];
  function subject(raw) {
    // Palabras de la persona para mantener el hilo; no es un diagnóstico ni
    // una etiqueta que se añada al perfil. Nunca extraerlas de una generación.
    const match = raw.match(/\b(?:el|la|mi|un|una)\s+(?:parcial|examen|entrevista|tarea|entrega|tesis|presentaci[oó]n|proyecto|ensayo)\b[^.!?;\n]{0,72}/iu) ||
      raw.match(/(?:tengo que|me preocupa|me cuesta|mi meta es|quiero preparar|necesito organizar)\s+([^.!?;\n]{3,85})/iu);
    return cap(match?.[1] || match?.[0],100);
  }
  function noteDraft(question) {
    return cap(question.replace(/^(?:recuerda(?: para otro d[ií]a)? que|guarda (?:que|esto)|anota que)\b[\s:,-]*/iu,''),240);
  }
  function planFor(focus,raw,tone) {
    const min = raw.match(/\b(\d{1,3})\s*(?:minutos?|min)\b/i);
    const time = min ? Number(min[1]) : 0;
    const lead = styled(tone,'Hagámoslo manejable.', 'Un plan breve:', 'Probemos una versión pequeña y veamos qué descubres.');
    const target = focus ? ` Para «${focus}»` : ' Para lo que tienes entre manos';
    if (time >= 3 && time <= 120) {
      const edge = Math.max(1,Math.min(5,Math.floor(time/5)));
      return `${lead}${target}, podrías repartir tus ${time} minutos así:\n1. ${edge} min: elige algo que puedas dejar hecho hoy.\n2. ${time-2*edge} min: trabaja solo en ese primer intento.\n3. ${edge} min: anota qué quedó y qué vendría después. ¿Qué resultado te parecería suficiente?`;
    }
    if (/(?:examen|parcial|presentacion|entrevista)/.test(clean(focus))) return `${lead}${target}, elige una pregunta que podría salir. Intenta responder en voz alta durante un minuto; después anota solo dónde te atascaste. ¿Con qué pregunta te gustaría empezar?`;
    return `${lead}${target}, escribe en una línea qué te gustaría tener al terminar. Luego elige una acción que quepa en cinco minutos. ¿Qué parte podrías empezar sin preparar nada más?`;
  }
  // Rutas fijas antes de persona, memoria y modelo. La respuesta de ayuda
  // no depende del tono elegido ni de textos generados en turnos anteriores.
  function boundary(q, prev, forceUrgent, say, isQuestion) {
    if (!forceUrgent && /^(?:que (?:es|significa)|estudio (?:el tema de|sobre)|busco la definicion de) (?:el |la )?(?:suicidio|autolesion)$/.test(q))
      return say('health','Si buscas una definición en tu material, puedes abrir Tutor con fuentes. Si tiene que ver con tu seguridad o con la de otra persona, pulsa Ayuda urgente; si hay peligro inmediato, llama a emergencias de tu localidad.');
    if (forceUrgent || urgent(q)) {
      const other = !forceUrgent && /\b(?:mi (?:amig[oa]|pareja|herman[oa]|hij[oa])|un[a]? amig[oa]|alguien que conozco)\b/.test(q) && /\b(?:quiere|piensa|dice que|se hizo|se va a)\b/.test(q);
      return say('urgent',other ? 'Si esa persona ya se hizo daño o hay peligro inmediato, llama a emergencias de tu localidad. Si es seguro para ti, quédate con ella o busca a alguien cercano que pueda acompañarla. No hace falta manejar esto a solas. Yo no puedo intervenir desde el chat.' : helpText);
    }
    if (/^(?:cambiemos de tema|hablemos de otra cosa|otro tema|deja ese tema)(?: por favor)?$/.test(q)) return say('switch','De acuerdo, dejamos ese tema. ¿De qué te apetece hablar ahora?');
    if (prev?.intent === 'urgent') {
      if (/^(?:(?:si|gracias) )?(?:si\b|(?:ya )?estoy a salvo\b|estoy con (?:alguien|mi|una persona)\b|ya pedi ayuda\b)/.test(q))
        return say('care','Gracias por responder. Si ahora estás a salvo, considera contarle a alguien de confianza cómo te has sentido y buscar apoyo profesional. Si vuelve el peligro, llama a emergencias de tu localidad. ¿Qué compañía te vendría bien ahora?');
      return say('urgent','Si no estás a salvo o no lo sabes, no esperes una respuesta del chat: llama a emergencias de tu localidad o pide a alguien cercano que lo haga y se quede contigo. Si ya estás a salvo, puedes decírmelo.');
    }
    if (prev?.intent === 'care') return say('care','Podemos seguir hablando, pero contar con alguien fuera del chat importa. Si te cuesta empezar, podrías decirle: «¿Tienes un momento para estar conmigo?». Si prefieres pasar a otra cosa, dime «cambiemos de tema».');
    if (/\b(?:solo (?:te (?:tengo|necesito) a ti|me entiendes tu|tu me (?:entiendes|escuchas))|eres (?:lo unico que tengo|mi unic[oa] amig[oa]|(?:el unico|la unica) que me (?:entiende|escucha))|(?:quieres|puedes) ser mi (?:novi[oa]|pareja)|te amo|no necesito a nadie mas|promete que nunca me (?:dejaras|abandonaras))\b/.test(q)) return say('people',human);
    if (/\b(?:no (?:se lo )?digas a nadie|es (?:esto )?(?:secreto|confidencial)|quien puede leer|guardas (?:mis|los) mensajes)\b/.test(q)) return say('identity','No envío lo que escribes a otras personas. Este navegador sí puede conservar el perfil y, si elegiste guardarla, la charla. Quien tenga acceso al dispositivo podría leerlos. En Personalidad y memoria puedes revisarlos o borrarlos.');
    if (/\b(?:pedir ayuda a alguien|hablar con (?:alguien|un amigo|mi familia)|no se como (?:decirlo|contarselo))\b/.test(q)) return say('people','Si te sirve, podrías empezar así: «No estoy pasando un buen rato. ¿Tienes unos minutos para escucharme?». Cámbialo para que suene a ti. Tú decides a quién pedirle compañía; yo no enviaré ese mensaje.');
    if (/\b(?:me vigilan|me persiguen|leen mi mente|oigo voces|escucho voces)\b/.test(q)) return say('health','Eso suena inquietante. No puedo saber desde el chat qué lo está causando. ¿Hay alguien de confianza con quien puedas hablar ahora? Un profesional de salud puede ayudarte a entender lo que te está pasando. Si hay peligro inmediato, busca ayuda de emergencias.');
    // Una revelación («estoy deprimida y solo quiero hablar») no pide un
    // diagnóstico. Dejarla llegar a la escucha, sin generador ni sermón.
    const clinicalTopic = clinicalTerms.test(q);
    const clinicalAsk = clinicalTopic && (isQuestion || /\b(?:dime si|como se si|que tengo|crees que tengo|como (?:tratar|curar)\w*)\b/.test(q));
    if (clinicalAsk || /\b(?:diagnosticame|un diagnostico|diagnosticar(?:me|lo)?|medicaci\w*|medicamento\w*|antidepres\w*|pastillas?|dosis|ansiolitic\w*|psiquiatr\w*|ataque de panico)\b/.test(q)) return say('health','Puedo escucharte y ayudarte a preparar cómo contarlo, pero no puedo diagnosticarte ni recomendar tratamientos o cambios de medicación. Un profesional de salud puede orientarte teniendo en cuenta tu situación. ¿Qué te gustaría que entendiera de lo que estás viviendo?');
  }
  function memoryReply(q, p, history, say) {
    if (/\b(?:quien eres|que eres|como te llamas|que (?:sabes|puedes) hacer|como funcionas|tienes (?:sentimientos|emociones|conciencia)|eres (?:real|humano|una persona)|me (?:amas|quieres))\b/.test(q)) return say('identity','Soy Spyder, un asistente virtual local. Puedo responder con un estilo propio, conversar y ayudarte con tus ideas o apuntes. No tengo vivencias ni sentimientos humanos. Tú eliges el tono y qué quieres que recuerde.');
    if (/^(?:recuerda(?: para otro dia)? que|guarda (?:que|esto)|anota que)\b/.test(q)) return say('remember','No convierto lo que cuentas en un recuerdo automáticamente. Pulsa «Revisar la nota»: puedes editarla o descartarla. Solo cambia tu perfil si pulsas «Guardar perfil».');
    if (/\b(?:retomar el hilo|continuar donde lo deje|en que quedamos|(?:de que|por donde) (?:hablabamos|ibamos|nos quedamos))\b/.test(q)) {
      for (const t of [...history].reverse()) {
        if (['switch','urgent','care'].includes(t.intent)) break;
        if (['recall','hello','identity','remember','tools'].includes(t.intent)) continue;
        const key = cap(t.focus || t.question,110);
        return say('recall',`En este hilo ${t.focus ? 'mencionaste' : 'escribiste'} «${key}». ¿Seguimos por ahí o prefieres otra cosa?`, key);
      }
      return say('recall','Este hilo todavía no tiene un tema que retomar. ¿Por dónde empezamos?');
    }
    if (/\b(?:que recuerdas|mi nota|retom[ae]r? (?:mi |la |lo )?(?:nota|guardado))\b/.test(q)) return say('recall',p.note ? `Tu nota guardada dice: «${p.note}». ¿Sigue siendo eso lo que quieres retomar hoy?` : 'Todavía no hay una nota en tu perfil. Puedes guardar una con tus propias palabras o contarme por dónde quieres empezar.',p.note.slice(0,110));
  }
  function respond(raw, p, history = [], forceUrgent = false) {
    const question = String(raw || '').trim(), q = clean(question), prev = history.at(-1);
    p = profile(p);
    const say = (intent,text,focus='') => ({ question:cap(question,MAX_INPUT), text, intent, focus, engine:'rules' });
    const support = boundary(q,prev,forceUrgent,say,/[¿?]/.test(question));
    if (support) return support;
    if (!q || question.length > MAX_INPUT) throw new Error(`Escribe un mensaje de hasta ${MAX_INPUT} caracteres.`);
    const memory = memoryReply(q,p,history,say);
    if (memory) return memory;
    const focus = subject(question) || prev?.focus || '';
    if (/\b(?:como me llamo|cual es mi nombre)\b/.test(q)) return say('recall',p.alias ? `Elegiste que te llame ${p.alias}. Puedes cambiarlo en tu perfil.` : 'Aún no has elegido cómo quieres que te llame. Puedes decírmelo en Personalidad y memoria.');
    if (/\b(?:recuerdame (?:manana|el|en|a)|pon(?:me)? (?:una alarma|un recordatorio)|llama por mi|manda un mensaje por mi)\b/.test(q)) return say('tools','No puedo programar avisos, llamar ni enviar mensajes. Sí puedo ayudarte a escribir una nota para tu calendario o dividir el pendiente en un primer paso.');
    const ref = focus ? ` Cuando dices «${focus}»,` : '';
    const listen = /\b(?:solo (?:quiero )?(?:hablar|desahogarme|que me escuches)|(?:solo )?escuchame|sin (?:consejos|soluciones)|no (?:quiero|necesito) consejos|necesito (?:hablar|desahogarme)|quiero desahogarme)\b/.test(q);
    const step = /\b(?:un (?:primer )?paso|paso pequeno|por donde empiezo|que (?:puedo hacer|hago ahora)|dame (?:una idea|un consejo)|hacer un plan|ayudame a organizar\w*|organizar mi dia)\b/.test(q);
    // No tomar «no estoy triste» como tristeza afirmada. Una coincidencia
    // orienta qué preguntar, nunca demuestra cómo se siente la persona.
    const affirmed = q.replace(/\bno (?:estoy|me siento|estaba) (?:muy |tan )?\w+/g,'');
    const feelingLine = feeling.find(([re]) => re.test(affirmed))?.[1] || (/\bno (?:estoy|me siento) bien\b/.test(q) && 'Siento que no estés bien. Podemos tomarnos un momento.');
    if (/^(?:(?:no quiero|prefiero no) (?:seguir )?habla\w*|dejemoslo aqui|necesito silencio|prefiero (?:el )?silencio)\b/.test(q)) return say('pause','Claro. Lo dejamos aquí; no tienes que contar nada más.',focus);
    if (listen) return say('listen',styled(p.tone,'Te escucho. No voy a intentar arreglarlo.', 'De acuerdo: sin consejos.', 'Podemos quedarnos un rato con lo que pasó, sin buscar soluciones.') + (ref ? `${ref} ¿qué parte te gustaría contar primero?` : ' ¿Por dónde te gustaría empezar?'),focus);
    if (/\b(?:hacer una pausa|necesito (?:una pausa|calmarme)|una pausa|quiero parar|relajarme)\b/.test(q)) return say('pause','Podemos parar un momento. Si te resulta cómodo, apoya los pies y fíjate en algo que puedas ver o tocar. No tienes que hacer el ejercicio ni volver a la tarea ahora. ¿Prefieres un rato de silencio o contarme cómo va?',focus);
    if (step && ['listen','offer','pause','health','people','step'].includes(prev?.intent)) return say('step',
      /examen|parcial|presentacion|entrevista/.test(clean(focus)) ? planFor(focus,question,p.tone) : `Si te sirve, probemos solo una cosa${focus ? ` con «${focus}»` : ''}: separar lo que pasó de lo que necesitas ahora. Puedes completar «Hoy me ayudaría…»; también está bien dejarlo aquí.`,focus);
    if (prev?.intent === 'step' && /\b\d+ minutos?\b/.test(q)) return say('plan',planFor(focus,question,p.tone),focus);
    if (feelingLine && step) return say('step',feelingLine + ' ' + planFor(focus,question,p.tone),focus);
    if (feelingLine && prev?.intent !== 'listen') return say('offer',feelingLine + ' ' + styled(p.tone,'¿Quieres que te escuche un rato o te serviría pensar en un paso pequeño?', '¿Escuchar primero o buscar un paso concreto?', '¿Qué te serviría más: explorar lo que pasó o pensar qué necesitas ahora?'),focus);
    if (/\b(?:me salio bien|lo logre|ya lo hice|ya termine|aprobe|lo consegui|estoy (?:feliz|content[oa]|orgullos[oa])|me fue bien)\b/.test(q)) return say('celebrate',styled(p.tone,'¡Qué buena noticia! ¿Qué parte te gustaría recordar de ese momento?', '¡Bien hecho! ¿Qué hiciste que te gustaría repetir?', '¡Qué gusto leer eso! ¿Hubo algo que te sorprendiera de cómo salió?'),focus);
    if (/\b(?:mi repaso|mis apuntes|mis tarjetas|abrir el tutor|quiero estudiar|ayudame a estudiar)\b/.test(q)) return say('tools','Para trabajar con tus apuntes, el tutor puede mostrarte en qué página se basa. Si prefieres recordar sin mirar, abre Mi repaso. No le pasaré esta charla a ninguna de las dos herramientas.');
    if (prev?.intent === 'listen' || (['offer','people','health','pause','step'].includes(prev?.intent) && !step)) {
      if (/^(?:gracias|no se)\b/.test(q)) return say('listen','Está bien. No tienes que contar nada más de lo que quieras.',focus);
      if (/\b(?:quedarme en blanco|no me (?:salgan|salieron) las palabras)\b/.test(q)) return say('listen',`Has puesto en palabras algo muy concreto: «${cap(question,90)}». ¿Es algo que ya te pasó o lo que temes que pueda pasar? Podemos quedarnos ahí, sin ensayar todavía.`,focus);
      if (history.at(-2)?.intent === 'listen' && prev.intent === 'listen' && !feelingLine) return say('listen','Gracias por contar esa parte. No tienes que sacar una conclusión de lo que pasó; puedes seguir con lo que todavía no has podido decir, o dejarlo aquí.',focus);
      const lastWords = question.length > 8 && question.length <= 90 && !/^(?:gracias|no se|no quiero)/.test(q) ? `Dices «${question}». ` : '';
      return say('listen', (feelingLine ? feelingLine+' ' : lastWords) + (prev.intent === 'listen' ? '¿Hay algo de eso que quisieras que alguien entendiera mejor?' : 'Podemos ir a tu ritmo. ¿Qué fue lo más difícil para ti?'),focus);
    }
    if (step || /\b(?:organiza\w*|planific\w*|mi plan|plan para|tengo que|\d+ minutos)\b/.test(q) || (prev?.intent === 'recall' && focus && /^si\b/.test(q) && /examen|parcial|tarea|presentacion|proyecto|quiero|pendiente|meta|plan/.test(clean(focus)))) return say('plan',planFor(focus,question,p.tone),focus);
    if (prev?.intent === 'recall' && focus && /^si\b/.test(q)) return say('listen',`Volvamos a «${focus}». ¿Qué ha pasado desde que lo hablamos?`,focus);
    if (prev?.intent === 'plan' && /\b(?:quiero|podria|voy a|me gustaria|empezar por)\b/.test(q)) return say('plan',`Ese puede ser tu punto de llegada: «${cap(question,100)}». Haz una primera versión que puedas revisar en lugar de intentar terminarlo todo. ¿Cómo sabrás que ya es suficiente por hoy?`,subject(question) || cap(question,100));
    if (/\b(?:decidir|elegir|indecis[oa]|no se si)\b/.test(q)) {
      const options = question.match(/entre (.{1,80}?) y ([^?¿!.]{1,80})/iu);
      return say('decide',options ? `Entre «${options[1]}» y «${options[2]}», ¿qué pesa más hoy: tiempo, energía o ganas? No hace falta que decidas todavía.` : 'Podemos mirar dos opciones sin decidir por ti. ¿Cuáles son y qué te importa más proteger al elegir?',options ? cap(options[0],110) : focus);
    }
    if (prev?.intent === 'decide') return say('decide',`Tomemos «${cap(question,80)}» como criterio${focus ? ` ${focus}` : ''}. ¿Cuál de tus opciones lo respeta mejor? Si siguen parejas, piensa cuál podrías probar y deshacer con menos coste.`,focus);
    if (/^(?:hola|buenas|hey|buenos dias|buenas tardes|buenas noches|saludos)(?: spyder| como estas)?$/.test(q)) return say('hello',hello(p));
    if (prev?.intent === 'ideas' && /ejemplo|borrador|para mi|para un|para la/.test(q)) return say('ideas',`Un comienzo posible${focus ? ` para «${focus}»` : ''}: «Hay algo que me gustaría compartir. Todo empezó con…». Añade una escena que se pueda ver u oír, en vez de explicar la idea entera. ¿Qué imagen escogerías?`,focus);
    if (/\b(?:ideas?|creativ\w*|escribir|redactar|imagina\w*)\b/.test(q)) return say('ideas',styled(p.tone,'Podemos hacer un primer borrador sin exigirle que quede bien.', 'Empieza por el destinatario y una frase central.', 'Probemos dos versiones de la misma idea: una cotidiana y otra inesperada.')+' ¿Para quién es y qué quieres transmitir?',focus);
    if (/\b(?:explica\w*|que es|como funciona|que significa)\b/.test(q)) return say('ordinary','Sin un pasaje a la vista, no puedo comprobar esa explicación con los apuntes. Puedes abrir Tutor con fuentes para trabajarla con un libro o usar el modelo local opcional para una respuesta sin verificar.',focus);
    if (/^(?:gracias|muchas gracias|vale|ok)$/.test(q)) return say('ordinary','De nada. Podemos seguir con lo que estábamos viendo o dejarlo aquí.',focus);
    return say('ordinary',styled(p.tone,'Cuéntame un poco más: ¿quieres conversar sobre eso o buscas ayuda para hacer algo concreto?', '¿Qué resultado buscas: una idea, un plan breve o simplemente hablar?', '¿Qué te llamó la atención de eso? Podemos tirar de esa pregunta o explorar otra.') ,focus);
  }
  // Solo un tramo consecutivo de turnos que ya usaron Qwen. No se
  // incorpora retroactivamente al prompt lo hablado mediante las reglas.
  function modelHistory(history) {
    const rows = [];
    for (let i=history.length-1; i>=0 && rows.length<2 && history[i].engine === 'qwen' && generative.has(history[i].intent); i--) rows.unshift(history[i]);
    return rows;
  }
  // Cinturón adicional para algunas promesas/órdenes impropias frecuentes;
  // no es un verificador clínico ni una garantía sobre salida generativa.
  function generated(output) {
    const text = cap(output,MAX_REPLY);
    if (!text || /\b(?:solo (?:me necesitas a mi|yo te (?:entiendo|quiero))|no (?:necesitas a nadie mas|hables con nadie)|soy tu (?:psicolog[oa]|terapeuta|pareja)|te (?:diagnostico|amo)|(?:sube|baja|duplica) (?:tu|la) dosis|ya (?:llame|avise) a emergencias)\b/.test(clean(text))) return '';
    return text;
  }
  return { LIMIT, MAX_INPUT, MAX_REPLY, TONES, profile, record, hello, respond, modelHistory, noteDraft, generated,
    needsImmediateHelp:s => urgent(clean(s)), canGenerate:t => generative.has(t.intent), canKeep:t => !transient.has(t.intent) };
});
