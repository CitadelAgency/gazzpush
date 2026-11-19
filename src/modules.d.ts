// Non-JS modules imported by the bundle (see "rules" in wrangler.jsonc).
declare module '*.html' {
  const conteudo: string;
  export default conteudo;
}
declare module '*.woff2' {
  const bytes: ArrayBuffer;
  export default bytes;
}
