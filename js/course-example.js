// Material didáctico adaptado, no dictámenes de un docente. Ver docs/fuentes/CARPENTRIES-LICENSE.md.
(function (root) {
  const bank = {
    format: 'spyder-course-v1', subject: 'Programación inicial con Python',
    attribution: 'Adaptación al español de preguntas y soluciones de Programming with Python, Software Carpentry. © The Carpentries (https://carpentries.org/). Pasajes, ejemplos y explicaciones abreviados o reformulados para esta comparación; sin aval del curso.',
    license: 'Material didáctico: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Ejemplos de código: MIT.',
    source: 'https://github.com/swcarpentry/python-novice-inflammation/tree/58e71d5ced80d5423edb186c9ebe6dd462146d66/episodes',
    items: [
      {
        id: 'variables', reference: '01-intro.md · Check Your Understanding', target: 'Reasignación de variables',
        passage: 'Una reasignación cambia el valor asociado al nombre que aparece a la izquierda del signo igual.',
        question: 'Si masa = 47.5 y edad = 122, ¿qué valores quedan tras ejecutar masa = masa * 2.0 y luego edad = edad - 20?',
        explanation: 'La primera instrucción usa el valor anterior de masa y guarda 95.0 en ese nombre, sin cambiar edad. La segunda resta 20 a 122: al final masa vale 95.0 y edad vale 102.'
      },
      {
        id: 'indices', reference: '04-lists.md · Slicing From the End', target: 'Índices negativos',
        passage: 'Los índices negativos permiten contar posiciones desde el final de una secuencia sin conocer su longitud.',
        question: '¿Cómo obtendrías los cuatro últimos caracteres de una cadena llamada fecha sin saber cuánto mide?',
        explanation: 'fecha[-4:] empieza en el cuarto carácter contado desde el final e incluye los que siguen hasta terminar. Si hay menos de cuatro, devuelve toda la cadena.'
      },
      {
        id: 'repeticion', reference: '04-lists.md · Overloading', target: 'Repetición frente a multiplicación numérica',
        passage: 'La multiplicación de una lista por un entero positivo concatena copias de la secuencia original.',
        question: 'Si cuentas = [2, 4, 6, 8, 10], ¿cuál es el resultado de cuentas * 2? ¿Se duplica cada número?',
        explanation: 'Devuelve [2, 4, 6, 8, 10, 2, 4, 6, 8, 10]. Se repite la lista en el mismo orden; no se calcula el doble de cada elemento.'
      },
      {
        id: 'limite', reference: '05-loop.md · From 1 to N', target: 'Límite superior excluido',
        passage: 'El segundo argumento de range indica el límite superior excluido de la sucesión.',
        question: '¿Qué dos argumentos le darías a range para que un bucle imprima 1, 2 y 3, cada uno una vez?',
        explanation: 'range(1, 4) comienza en 1, avanza de uno en uno y se detiene antes del 4. range(1, 3) no llegaría a imprimir el 3.'
      },
      {
        id: 'bucle', reference: '05-loop.md · Understanding the loops', target: 'Una iteración por carácter',
        passage: 'Al recorrer una cadena con un bucle for se ejecuta una iteración por cada carácter de la cadena.',
        question: 'En for letra in "oxygen", el cuerpo imprime letra. ¿Cuántas veces se ejecuta el cuerpo y por qué?',
        explanation: 'Se ejecuta seis veces, una por cada carácter de la cadena. La variable del bucle cambia de valor en cada vuelta; no se imprime la palabra entera seis veces.'
      },
      {
        id: 'acumulador', reference: '05-loop.md · Summing a list', target: 'Acumulador y valor inicial',
        passage: 'Un acumulador de suma empieza en cero y conserva el total parcial entre las vueltas de un bucle.',
        question: '¿Cómo sumarías con un bucle los números de [124, 402, 36] para imprimir solo el resultado final?',
        explanation: 'Antes del bucle asigna total = 0. Por cada número actualiza total = total + número: los totales son 124, 526 y 562. Imprime 562 al salir, sin reiniciar total dentro del bucle.'
      }
    ]
  };
  root.NCCourseExample = bank;
  if (typeof module !== 'undefined' && module.exports) module.exports = bank;
})(typeof window !== 'undefined' ? window : globalThis);
