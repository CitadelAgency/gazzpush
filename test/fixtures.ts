// Fixtures in the real format of the dogfood tenant's sources (a city hall WordPress, generic Atom).

export const RSS_CITY_HALL = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Prefeitura de Guarujá</title>
  <link>https://www.guaruja.sp.gov.br</link>
  <item>
    <title><![CDATA[Ponte da Santos Dumont será interditada para obras &#8211; veja desvios]]></title>
    <link>https://www.guaruja.sp.gov.br/ponte-santos-dumont-interditada/</link>
    <pubDate>Fri, 30 Oct 2026 14:05:00 +0000</pubDate>
    <dc:creator><![CDATA[Secom]]></dc:creator>
    <description><![CDATA[<p>A Prefeitura interdita a ponte a partir de segunda-feira.</p>]]></description>
  </item>
  <item>
    <title>Vacinação contra gripe &amp; covid no sábado</title>
    <link>https://www.guaruja.sp.gov.br/vacinacao-sabado/</link>
    <pubDate>data inválida</pubDate>
  </item>
  <item>
    <title>Item sem link é ignorado</title>
  </item>
</channel>
</rss>`;

export const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Blog do Bairro</title>
  <entry>
    <title type="html">Feira livre muda de rua em Vicente de Carvalho</title>
    <link rel="alternate" href="https://blog.exemplo.com.br/feira-muda"/>
    <updated>2026-10-29T09:30:00-03:00</updated>
  </entry>
</feed>`;

export const ARTICLE = {
  titulo: 'Ponte da Avenida Santos Dumont será interditada em Guarujá',
  texto: 'A Prefeitura de Guarujá interdita a ponte da Avenida Santos Dumont a partir de 2 de novembro de 2026. ' +
    'As obras de recuperação estrutural duram 15 dias, segundo a Secretaria de Obras. ' +
    'Motoristas que seguem para o bairro Enseada devem usar a Avenida Puglisi como desvio.',
  url: 'https://www.guaruja.sp.gov.br/ponte-santos-dumont-interditada/',
  publicadoEm: '2026-10-30T14:05:00Z',
  modificadoEm: null,
  capturadoEm: '2026-11-03T12:00:00Z',
  metodo: 'jsonld_article_body',
  sha256: 'x',
};
