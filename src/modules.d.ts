// Módulos não-JS importados pelo bundle (ver "rules" no wrangler.jsonc).
declare module '*.html' {
  const conteudo: string;
  export default conteudo;
}
declare module '*.woff2' {
  const bytes: ArrayBuffer;
  export default bytes;
}
