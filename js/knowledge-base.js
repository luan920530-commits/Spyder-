/**
 * Base local pequeña y curada; no es un modelo generativo ni una fuente jurídica
 * actualizada automáticamente. Los resúmenes son propios y enlazan a sus fuentes.
 * Nunca se agrega a los documentos, a la bóveda ni al índice privado del usuario.
 */
(function (root, factory) {
  const U = (typeof require === 'function' && typeof module !== 'undefined') ? require('./util.js') : root.NCUtil;
  const R = (typeof require === 'function' && typeof module !== 'undefined') ? require('./retrieval.js') : root.NCRetrieval;
  const E = (typeof require === 'function' && typeof module !== 'undefined') ? require('./education-knowledge.js') : root.NCEducationKnowledge;
  const api = factory(U, R, E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NCKnowledge = api;
})(typeof window !== 'undefined' ? window : globalThis, function (U, R, E) {
  'use strict';
  const REVIEWED = '2026-11-16';
  // Revisión independiente de las fichas de derecho civil; no cambia la fecha
  // del resto de la base cuando se actualice este tema.
  const PENAL_REVIEWED = '2026-11-16';
  const refs = {
    constitution: ['Constitución Política de Colombia, arts. 25 y 53', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=4125'],
    reform: ['Ley 2466 de 2025, reforma laboral', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=260676'],
    laborCode: ['Código Sustantivo del Trabajo, art. 168', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=199983'],
    hours: ['Ley 2101 de 2021, arts. 2–4', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=166506'],
    publicHours: ['Función Pública, Concepto 050621 de 2026', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=274736'],
    risks: ['Ley 1562 de 2012, arts. 3 y 4', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=48365'],
    decree: ['Decreto 1072 de 2015, cap. 2.2.4.6', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=72173'],
    standards: ['Resolución 0312 de 2019, estándares mínimos', 'https://normograma.mintic.gov.co/mintic/compilacion/docs/resolucion_mtra_0312_2019.htm'],
    committee: ['Resolución 3461 de 2025, comité de convivencia', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=262916'],
    civilPenalty: ['Código Civil colombiano, arts. 1592 y 1593 · Normograma de Cancillería', 'https://www.cancilleria.gov.co/sites/default/files/Normograma/docs/codigo_civil_pr049.htm'],
    penaltyFunctions: ['Consejo de Estado, Sala de Consulta, Concepto 1748 de 2006', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=21359'],
    biology: ['Encyclopaedia Britannica, ciencias de la vida', 'https://www.britannica.com/science/life-sciences'],
    genome: ['NIH/NHGRI, glosario de genética', 'https://www.genome.gov/es/genetics-glossary'],
    photosynthesis: ['NASA, qué necesita la vida para sobrevivir', 'https://science.nasa.gov/astrobiology/learning-resources/alp/what-does-life-need-for-survival/'],
    water: ['USGS, condensación y ciclo del agua', 'https://www.usgs.gov/water-science-school/science/condensation-and-water-cycle'],
    physics: ['NASA, leyes de Newton', 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/newtons-laws-of-motion/'],
    chemIntro: ['American Chemical Society, qué es la química', 'https://www.acs.org/education/celebrating-chemistry-editions/2021-ncw.html'],
    chemistry: ['IUPAC, Gold Book: elemento químico', 'https://goldbook.iupac.org/terms/view/C01022/plain'],
    atom: ['IUPAC, Gold Book: átomo', 'https://goldbook.iupac.org/html/A/A00493.html'],
    molecule: ['IUPAC, Gold Book: molécula', 'https://goldbook.iupac.org/terms/view/M04002'],
    math: ['Mathematics LibreTexts, ecuaciones y rectas', 'https://math.libretexts.org/Courses/Hope_College/Math_125%3A_Hope_College/01%3A_Algebra_Essentials/1.08%3A_Linear_Equations_in_One_Variable'],
    percent: ['Mathematics LibreTexts, porcentajes', 'https://math.libretexts.org/Courses/Western_Oregon_University/Math_110:_Applied_College_Mathematics/02:_Numbers_in_Context/2.03:_Percents'],
    exponent: ['Mathematics LibreTexts, funciones exponenciales', 'https://math.libretexts.org/Courses/Cosumnes_River_College/Math_372%3A_College_Algebra_for_Calculus_(2e)/04%3A_Exponential_and_Logarithmic_Functions/4.01%3A_Exponential_Functions'],
    js: ['MDN, guía de JavaScript', 'https://developer.mozilla.org/es/docs/Web/JavaScript/Guide'],
    promise: ['MDN, promesas en JavaScript', 'https://developer.mozilla.org/es/docs/Web/JavaScript/Guide/Using_promises'],
    fetch: ['MDN, uso de Fetch', 'https://developer.mozilla.org/es/docs/Web/API/Fetch_API/Using_Fetch'],
    dom: ['MDN, Node.textContent', 'https://developer.mozilla.org/es/docs/Web/API/Node/textContent'],
    cssbox: ['MDN, modelo de caja CSS', 'https://developer.mozilla.org/es/docs/Web/CSS/Guides/Box_model/Introduction'],
    flex: ['MDN, Flexbox', 'https://developer.mozilla.org/es/docs/Learn_web_development/Core/CSS_layout/Flexbox'],
    grid: ['MDN, conceptos básicos de Grid', 'https://developer.mozilla.org/es/docs/Web/CSS/Guides/Grid_layout/Basic_concepts'],
    php: ['Manual PHP, integrar PHP en HTML', 'https://www.php.net/manual/es/language.basic-syntax.phpmode.php'],
    pdo: ['Manual PHP, consultas preparadas PDO', 'https://www.php.net/manual/es/pdo.prepared-statements.php'],
    escape: ['Manual PHP, htmlspecialchars', 'https://www.php.net/manual/es/function.htmlspecialchars.php']
  };
  // ID, categoría, título, resumen, palabras para encontrarlo, referencia,
  // jurídica y fecha opcional de revisión independiente.
  const raw = [
    ['constitucion-trabajo', 'Colombia y legislación laboral', 'Constitución: derecho al trabajo', 'El artículo 25 de la Constitución colombiana protege el trabajo en condiciones dignas y justas. El artículo 53 enumera principios laborales mínimos, entre ellos igualdad de oportunidades y primacía de la realidad.', 'constitucion colombia derechos trabajo dignidad principios laboral 25 53', 'constitution', true],
    ['reforma-2466', 'Colombia y legislación laboral', 'Ley 2466 de 2025: reforma laboral', 'La Ley 2466 de 2025 modifica parcialmente el Código Sustantivo del Trabajo y otras normas para el trabajo digno y decente. Sus disposiciones y fechas de aplicación deben examinarse artículo por artículo.', 'reforma laboral colombia ley 2466 trabajo codigo sustantivo cst', 'reform', true],
    ['jornada-42', 'Colombia y legislación laboral', 'Jornada laboral ordinaria de 42 horas', 'La Ley 2101 de 2021 prevé una reducción gradual hasta 42 horas semanales; la etapa final empezó el 15 de julio de 2026 para las relaciones regidas por el Código Sustantivo del Trabajo. Hay excepciones y otros regímenes; no se debe asumir que rige igual para empleados públicos.', 'jornada horario semanal semana horas 42 ley 2101 colombia trabajo laboral', 'hours', true],
    ['jornada-publica', 'Colombia y legislación laboral', 'Jornada: empleados públicos y trabajadores oficiales', 'El régimen de jornada de empleados públicos y trabajadores oficiales debe analizarse por separado del régimen de relaciones particulares. Función Pública explica esta distinción en su Concepto 050621 de 2026; consulta la norma y el vínculo concreto.', 'jornada sector publico servidores empleado trabajador oficial horario colombia', 'publicHours', true],
    ['nocturno', 'Colombia y legislación laboral', 'Trabajo nocturno desde las 7 p. m.', 'El artículo 10 de la Ley 2466 de 2025 define la franja nocturna entre las 19:00 y las 6:00 y dispone su aplicación seis meses después de la sanción. La remuneración depende de la jornada, el régimen y las excepciones aplicables.', 'nocturna nocturno noche horas recargo horario jornada colombia 19 7 2466', 'reform', true],
    ['recargo-nocturno', 'Colombia y legislación laboral', 'Recargo por trabajo nocturno', 'En las relaciones regidas por el Código Sustantivo del Trabajo, el artículo 168 prevé como regla un recargo del 35 por ciento sobre el valor del trabajo diurno para el trabajo nocturno. Hay excepciones y regímenes distintos; las horas extras tienen reglas diferentes.', 'recargo nocturno noche porcentaje 35 colombia trabajo laboral', 'laborCode', true],
    ['descanso-recargo', 'Colombia y legislación laboral', 'Recargo por descanso obligatorio: transición', 'La Ley 2466 de 2025 prevé un aumento gradual del recargo por trabajo en día de descanso obligatorio: 80% desde julio de 2025, 90% desde julio de 2026 y aplicación plena desde julio de 2027. Revisa el artículo y las condiciones del caso.', 'dominical festivo descanso obligatorio recargo 90 2026 2027 laboral', 'reform', true],
    ['horas-extras', 'Colombia y legislación laboral', 'Horas extras y trabajo suplementario', 'El artículo 13 de la Ley 2466 de 2025 establece como regla un máximo de dos horas extras diarias y doce semanales, con excepciones para sectores indicados en la norma. El artículo 12 exige un registro del trabajo suplementario.', 'horas extra extras suplementario limite diario semanal registro 2466', 'reform', true],
    ['debido-proceso', 'Colombia y legislación laboral', 'Debido proceso disciplinario laboral', 'El artículo 7 de la Ley 2466 de 2025 contempla garantías de defensa y debido proceso para sanciones disciplinarias laborales y reglas especiales para ciertos empleadores. El procedimiento y sus excepciones deben verificarse en el texto oficial.', 'debido proceso disciplinario sanciones descargos defensa empleado 2466', 'reform', true],
    ['contrato', 'Colombia y legislación laboral', 'Contrato laboral y modalidades', 'La Ley 2466 de 2025 regula el contrato a término fijo y el de obra o labor determinada, con requisitos escritos y reglas específicas. La modalidad, su duración y las consecuencias dependen de las condiciones y de la norma aplicable.', 'contrato trabajo fijo indefinido obra labor duracion 2466', 'reform', true],
    ['clausula-penal', 'Derecho civil colombiano', 'Cláusula penal: definición', 'En Colombia es un pacto accesorio de dar o hacer algo cuando se incumple o retrasa la obligación principal. Según el artículo 1592 del Código Civil, su finalidad es asegurar el cumplimiento. Es una pena contractual, no un castigo por un delito. Ejemplo: pactar un pago por demora en una obra.', 'clausula penal pena contractual convencional pacto incumplimiento demora retardo finalidad definicion que es para que sirve 1592 codigo civil colombia', 'civilPenalty', true, PENAL_REVIEWED],
    ['clausula-penal-funciones', 'Derecho civil colombiano', 'Cláusula penal: funciones y finalidad', 'En Colombia, según el Consejo de Estado, la cláusula penal por regla general estima anticipadamente los perjuicios por incumplimiento o retraso. Puede cumplir una función de apremio o de garantía si hay pacto expreso e inequívoco; la garantía alude al compromiso de un tercero.', 'clausula penal pena contractual convencional finalidad funcion proposito para que sirve indemnizacion tasacion perjuicios incumplimiento mora retardo apremio garantia pacto colombia', 'penaltyFunctions', true, PENAL_REVIEWED],
    ['sst-basica', 'Seguridad y salud en el trabajo', 'Seguridad y salud en el trabajo: SST', 'La seguridad y salud en el trabajo busca prevenir lesiones y enfermedades causadas por las condiciones laborales y proteger la salud de quienes trabajan. El SG-SST organiza la gestión de esos peligros y riesgos.', 'sst salud seguridad trabajo ocupacional prevencion', 'decree', true],
    ['sst-sistema', 'Seguridad y salud en el trabajo', 'SG-SST: sistema de gestión', 'El Sistema de Gestión de Seguridad y Salud en el Trabajo, SG-SST, es un proceso de mejora continua que busca anticipar, reconocer, evaluar y controlar riesgos para la seguridad y salud en el trabajo. El Decreto 1072 de 2015 regula su organización.', 'sst sg-sst sistema gestion seguridad salud trabajo colombia decreto 1072', 'decree', true],
    ['sst-peligro', 'Seguridad y salud en el trabajo', 'Peligro en SST', 'En seguridad y salud en el trabajo, un peligro es una fuente, situación o acto con potencial de causar daño a la salud, equipos o instalaciones. Identificar el peligro es diferente de evaluar el riesgo.', 'peligro identificacion seguridad salud trabajo sst', 'decree', true],
    ['sst-riesgo', 'Seguridad y salud en el trabajo', 'Riesgo laboral y evaluación en SST', 'El riesgo combina la probabilidad de exposición o de un evento peligroso con la severidad del daño posible. Su evaluación ayuda a priorizar controles, teniendo en cuenta las condiciones reales de trabajo.', 'riesgo laboral ocupacional probabilidad severidad evaluacion valoracion sst peligro', 'decree', true],
    ['sst-controles', 'Seguridad y salud en el trabajo', 'Jerarquía de controles en SST', 'El Decreto 1072 ordena considerar la eliminación, sustitución, controles de ingeniería, controles administrativos y equipos de protección personal. Los EPP no sustituyen por sí solos la evaluación y otros controles pertinentes.', 'jerarquia controles eliminar sustitucion ingenieria administrativo epp sst proteccion', 'decree', true],
    ['sst-phva', 'Seguridad y salud en el trabajo', 'Ciclo PHVA del SG-SST', 'El ciclo PHVA comprende planear, hacer, verificar y actuar. En el SG-SST sirve para organizar el seguimiento y la mejora continua de la prevención y el control de peligros y riesgos.', 'phva planear hacer verificar actuar ciclo mejora continua sst', 'decree', true],
    ['sst-accidente', 'Seguridad y salud en el trabajo', 'Accidente de trabajo y riesgos laborales', 'La Ley 1562 de 2012 define el accidente de trabajo en relación con el trabajo y sus posibles consecuencias. La calificación de un caso concreto depende de los hechos y de las disposiciones aplicables.', 'accidente trabajo lesion laboral riesgos arl ley 1562', 'risks', true],
    ['sst-enfermedad', 'Seguridad y salud en el trabajo', 'Enfermedad laboral', 'La Ley 1562 de 2012 define la enfermedad laboral asociada a la exposición a factores de riesgo inherentes a la actividad o al medio de trabajo. El origen de un caso requiere evaluación y calificación según las reglas aplicables.', 'enfermedad laboral ocupacional exposicion origen calificacion sst', 'risks', true],
    ['sst-estandares', 'Seguridad y salud en el trabajo', 'Estándares mínimos SG-SST', 'La Resolución 0312 de 2019 establece estándares mínimos del SG-SST. Los requisitos aplicables varían según factores como el tamaño de la empresa y su clase de riesgo; consulta el texto y sus modificaciones.', 'resolucion 0312 312 2019 estandares minimos sg-sst evaluacion', 'standards', true],
    ['convivencia', 'Seguridad y salud en el trabajo', 'Comité de convivencia laboral', 'La Resolución 3461 de 2025 regula la conformación y funcionamiento del Comité de Convivencia Laboral y derogó las resoluciones 652 y 1356 de 2012. Su función es preventiva, orientadora, conciliadora y canalizadora; el comité no determina por sí mismo si existe acoso laboral.', 'comite convivencia laboral acoso 3461 2025 652 1356 queja', 'committee', true],
    ['bio-general', 'Biología', 'Biología: estudio de la vida', 'La biología estudia los seres vivos, su organización, funcionamiento, desarrollo y relaciones con el entorno. La genética es una de sus áreas y estudia la herencia y la información biológica.', 'biologia vida seres vivos ciencia organismos genetica', 'biology', false],
    ['bio-celula', 'Biología', 'Célula y material genético', 'La célula es una unidad básica de los seres vivos. El material genético contiene instrucciones que intervienen en su funcionamiento; las células pueden presentar organizaciones distintas según el organismo.', 'biologia celula celulas seres vivos vida organismo', 'genome', false],
    ['bio-adn', 'Biología', 'ADN y genes', 'El ADN almacena información genética en la secuencia de sus bases. Un gen es una región de ADN cuya información puede participar en la producción de un producto funcional, como una proteína o un ARN.', 'adn dna gen genes genetica herencia secuencia proteina', 'genome', false],
    ['bio-cromosoma', 'Biología', 'Cromosomas y genoma', 'Los cromosomas organizan el ADN con proteínas. El genoma es el conjunto de información genética de un organismo; en humanos incluye ADN nuclear y mitocondrial.', 'cromosoma cromosomas genoma adn genetica nucleo', 'genome', false],
    ['bio-mitosis', 'Biología', 'Mitosis y división celular', 'La mitosis separa las copias de los cromosomas durante la división de una célula. Es importante distinguirla de la meiosis, que interviene en la formación de células sexuales.', 'mitosis division celular cromosoma meiosis reproduccion', 'genome', false],
    ['bio-proteina', 'Biología', 'Proteínas y aminoácidos', 'Las proteínas están formadas por una o más cadenas de aminoácidos. Su secuencia y estructura contribuyen a determinar sus funciones en el organismo.', 'proteina aminoacidos biologia enzima gen', 'genome', false],
    ['bio-fotosintesis', 'Biología', 'Fotosíntesis en plantas y algas', 'En la fotosíntesis oxigénica, plantas, algas y algunas bacterias aprovechan la luz para producir azúcares a partir de dióxido de carbono y agua, y liberan oxígeno. La energía queda almacenada en compuestos químicos.', 'fotosintesis planta alga luz solar agua dioxido carbono oxigeno azucar', 'photosynthesis', false],
    ['ciencia-agua', 'Ciencias', 'Ciclo del agua', 'El ciclo del agua incluye evaporación, condensación y precipitación, además de transporte, infiltración y escorrentía. La condensación convierte vapor de agua en agua líquida.', 'ciclo agua evaporacion condensacion lluvia precipitacion', 'water', false],
    ['ciencia-newton', 'Ciencias', 'Segunda ley de Newton', 'Para un objeto de masa constante, la fuerza neta es igual a masa por aceleración: F = m × a. Fuerza y aceleración tienen dirección además de magnitud.', 'fisica fuerza masa aceleracion newton movimiento segunda ley', 'physics', false],
    ['ciencia-inercia', 'Ciencias', 'Inercia y primera ley de Newton', 'Si la fuerza neta sobre un objeto es cero, su velocidad permanece constante en un marco inercial; puede estar en reposo o en movimiento rectilíneo uniforme.', 'inercia primera ley newton fuerza velocidad movimiento', 'physics', false],
    ['quimica-general', 'Química', 'Química: estudio de la materia', 'La química estudia la composición y las propiedades de la materia, así como sus transformaciones. Las sustancias pueden interactuar y transformarse mediante procesos químicos.', 'quimica materia sustancia composicion ciencia transformacion', 'chemIntro', false],
    ['quimica-atomo', 'Química', 'Átomo y elemento químico', 'Un átomo contiene un núcleo con protones y, normalmente, neutrones, rodeado por electrones. El número de protones determina el elemento químico.', 'quimica atomo proton neutron electron elemento numero atomico', 'atom', false],
    ['quimica-elemento', 'Química', 'Elementos y tabla periódica', 'Los átomos con el mismo número de protones pertenecen al mismo elemento químico. La tabla periódica organiza los elementos y permite consultar propiedades atómicas.', 'elemento quimico tabla periodica proton propiedades atomo', 'chemistry', false],
    ['quimica-molecula', 'Química', 'Moléculas y compuestos', 'Una molécula puede estar formada por átomos enlazados. Un compuesto químico contiene elementos diferentes en proporciones definidas; no toda sustancia molecular es un compuesto de elementos distintos.', 'molecula compuesto enlace quimico elemento sustancia agua', 'molecule', false],
    ['matematica-lineal', 'Matemáticas', 'Ecuación lineal y pendiente', 'Una recta puede escribirse como y = mx + b, donde m es la pendiente y b la intersección con el eje y. Entre dos puntos con distinta coordenada x, m = (y2 - y1) / (x2 - x1).', 'matematicas algebra ecuacion lineal recta pendiente funcion', 'math', false],
    ['matematica-porcentaje', 'Matemáticas', 'Porcentaje y proporción', 'Un porcentaje expresa una proporción por cada cien: 20% de una cantidad equivale a multiplicarla por 0,20. Para comparar cambios conviene especificar la cantidad de referencia.', 'matematicas porcentaje proporcion porcentaje regla tres', 'percent', false],
    ['matematica-exponente', 'Matemáticas', 'Potencias y crecimiento exponencial', 'Una potencia de base positiva representa una multiplicación repetida para exponentes enteros positivos. En un crecimiento exponencial la cantidad se multiplica por un factor constante en intervalos iguales.', 'matematicas potencia exponente exponencial crecimiento base', 'exponent', false],
    ['js-basico', 'Desarrollo web', 'JavaScript: variables y funciones', 'JavaScript permite definir variables y funciones. Ejemplo: `const doble = numero => numero * 2;` declara una función que devuelve el doble de su argumento.', 'javascript js programacion web variable funcion const', 'js', false],
    ['js-promesa', 'Desarrollo web', 'JavaScript: promesas y async', 'Una promesa representa el resultado o fallo eventual de una operación asíncrona. `async` y `await` permiten trabajar con promesas y manejar errores con `try` y `catch`.', 'javascript promesa promise async await asincrono error', 'promise', false],
    ['js-fetch', 'Desarrollo web', 'JavaScript: Fetch y HTTP', 'Fetch devuelve una promesa con una respuesta HTTP. Un estado 404 o 500 no rechaza necesariamente la promesa: comprueba `response.ok` antes de procesar el cuerpo con `response.json()`.', 'javascript fetch api http respuesta json async request', 'fetch', false],
    ['js-dom', 'Desarrollo web', 'JavaScript: DOM y textContent', 'Para insertar texto no confiable en el DOM, `elemento.textContent = valor` lo trata como texto en lugar de interpretarlo como HTML. Esto evita un vector de XSS asociado a insertar cadenas como HTML.', 'javascript dom textcontent innerhtml seguridad xss ejemplo', 'dom', false],
    ['css-caja', 'Desarrollo web', 'CSS: modelo de caja', 'El modelo de caja CSS distingue contenido, relleno, borde y margen. `box-sizing: border-box` incluye relleno y borde en el ancho y alto especificados de la caja.', 'css caja box model border-box padding margin borde', 'cssbox', false],
    ['css-flex', 'Desarrollo web', 'CSS Flexbox', 'Flexbox organiza elementos en una dimensión, como una fila o columna. Ejemplo: `display: flex; gap: 1rem;` activa un contenedor flexible con separación entre elementos.', 'css flexbox flex fila columna diseño responsive', 'flex', false],
    ['css-grid', 'Desarrollo web', 'CSS Grid', 'CSS Grid permite organizar elementos en filas y columnas. Ejemplo: `display: grid; grid-template-columns: repeat(2, 1fr);` crea dos columnas flexibles.', 'css grid rejilla cuadricula columnas filas diseño', 'grid', false],
    ['php-basico', 'Desarrollo web', 'PHP integrado con HTML', 'PHP puede incluirse en un documento HTML mediante etiquetas de apertura y cierre de PHP. El servidor procesa el código PHP antes de enviar el resultado al navegador.', 'php html servidor web sintaxis echo', 'php', false],
    ['php-pdo', 'Desarrollo web', 'PHP PDO y consultas preparadas', 'Con PDO se pueden preparar consultas SQL y enviar valores como parámetros: `$stmt = $pdo->prepare("SELECT * FROM usuarios WHERE id = ?"); $stmt->execute([$id]);`. Los identificadores y otras partes dinámicas requieren validación adicional.', 'php pdo sql consulta preparada parametros inyeccion seguridad base datos', 'pdo', false],
    ['php-escape', 'Desarrollo web', 'PHP y escape de salida HTML', 'Para mostrar texto en HTML, `htmlspecialchars($valor, ENT_QUOTES | ENT_SUBSTITUTE, "UTF-8")` convierte caracteres especiales. El escape depende del contexto de salida y no sustituye otros controles de seguridad.', 'php htmlspecialchars html escape seguridad xss salida', 'escape', false]
  ];
  const entries = raw.map(([key, category, title, text, keywords, reference, legal, reviewed = REVIEWED]) => {
    const id = `kb:${key}`, source = refs[reference], displayText = `${title}. ${text}`;
    return Object.freeze({ id, docId: id, docName: `Base local · ${source[0]}`, pageNum: null,
      origin: 'knowledge', category, title, sourceName: source[0], sourceUrl: source[1],
      reviewed, legal, keywords, sourceText: displayText,
      // Las palabras clave mejoran la búsqueda, pero no se muestran como evidencia.
      text: `${displayText} ${keywords}`, parts: [{ id, text: displayText }] });
  }).concat((E?.list() || []).map(item => {
    const displayText = `${item.title}. ${item.summary}`;
    return Object.freeze({ ...item, docId: item.id, docName: `Base local · ${item.sourceName}`,
      pageNum: null, origin: 'knowledge', sourceText: displayText,
      text: `${displayText} ${item.keywords}`, parts: [{ id: item.id, text: displayText }] });
  }));
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const index = R.rebuildFrom(entries);
  // Las consultas que nombran un proveedor no deben atribuirle fichas de otro.
  const educationIndexes = {
    aprende: R.rebuildFrom(entries.filter(entry => entry.collection === 'Aprende.org / Capacítate para el Empleo')),
    pruebat: R.rebuildFrom(entries.filter(entry => entry.collection === 'PruébaT')),
    fundacion: R.rebuildFrom(entries.filter(entry => entry.collection))
  };
  const ignored = new Set(U.tokens('explica explicar explícame define definición describir dime dice dicen menciona señala ofrece enseña enseñan trata aborda buscar consulta pregunta información ayuda ejemplo ejemplos cómo cuántas cuántos funciona funcionan quiero saber qué significa hacer usar usa utilizan código realizar aprender guía resumen resume analiza completo documento texto material materiales curso cursos clase clases capacitación capacitaciones'));
  const penaltyIds = new Set(['kb:clausula-penal', 'kb:clausula-penal-funciones']);
  const penaltyAliases = ['cláusula penal', 'pacto penal', 'pena contractual', 'pena convencional', 'pena contrato civil'].map(U.tokens);
  // Detección conservadora de algunas jurisdicciones extranjeras explícitas;
  // no es un detector exhaustivo de países ni reemplaza el aviso de régimen.
  const foreignPenaltyContext = /\b(?:mexic(?:o|an[oa]s?)|argentin[oa]s?|espan(?:a|ol(?:a|es|as)?)|peru(?:an[oa]s?)?|chile(?:n[oa]s?)?|bolivi(?:a|an[oa]s?)|brasil(?:en[oa]s?|er[oa]s?)?|uruguay[oa]s?|uruguay|paraguay[oa]s?|paraguay|venezuel(?:a|an[oa]s?)|ecuador|ecuatorian[oa]s?|panam(?:a|en[oa]s?)|cuba(?:n[oa]s?)?|guatemala|honduras|nicaragua|el\s+salvador|costa\s+rica|puerto\s+rico|republica\s+dominicana|estados\s+unidos|eeuu|estadounidenses?|reino\s+unido|union\s+europea|canada|francia|alemania|italia|portugal|extranjera?s?|extranjeros?|internacional(?:es)?)\b/;
  function isPenaltyQuery(terms, cleaned) {
    const words = new Set(terms);
    // «Penal», «pena» y «delito» también pueden referirse al derecho penal.
    // Exigir el tema compuesto o el artículo civil evita citar estas fichas
    // para preguntas sobre delitos o sobre una cláusula no identificada.
    if (foreignPenaltyContext.test(cleaned)) return false;
    return penaltyAliases.some(alias => alias.every(term => words.has(term))) ||
      (words.has('1592') && !/\bcodigo\s+penal\b/.test(cleaned));
  }
  function isBareAprendeQuery(query) {
    return /^aprende\s+(?=(?:cursos?|clases?|recursos?|catalogo|directorio|plataforma|capacitaciones?|formacion|sst|sg[\s-]*sst|epp|programacion|algoritmos?|variables?|pseudocodigo|javascript|python|datos|ia|inteligencia|machine|seguridad|ergonomia|alturas)\b)/.test(U.normalize(query || ''));
  }

  /** Búsqueda por términos: no inventa evidencia para palabras desconocidas. */
  function search(query, options = {}) {
    const original = R.parseQuery(query), normalized = U.normalize(original.cleaned);
    const bareAprende = isBareAprendeQuery(normalized);
    const asksAprende = bareAprende || /\baprende\s*\.\s*org\b|\bcapacitate\s+para\s+el\s+empleo\b/.test(normalized);
    const asksPruebat = /\bpruebat\b/.test(normalized);
    const asksFoundation = /\b(?:fundacion\s+)?carlos\s+slim\b/.test(normalized);
    const searchIndex = asksAprende && asksPruebat ? educationIndexes.fundacion :
      asksAprende ? educationIndexes.aprende : asksPruebat ? educationIndexes.pruebat : asksFoundation ? educationIndexes.fundacion : index;
    // El nombre del proveedor restringe la colección, no el contenido de la
    // ficha. Conservar los filtros explícitos y ampliar siglas cortas de código.
    const cleaned = (bareAprende ? normalized.replace(/^aprende\b/, ' ') : normalized)
      .replace(/\baprende\s*\.\s*org\b|\bcapacitate\s+para\s+el\s+empleo\b|\bpruebat\b|\b(?:fundacion\s+)?carlos\s+slim\b/g, ' ')
      .replace(/\bcodigo\s+fuente\b/g, 'codigofuente')
      .replace(/\bprogramar\b/g, 'programacion')
      .replace(/\bjs\b/g, 'javascript')
      .replace(/\bia\b/g, 'inteligencia artificial')
      .replace(/\b(?:do[\s-]+while|hacer[\s-]+mientras)\b/g, 'buclehacer')
      .replace(/\bfor\b/g, 'buclepara')
      .replace(/\bwhile\b/g, 'buclemientras');
    const queryTokens = U.tokens(cleaned);
    const parsed = { ...original, cleaned, terms: queryTokens, uniqueTerms: [...new Set(queryTokens)] };
    const significant = parsed.uniqueTerms.filter(term => !ignored.has(term));
    // «Programación» sola merece una definición; junto con un tema concreto
    // no debe impedir hallar fichas que hablan de PHP, variables, etc.
    const terms = significant.length > 1 ? significant.filter(term => term !== 'program') : significant;
    const contextIndex = R.projectExclusions(searchIndex, parsed.filters);
    if (!terms.length) return { hits: [], parsed, contextIndex, total: 0, tookMs: 0 };

    const known = terms.filter(term => searchIndex.df.has(term));
    // Si gran parte de la pregunta no aparece en la base, no basta un término
    // genérico como «seguridad» o «trabajo» para afirmar que hay respuesta.
    if (!known.length || known.length / terms.length < .65)
      return { hits: [], parsed, contextIndex, total: 0, tookMs: 0 };
    const minDf = Math.min(...known.map(term => searchIndex.df.get(term)));
    const anchors = known.filter(term => searchIndex.df.get(term) <= Math.max(2, minDf * 1.6));
    const numbers = U.words(cleaned).filter(word => /^\d{2,}$/.test(word));
    const introductoryIds = { sst: 'sst-basica', 'sg-sst': 'sst-sistema', biologi: 'bio-general', quimic: 'quimica-general',
      variabl: 'educacion-variable', algoritm: 'educacion-algoritmo',
      program: asksAprende && !asksPruebat ? 'educacion-cap-programacion' : 'educacion-programar-codificar',
      pseudocodig: asksAprende && !asksPruebat ? 'educacion-cap-pseudocodigo' : 'educacion-pseudocodigo', epp: 'educacion-epp' };
    const result = R.search(contextIndex, query, { parsed, k: entries.length, pool: entries.length, fuzzy: false, diversify: false });
    const scored = result.hits.map(hit => {
      const entry = byId.get(hit.sentence.id);
      if (!entry || (penaltyIds.has(entry.id) && !isPenaltyQuery(terms, cleaned))) return null;
      const evidence = { ...hit.sentence, text: entry.sourceText };
      // Frases y exclusiones se contrastan con el contenido visible, no con
      // palabras clave internas que no aparecen en la ficha citada.
      if (!R.passesFilters(evidence, parsed.filters) || R.containsExcluded(evidence, parsed.filters)) return null;
      const searchable = new Set(U.tokens(`${entry.title} ${entry.keywords} ${entry.sourceText}`));
      const matched = known.filter(term => searchable.has(term));
      if (!anchors.some(term => searchable.has(term)) || matched.length / terms.length < .65) return null;
      if (numbers.some(number => !U.words(entry.sourceText + ' ' + entry.keywords).includes(number))) return null;
      const title = new Set(U.tokens(entry.title));
      const titleMatches = known.filter(term => title.has(term)).length;
      const exact = U.normalize(entry.title).includes(cleaned.trim()) ? 1 : 0;
      const penaltyDefinition = terms.includes('clausul') && terms.includes('penal') &&
        (terms.length === 2 || /\b(?:que\s+(?:es|son|significa)|define|definicion)\b/.test(cleaned));
      // Consultas breves o definiciones priorizan su ficha introductoria.
      const introductory = (terms.length === 1 && introductoryIds[terms[0]] === entry.id.slice(3)) ||
        (terms.length === 2 && terms.includes('intelig') && terms.includes('artificial') && entry.id === 'kb:educacion-ia-general') ||
        (penaltyDefinition && entry.id === 'kb:clausula-penal') ? 1 : 0;
      return { hit, relevance: matched.length / terms.length + titleMatches * .35 + exact * .5 + introductory + hit.lexScore / 100 };
    }).filter(Boolean).sort((a, b) => b.relevance - a.relevance || b.hit.lexScore - a.hit.lexScore);
    const limit = Number.isFinite(options.k) ? Math.max(0, Math.floor(options.k)) : 6;
    const hits = scored.slice(0, limit).map((item, rank) => ({ ...item.hit, rank: rank + 1 }));
    return { ...result, hits, total: scored.length, contextIndex };
  }
  function get(id) { return byId.get(id) || null; }
  function info() { return { count: entries.length, educationCount: E?.info().count || 0, reviewed: REVIEWED, categories: [...new Set(entries.map(entry => entry.category))] }; }
  function list() { return entries.slice(); }
  return { search, get, info, list, isBareAprendeQuery };
});
