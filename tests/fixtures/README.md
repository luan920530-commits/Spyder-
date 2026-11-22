# Archivos sintéticos de lectura

`pdf-cmap-multipagina.pdf` es un PDF mínimo de tres páginas creado para las pruebas; la segunda página usa el CMap predefinido `UniJIS-UCS2-H` y contiene el texto «Hola mundo. こんにちは 日本語». Las otras páginas usan Helvetica. No contiene datos de usuarios.

`pdf-fragmentos.pdf` alterna fuentes dentro de la palabra «protocolo»; permite comprobar que no se insertan espacios espurios entre los fragmentos de PDF.js. `pdf-vacio.pdf` contiene una sola página en blanco.

`pdf-protegido.pdf` es una copia sintética del documento de tres páginas protegida con la contraseña de prueba `contrasena-demo` (generada con pypdf 5.9.0); permite comprobar que la aplicación comunica la protección en lugar de atribuirla a un escaneo. Estos archivos no requieren pypdf para ejecutar las pruebas.

`personaje-novela.pdf` es una novela mínima sintética de tres páginas sobre Luna, escrita para probar la selección de personaje, la búsqueda acotada al libro y las citas de página PDF. No contiene texto de terceros ni datos personales.

`ocr-mediana.png` es una imagen con la frase «La mediana indica el valor central.» sobre fondo blanco (850 × 150, tipografía DejaVu Sans). `ocr-mixto.pdf` contiene tres páginas: texto nativo, los píxeles de esa imagen **sin capa de texto** y una página en blanco. Las pruebas ejercitan el worker OCR real; no requieren instalar fuentes ni Tesseract en el sistema.
