/* Identidad fija del archivo solicitado; no se aceptan URLs arbitrarias. */
(function (root) {
  'use strict';
  const config = Object.freeze({
    cache: 'neural-spider-qwen-v1',
    url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf',
    modelPath: 'models/qwen3/Qwen3-0.6B-Q4_K_M.gguf', // clave virtual en Cache Storage
    bytes: 396705472,
    sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
    context: 2048,
    predict: 128,
    runtime: [
      ['vendor/wllama/wllama.mjs', 273686, '4c58b5ab7dfdbda3dd74e915a38251f3928e9a07268df4e7787695787c9384b8'],
      ['vendor/wllama/wllama.wasm', 2158740, '529c780d43cb57cb9ac7ef4c42e16463afb0b2dec4ecaae9a6df8179c435fd71']
    ]
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = config;
  root.NCQwenConfig = config;
})(typeof self !== 'undefined' ? self : globalThis);
