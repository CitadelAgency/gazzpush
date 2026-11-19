// The UI's pure functions (web/src): they run in the Worker's own vitest, without a DOM.
import { describe, expect, it } from 'vitest';
import municipiosTxt from '../web/src/data/municipalities';
import { fetchMunicipalities, readMunicipalities } from '../web/src/onboarding/municipalities';
import { DEFAULT_COLORS, contraste, htmlPreview } from '../web/src/onboarding/preview';
import { htmlPreviewInvite } from '../web/src/onboarding/ctaPreview';
import {
  STEPS as ETAPAS_UI, asPosts, factsText, hour, timeScheduled, validationLine, decisionMessage, failureReason, accountName,
  noteApprove, newSince, when, summaryVisit, stepLabel, whenFuture, readyStatus, alonePosts, fromPostLink, imageName, formatLabel, profileInstagram,
  newWarning, printScale, newMessage, newMode, firstSteps, nextCollection, illustrationReason, simpleIllustration,
  waitFor, fractionWait, postedPerDay, weekLine, barsSparkline, waitLine, noteWithoutAccount, whoDecides, whoConfirms,
  productionTime, timeProductionSentence, newOutsideWarning,
  ufDoIbge, areaLabel, cityFilter, filterPerCity,
} from '../web/src/rules';
import { crc32, zipFiles } from '../web/src/zip';
import { STEPS as ETAPAS_API } from '../src/shell/queue';

describe('contrast (WCAG 2)', () => {
  it('matches the known values', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contraste('#0B5CC4', '#F7F9FA')).toBeCloseTo(5.95, 2);   // ink on paper: 6.0 in DESIGN.md §2
    expect(contraste(DEFAULT_COLORS.texto, DEFAULT_COLORS.fundo)).toBeGreaterThan(4.5);
    expect(contraste('#ffffff', '#7a8a99')).toBeLessThan(4.5);
  });
});

describe('municipality search', () => {
  const list = readMunicipalities(municipiosTxt);
  it('complete IBGE list, with a 7-digit code', () => {
    expect(list.length).toBeGreaterThan(5500);
    expect(list.every((m) => /^\d{7}$/.test(m.ibge) && m.nome && /^[A-Z]{2}$/.test(m.uf))).toBe(true);
  });
  it('ignores accents and case; those starting with the text come first; UF breaks ties', () => {
    expect(fetchMunicipalities(list, 'guaruja').map((m) => `${m.nome}/${m.uf}`)).toEqual(['Guarujá/SP', 'Guarujá do Sul/SC']);
    expect(fetchMunicipalities(list, 'guaruja sc').map((m) => m.ibge)).toEqual([expect.stringMatching(/^42/)]);
    expect(fetchMunicipalities(list, 'Guarujá · SP')[0]).toMatchObject({ ibge: '3518701' });
    expect(fetchMunicipalities(list, 'são paulo')[0]).toMatchObject({ nome: 'São Paulo', uf: 'SP' });
    expect(fetchMunicipalities(list, '   ')).toEqual([]);
    expect(fetchMunicipalities(list, 'a', 8)).toHaveLength(8);
  });
});

describe('card preview', () => {
  const base = { nome: 'Gazeta', handle: '@gazeta', cores: DEFAULT_COLORS, logo: null, local: 'Guarujá', hoje: new Date('2026-11-01T12:00:00Z') };
  it('fills the whole template, with no link and no placeholder left over', () => {
    const html = htmlPreview(base);
    expect(html).not.toMatch(/\{\{|<a\b|data:font/);
    expect(html).toContain('--bg: #1f2a24');
    expect(html).toContain('<span class="brand-name">Gazeta</span>');
    expect(html).toContain('@gazeta');
  });
  it('escapes name, @ and logo (nothing becomes HTML)', () => {
    const html = htmlPreview({ ...base, nome: '<img src=x onerror=alert(1)>', handle: '"><script>', logo: 'data:image/png;base64,AAA" onload="x' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('src="data:image/png;base64,AAA&quot; onload=&quot;x"');
  });
  it('watermark same as the render: @ in the footer without logo, logo in the corner, nothing by default', () => {
    expect(htmlPreview(base)).not.toContain('class="marca-dagua');
    expect(htmlPreview({ ...base, marcaDagua: { posicao: 'rodape', opacidade: 0.5 } }))
      .toContain('<div class="marca-dagua rodape" style="opacity:0.50" aria-hidden="true"><span>@gazeta</span></div>');
    expect(htmlPreview({ ...base, logo: 'data:image/png;base64,AAA', marcaDagua: { posicao: 'canto', opacidade: 0.3 } }))
      .toContain('<div class="marca-dagua canto" style="opacity:0.30" aria-hidden="true"><img src="data:image/png;base64,AAA" alt=""></div>');
  });
  it('reference in place of the illustration: escaped image instead of the flat background', () => {
    expect(htmlPreview(base)).toContain('class="art art-flat"');
    const html = htmlPreview({ ...base, arte: 'blob:http://x/1" onerror="y' });
    expect(html).toContain('<img class="art" src="blob:http://x/1&quot; onerror=&quot;y" alt="">');
    expect(html).not.toContain('class="art art-flat"');
  });
});

describe('CTA preview (last card)', () => {
  const base = { nome: 'Gazeta Praia', handle: '@gazeta', cores: DEFAULT_COLORS, logo: null, convite: { titulo: 'Seu bairro, com fonte.', texto: 'Manda a pauta.', acao: '' } };
  it('fills the whole cta.html with the CTA texts, with no link or placeholder', () => {
    const html = htmlPreviewInvite(base);
    expect(html).not.toMatch(/\{\{|<a\b|data:font/);
    expect(html).toContain('<h1 id="headline">Seu bairro, com fonte.</h1>');
    expect(html).toContain('<p class="support">Manda a pauta.</p>');
    expect(html).toContain('<div class="avatar">GP</div>');
    expect(html).toContain('Link no perfil · @gazeta');
  });
  it('button: its own text when there is one; empty, the title applies (as in the render)', () => {
    expect(htmlPreviewInvite(base)).toMatch(/class="main-cta">Seu bairro, com fonte\. </);
    expect(htmlPreviewInvite({ ...base, convite: { ...base.convite, acao: 'Siga' } })).toMatch(/class="main-cta">Siga </);
  });
  it('escapes the CTA texts', () => {
    const html = htmlPreviewInvite({ ...base, convite: { titulo: '<script>x</script>', texto: '"><img src=x>', acao: '' } });
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<img src=x');
  });
});

describe('queue rules (Phase D)', () => {
  const now = new Date('2026-11-01T15:00:00Z');
  it('when: D1 date in UTC, shown in São Paulo time', () => {
    expect(when('2026-11-01 14:59:40', now)).toBe('agora');
    expect(when('2026-11-01 14:55:00', now)).toBe('há 5 min');
    expect(when('2026-11-01 12:00:00', now)).toBe('há 3 h');
    expect(when('2026-11-01 03:30:00', now)).toBe('hoje, 00:30');
    expect(when('2026-11-01 02:30:00', now)).toBe('ontem, 23:30');
    expect(when('2026-10-28 12:00:00', now)).toBe('28/10');
    expect(hour('2026-11-01 02:05:00')).toBe('23:05');
  });
  it('new = after the previous visit; the first visit marks nothing as new', () => {
    const previous = Date.parse('2026-11-01T02:06:15Z');
    expect(newSince('2026-11-01 02:06:19', previous)).toBe(true);
    expect(newSince('2026-11-01 02:06:09', previous)).toBe(false);
    expect(newSince('2026-11-01 02:06:19', null)).toBe(false);
  });
  it('visit summary counts only what changed', () => {
    expect(summaryVisit({ anterior: null, prontas: 0, novas: 4 })).toEqual({ rotulo: 'Para começar:', texto: '4 ideias sugeridas pelas suas fontes.' });
    expect(summaryVisit({ anterior: 1, prontas: 2, novas: 1 }).texto).toBe('2 posts prontos para aprovar e 1 ideia nova.');
    expect(summaryVisit({ anterior: 1, prontas: 1, novas: 0 }).texto).toBe('1 post pronto para aprovar.');
    expect(summaryVisit({ anterior: 1, prontas: 0, novas: 0 })).toEqual({ rotulo: 'Desde a sua última visita:', texto: 'nada novo.' });
  });
  it('failure reason in plain language, never the technical text', () => {
    expect(failureReason('validação reprovou 3 redações')).toMatch(/não passou na conferência/);
    expect(failureReason('sem instância há mais de 60 min; x')).toBe('A produção não conseguiu começar.');
    expect(failureReason('Error: pauta x sem fatos; nada a redigir')).toMatch(/não tem fatos/);
    // Rows written before the messages were translated keep their Portuguese text; new rows carry the English one.
    expect(failureReason('validation failed 3 drafts')).toMatch(/não passou na conferência/);
    expect(failureReason('no instance for more than 60 min; x')).toBe('A produção não conseguiu começar.');
    expect(failureReason('Error: lead x has no facts; nothing to draft')).toMatch(/não tem fatos/);
    expect(failureReason('layout 9:16 rejected on card 2 (texto): {}')).toMatch(/O card 2 não coube/);
    expect(failureReason('layout 9:16 reprovado no card 2 (texto): {}')).toMatch(/O card 2 não coube/);
    expect(failureReason('TypeError: boom')).toBe('A produção parou no meio do caminho.');
    expect(failureReason(null)).toBe('A produção parou no meio do caminho.');
  });
  it('UI stages = API stages, same order', () => {
    expect(ETAPAS_UI).toEqual([...ETAPAS_API]);
    expect(stepLabel('renderizar', 'post')).toBe('Montar a imagem');
    expect(stepLabel('renderizar', 'carrossel')).toBe('Montar os cards');
  });
});

describe('review rules (Phase E)', () => {
  it("sentences tied to a fact and distinct facts; the CTA doesn't count", () => {
    const cards = [
      { papel: 'capa', titulo: 'T', frases: [{ texto: 'a', fatoId: 'f1' }] },
      { papel: 'o_que_aconteceu', titulo: 'T', frases: [{ texto: 'b', fatoId: 'f2' }, { texto: 'c', fatoId: 'f1' }] },
      { papel: 'convite', titulo: 'Siga', frases: [{ texto: 'd', fatoId: null }, { texto: 'e', fatoId: 'f9' }] },
    ];
    expect(factsText(cards)).toEqual({ frases: 3, fatoIds: ['f1', 'f2'] });
    expect(factsText(undefined)).toEqual({ frases: 0, fatoIds: [] });
    expect(validationLine(3, 2, 0)).toBe('3 frases, 2 fatos, nenhum aviso');
    expect(validationLine(1, 1, 1)).toBe('1 frase, 1 fato, 1 aviso');
  });

  it('account: name without the note, as posted and as the sheet sentence', () => {
    const manual = { modo: 'manual', nome: '@portal.litoral (manual, celular)', external_id: null };
    expect(accountName(manual)).toBe('@portal.litoral');
    expect(accountName({ modo: 'real', nome: null, external_id: '1784' })).toBe('1784');
    expect(accountName({ modo: 'real', nome: ' ', external_id: null })).toBe('Instagram');
    expect(asPosts('manual')).toBe('você posta pelo celular');
    expect(asPosts('real')).toBe('posta sozinho no Instagram');
    expect(asPosts('intermediario', 'ayrshare')).toBe('posta sozinho pelo Ayrshare');
    expect(asPosts('intermediario')).toBe('posta sozinho');
    expect(noteApprove(manual)).toBe('Aprovar não publica: o post vai para Prontos para postar, e você posta pelo celular em @portal.litoral.');
    expect(noteApprove({ modo: 'real', nome: '@x', external_id: null })).toMatch(/^Aprovar publica em @x/);
    expect(noteApprove({ modo: 'simulada', nome: '@x (simulada)', external_id: null })).toMatch(/conta de teste/);
    expect(noteApprove(undefined)).toMatch(/não tem conta do Instagram.*Veículo › Contas/);
  });

  it('without an account, the note points the way out: the admin turns it on; the others know whom to ask, by name', () => {
    expect(noteWithoutAccount({ admin: true, admins: ['Ana'] })).toBe('Este veículo ainda não tem conta do Instagram ligada. Ligue uma em');
    expect(noteWithoutAccount({ admin: false, admins: ['Ana'] })).toBe('Este veículo ainda não tem conta do Instagram ligada. Peça a Ana (admin) para ligar uma em');
    expect(noteWithoutAccount({ admin: false, admins: ['Ana', 'Beto'] })).toMatch(/Peça a Ana ou Beto \(admin\)/);
    expect(noteWithoutAccount({ admin: false, admins: [] })).toMatch(/Peça a um admin/);
  });

  it('shell per role: the reporter reads who decides and who confirms, by name', () => {
    const team = [{ nome: 'Ana', papel: 'admin' }, { nome: 'Bruno', papel: 'editor' }, { nome: 'Carla', papel: 'editor' }, { nome: 'Dani', papel: 'reporter' }];
    expect(whoDecides(team)).toBe('Bruno ou Carla decidem este post; Ana é admin.');
    expect(whoDecides([{ nome: 'Ana', papel: 'admin' }, { nome: 'Dani', papel: 'reporter' }])).toBe('Ana (admin) decide este post.');
    expect(whoDecides([{ nome: 'Ana', papel: 'admin' }, { nome: 'Zé', papel: 'admin' }, { nome: 'Bruno', papel: 'editor' }])).toBe('Bruno decide este post; Ana e Zé são admins.');
    expect(whoDecides([])).toMatch(/^Quem é editor ou admin/);
    expect(whoConfirms(team)).toBe('Ana, Bruno ou Carla confirmam que o post saiu.');
    expect(whoConfirms([{ nome: 'Ana', papel: 'admin' }])).toBe('Ana confirma que o post saiu.');
    expect(whoConfirms([])).toMatch(/^Quem é editor ou admin/);
  });

  it('decision error in plain language', () => {
    expect(decisionMessage({ status: 409, message: 'limite de 3 rodadas; aprove ou rejeite' })).toBe('Já são 3 versões: aprove ou rejeite esta.');
    expect(decisionMessage({ status: 409, message: 'conta abc não encontrada ou inativa' })).toMatch(/não está mais ativa/);
    // The API answers in the screen's language: the English text maps to the same sentence.
    expect(decisionMessage({ status: 409, message: 'limit of 3 rounds; approve or reject' })).toBe('Já são 3 versões: aprove ou rejeite esta.');
    expect(decisionMessage({ status: 409, message: 'account abc not found or inactive' })).toMatch(/não está mais ativa/);
    expect(decisionMessage({ status: 409, message: 'publication has no active Instagram account' })).toMatch(/não está mais ativa/);
    expect(decisionMessage({ status: 409, message: 'peça na versão 2, não na 1' })).toMatch(/mudou enquanto você olhava/);
    expect(decisionMessage({ status: 403 })).toMatch(/editor ou admin/);
    expect(decisionMessage({ status: 0 })).toMatch(/Sem conexão/);
    expect(decisionMessage({ status: 500 })).toBe('Não deu para enviar agora. Tente de novo.');
  });

  it('scheduled time: future only', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(timeScheduled('', now)).toBeNull();
    expect(timeScheduled('lixo', now)).toBeNull();
    expect(timeScheduled('2026-10-31T10:00', now)).toBeNull();
    expect(timeScheduled('2026-11-02T10:00', now)).toBe(new Date('2026-11-02T10:00').toISOString());
  });
});

describe('posting rules (Phase F)', () => {
  const now = new Date('2026-11-01T15:00:00Z');   // 12:00 in São Paulo
  const ready = (o: Partial<{ status: string; updated_at: string; agendado_para: string | null; conta_modo: string | null }>) =>
    ({ status: 'aprovada', updated_at: '2026-11-01 14:50:00', agendado_para: null, conta_modo: 'manual', ...o });

  it('whenFuture: today, tomorrow and another date, in São Paulo time', () => {
    expect(whenFuture('2026-11-01T20:30:00.000Z', now)).toBe('hoje, 17:30');
    expect(whenFuture('2026-11-02T12:00:00.000Z', now)).toBe('amanhã, 09:00');
    expect(whenFuture('2026-11-05T21:00:00.000Z', now)).toBe('05/11, 18:00');
  });

  it('readyStatus according to the account and the time', () => {
    expect(readyStatus(ready({}), now)).toBe('aprovado há 10 min');
    expect(readyStatus(ready({ status: 'agendada', agendado_para: '2026-11-01T20:30:00.000Z' }), now)).toBe('anotado para hoje, 17:30');
    expect(readyStatus(ready({ status: 'agendada', agendado_para: '2026-11-01T13:00:00.000Z' }), now)).toBe('era para hoje, 10:00');
    expect(readyStatus(ready({ conta_modo: 'simulada' }), now)).toBe('postando sozinho');
    expect(readyStatus(ready({ conta_modo: 'real', status: 'agendada', agendado_para: '2026-11-02T12:00:00.000Z' }), now)).toBe('posta sozinho amanhã, 09:00');
    expect(alonePosts(null)).toBe(false);
    expect(alonePosts('manual')).toBe(false);
  });

  it('fromPostLink: empty is valid, without https gets it; only Instagram posts (p, reel, tv); another site or profile, no', () => {
    expect(fromPostLink('  ')).toEqual({ url: null });
    expect(fromPostLink('https://www.instagram.com/p/ABC/')).toEqual({ url: 'https://www.instagram.com/p/ABC/' });
    expect(fromPostLink('instagram.com/p/ABC')).toEqual({ url: 'https://instagram.com/p/ABC' });
    expect(fromPostLink('https://www.instagram.com/reel/XyZ_1-2/?igsh=abc')).toEqual({ url: 'https://www.instagram.com/reel/XyZ_1-2/?igsh=abc' });
    expect(fromPostLink('https://www.instagram.com/share/p/AbC123/')).toEqual({ url: 'https://www.instagram.com/share/p/AbC123/' });
    expect(fromPostLink('https://www.instagram.com/share/reel/AbC123')).toEqual({ url: 'https://www.instagram.com/share/reel/AbC123' });
    expect(fromPostLink('https://www.instagram.com/share/AbC123')).toEqual({ url: 'https://www.instagram.com/share/AbC123' });
    expect(fromPostLink('https://www.instagram.com/share/')).toHaveProperty('erro');
    expect(fromPostLink('https://www.instagram.com/portal.litoral/p/AbC123/')).toEqual({ url: 'https://www.instagram.com/portal.litoral/p/AbC123/' });
    expect(fromPostLink('https://www.instagram.com/portal.litoral/reel/AbC123/')).toEqual({ url: 'https://www.instagram.com/portal.litoral/reel/AbC123/' });
    expect(fromPostLink('javascript:alert(1)')).toHaveProperty('erro');
    expect(fromPostLink('postei')).toHaveProperty('erro');
    expect(fromPostLink('https://example.com/p/ABC')).toHaveProperty('erro');
    expect(fromPostLink('https://www.instagram.com/portal.litoral/')).toHaveProperty('erro');
    expect(fromPostLink('https://notinstagram.com/p/ABC')).toMatchObject({ erro: expect.stringMatching(/não é de um post do Instagram/) });
  });

  it('measured production time: median of the ready ones from round 1; without history, the generic sentence', () => {
    const piece = (created: string, ready: string, over: Partial<{ status: string; rodada: number }> = {}) =>
      ({ status: 'revisao', rodada: 1, created_at: created, updated_at: ready, ...over });
    expect(productionTime([])).toBeNull();
    expect(productionTime([piece('2026-11-01 10:00:00', '2026-11-01 10:00:40')])).toBe(40);
    expect(productionTime([
      piece('2026-11-01 10:00:00', '2026-11-01 10:00:30'), piece('2026-11-01 11:00:00', '2026-11-01 11:02:00'), piece('2026-11-01 12:00:00', '2026-11-01 12:00:50'),
      piece('2026-11-01 13:00:00', '2026-11-01 13:00:10', { rodada: 2 }),           // rewrite: adds the editor's wait, does not count
      piece('2026-11-01 14:00:00', '2026-11-01 16:00:00'),                           // resumed after stopping: out
      piece('2026-11-01 15:00:00', '2026-11-01 15:00:05', { status: 'rascunho' }),   // still producing
    ])).toBe(50);
    expect(timeProductionSentence(null)).toBe('Costuma levar 1 ou 2 minutos.');
    expect(timeProductionSentence(38)).toBe('Neste veículo costuma levar cerca de 40 s.');
    expect(timeProductionSentence(3)).toBe('Neste veículo costuma levar cerca de 5 s.');
    expect(timeProductionSentence(75)).toBe('Neste veículo costuma levar cerca de 1 min.');
    expect(timeProductionSentence(130)).toBe('Neste veículo costuma levar cerca de 2 min.');
  });

  it('warning for the brought-in idea with the sheet already closed', () => {
    expect(newOutsideWarning({ situacao: 'nova', status: 'sugerida' })).toBe('A ideia que você trouxe entrou no topo das Ideias.');
    expect(newOutsideWarning({ situacao: 'de_volta', status: 'sugerida' })).toMatch(/voltou para o topo das Ideias/);
    expect(newOutsideWarning({ situacao: 'existente', status: 'em_producao', peca: { id: 'p', status: 'revisao' } })).toBe('A notícia que você trouxe já virou post.');
    expect(newOutsideWarning({ situacao: 'existente', status: 'sugerida' })).toBe('A notícia que você trouxe já estava nas Ideias.');
  });

  it('formatLabel e profileInstagram', () => {
    expect(formatLabel('carrossel', 4)).toBe('carrossel de 4');
    expect(formatLabel('carrossel', null)).toBe('carrossel');
    expect(formatLabel('post', 1)).toBe('post');
    expect(profileInstagram('@portal.litoral')).toBe('https://www.instagram.com/portal.litoral/');
    expect(profileInstagram('Instagram')).toBeNull();
    expect(profileInstagram('@a/../b')).toBeNull();
  });
  it('imageName without accents or spaces', () => {
    expect(imageName('Portal Litoral', 0, 'capa')).toBe('portal-litoral-1-capa.jpg');
    expect(imageName('X', 2, 'o_que_aconteceu')).toBe('x-3-o-que-aconteceu.jpg');
  });
});

describe('uncompressed zip (Download the images)', () => {
  it('crc32 of the reference vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('central directory points to each file, with name, size and crc', () => {
    const files = [
      { nome: 'a-1-capa.jpg', dados: new Uint8Array([0xff, 0xd8, 1, 2, 3]) },
      { nome: 'ação.jpg', dados: new Uint8Array(300).map((_, i) => i % 251) },
    ];
    const zip = zipFiles(files, new Date(2026, 10, 1, 12, 30, 10));
    const v = new DataView(zip.buffer);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    let p = v.getUint32(end + 16, true);
    const dec = new TextDecoder();
    for (const a of files) {
      expect(v.getUint32(p, true)).toBe(0x02014b50);
      const size = v.getUint32(p + 20, true);
      const lenName = v.getUint16(p + 28, true);
      const local = v.getUint32(p + 42, true);
      expect(dec.decode(zip.subarray(p + 46, p + 46 + lenName))).toBe(a.nome);
      expect(size).toBe(a.dados.length);
      expect(v.getUint32(p + 16, true)).toBe(crc32(a.dados));
      expect(v.getUint32(local, true)).toBe(0x04034b50);
      const ini = local + 30 + v.getUint16(local + 26, true);
      expect([...zip.subarray(ini, ini + size)]).toEqual([...a.dados]);
      p += 46 + lenName;
    }
    expect(p).toBe(end);
  });
});

describe('+ Nova (folha "Nova ideia")', () => {
  it('URL tab: missing closes; unknown opens to the link', () => {
    expect(newMode(null)).toBeNull();
    expect(newMode('texto')).toBe('texto');
    expect(newMode('print')).toBe('print');
    expect(newMode('1')).toBe('link');
  });
  it('error in plain language chosen by code, never by text', () => {
    expect(newMessage({ status: 422, codigo: 'link_ilegivel' })).toMatch(/^Não deu para ler a notícia desse link/);
    expect(newMessage({ status: 422, codigo: 'print_sem_noticia' })).toMatch(/nesse print/);
    expect(newMessage({ status: 400, codigo: 'url_invalida' })).toMatch(/não parece o endereço/);
    expect(newMessage({ status: 0 })).toMatch(/^Sem conexão/);
    expect(newMessage({ status: 502, codigo: 'modelo_falhou' })).toBe('A leitura falhou agora. Tente de novo em instantes.');
    expect(newMessage({ status: 418, codigo: 'outro' })).toBe('Não deu certo agora. Tente de novo.');
    expect(newMessage(null)).toBe('Não deu certo agora. Tente de novo.');
  });
  it('warning according to the situation', () => {
    expect(newWarning('nova', 'sugerida')).toBe('Ideia nova, no topo da lista.');
    expect(newWarning('de_volta', 'sugerida')).toMatch(/voltou para o topo da lista/);
    expect(newWarning('existente', 'aceita')).toBe('Essa notícia já estava na lista.');
    expect(newWarning('existente', 'em_producao')).toBe('Essa notícia já está sendo produzida.');
    expect(newWarning('existente', 'em_producao', 'rascunho')).toBe('Essa notícia já está sendo produzida.');
    expect(newWarning('existente', 'em_producao', 'revisao')).toMatch(/espera aprovação/);
    expect(newWarning('existente', 'em_producao', 'agendada')).toMatch(/aprovada e espera ser postada/);
  });
  it('screenshot: up to 1200 px wide and 4 million pixels, never enlarged', () => {
    expect(printScale(800, 600)).toBe(1);
    expect(printScale(2400, 1000)).toBe(0.5);
    const k = printScale(1170, 6000);   // a long phone screenshot
    expect(1170 * k * 6000 * k).toBeLessThanOrEqual(4_000_000 + 1);
  });
});

describe('first steps (sidebar)', () => {
  it('new outlet: 1 of 4 done; disappears when the first post goes out', () => {
    const done = (p: ReturnType<typeof firstSteps>) => p!.map((x) => x.feito);
    expect(done(firstSteps({ ideias: 0, posts: 0, prontos: 0, postados: 0 }))).toEqual([true, false, false, false]);
    expect(done(firstSteps({ ideias: 3, posts: 0, prontos: 0, postados: 0 }))).toEqual([true, true, false, false]);
    expect(done(firstSteps({ ideias: 0, posts: 1, prontos: 0, postados: 0 }))).toEqual([true, true, false, false]);
    expect(done(firstSteps({ ideias: 0, posts: 0, prontos: 1, postados: 0 }))).toEqual([true, true, true, false]);
    expect(firstSteps({ ideias: 0, posts: 0, prontos: 0, postados: 1 })).toBeNull();
  });
});

describe('Today and waiting (sidebar and lists)', () => {
  const now = new Date('2026-11-01T15:00:00Z');   // Sunday, 12:00 in São Paulo
  it('waiting as duration, same grammar in every list; fraction of the wait for the line', () => {
    expect(waitFor('2026-11-01 14:59:50', now)).toBe('agora');
    expect(waitFor('2026-11-01 14:37:00', now)).toBe('23 min');
    expect(waitFor('2026-11-01 12:00:00', now)).toBe('3 h');
    expect(waitFor('2026-10-31 16:00:00', now)).toBe('23 h');
    expect(waitFor('2026-10-30 12:00:00', now)).toBe('2 dias');
    expect(fractionWait('2026-10-31 16:00:00', '2026-10-31 16:00:00', now)).toBe(1);
    expect(fractionWait('2026-11-01 14:00:00', '2026-11-01 13:00:00', now)).toBe(0.5);
    expect(fractionWait('2026-11-01 15:00:00', '2026-11-01 15:00:00', now)).toBe(0);
  });
  it('dense Today: posted per day (today last, São Paulo time), week line, bars and waits', () => {
    // 02:30Z on 01/11 is 23:30 on 31/10 in São Paulo: it counts as yesterday; 20/10 is outside the week.
    const perDay = postedPerDay(['2026-11-01 13:00:00', '2026-11-01 02:30:00', '2026-10-27 12:00:00', '2026-10-20 12:00:00', null], now);
    expect(perDay).toEqual([0, 1, 0, 0, 0, 1, 1]);
    expect(weekLine(perDay)).toBe('hoje 1 · semana 3');
    expect(weekLine([0, 0, 0, 0, 0, 0, 0])).toBe('hoje 0 · semana 0');
    // Bars: the largest takes the full height; zero keeps a 1 px base; all zeros is just the base.
    expect(barsSparkline([0, 2, 1], 30, 20, 2)).toEqual([{ x: 0, y: 19, w: 8.67, h: 1 }, { x: 10.67, y: 0, w: 8.67, h: 20 }, { x: 21.33, y: 10, w: 8.67, h: 10 }]);
    expect(barsSparkline([0, 0], 10, 20, 2).map((b) => b.h)).toEqual([1, 1]);
    expect(barsSparkline([], 10, 20)).toEqual([]);
    expect(waitLine({ n: 4, oque: 'para aprovar', maisAntigo: '2026-10-31 16:00:00' }, now)).toBe('4 para aprovar · há 23 h');
    expect(waitLine({ n: 2, oque: 'para postar', maisAntigo: '2026-11-01 01:00:00', anotado: '2026-11-01T23:00:00.000Z' }, now)).toBe('2 para postar · anotado para hoje, 20:00');
    expect(waitLine({ n: 1, oque: 'para postar', maisAntigo: '2026-11-01 01:00:00', anotado: '2026-11-01T13:00:00.000Z' }, now)).toBe('1 para postar · há 14 h');
    expect(waitLine({ n: 0, oque: 'para aprovar', maisAntigo: null }, now)).toBeNull();
    expect(waitLine({ n: 3, oque: 'para aprovar', maisAntigo: null }, now)).toBe('3 para aprovar');
  });
  it('next collection: the source due first, in the first 15-min cron after it is due', () => {
    // Collected at 14:50 and 14:40, 30 min intervals: due at 15:20 and 15:10 → the 15:15 cron.
    const live = (collectedAt: string | null) => ({ coletadaEm: collectedAt, intervaloMin: 30, coletavel: true });
    expect(nextCollection([live('2026-11-01 14:50:00'), live('2026-11-01 14:40:00')], now)?.toISOString()).toBe('2026-11-01T15:15:00.000Z');
    // Already due (or never collected): the next cron from now.
    expect(nextCollection([live('2026-11-01 10:00:00')], now)?.toISOString()).toBe('2026-11-01T15:00:00.000Z');
    expect(nextCollection([live(null)], new Date('2026-11-01T15:07:00Z'))?.toISOString()).toBe('2026-11-01T15:15:00.000Z');
    // Due exactly on a tick: it is that tick (the cron compares with <=).
    expect(nextCollection([live('2026-11-01 15:00:00')], now)?.toISOString()).toBe('2026-11-01T15:30:00.000Z');
    // A source the cron gave up on (10 failures) does not pull the collection to the next tick; on its own, nothing.
    const dead = { coletadaEm: '2026-11-01 10:00:00', intervaloMin: 30, coletavel: false };
    expect(nextCollection([dead, live('2026-11-01 15:00:00')], now)?.toISOString()).toBe('2026-11-01T15:30:00.000Z');
    expect(nextCollection([dead], now)).toBeNull();
    expect(nextCollection([], now)).toBeNull();
  });
});

describe('simple illustration (fallbackDe → plain language)', () => {
  it('each reason in src/lib/illustrate.ts becomes a sentence without jargon', () => {
    expect(illustrationReason('KIE_API_KEY ausente')).toBe('o serviço de ilustração ainda não foi ligado');
    expect(illustrationReason('marca sem arteRefR2')).toBe('a marca não tem imagem de referência');
    expect(illustrationReason('Error: kie HTTP 402')).toBe('o serviço de ilustração está sem crédito');
    expect(illustrationReason('Error: kie recusou: código 402 insufficient credits')).toBe('o serviço de ilustração está sem crédito');
    expect(illustrationReason('teto de custo da peça (US$ 0.25)')).toBe('este post chegou ao limite de custo');
    expect(illustrationReason('Error: kie: tarefa divergente')).toBe('o serviço de ilustração falhou desta vez');
    // 4020 is not 402.
    expect(illustrationReason('Error: kie recusou: código 4020')).toBe('o serviço de ilustração falhou desta vez');
    expect(illustrationReason('Error: kie refused: code 402')).toBe('o serviço de ilustração está sem crédito');
    expect(illustrationReason('piece cost cap (US$ 0.25)')).toBe('este post chegou ao limite de custo');
  });
  it('the last illustration event of the displayed version counts; without fallbackDe, nothing', () => {
    const ev = (version: number, fallbackOf?: string) => ({ tipo: 'peca.ilustracao', payload: { versao: version, provedor: fallbackOf ? 'workers-ai' : 'kie', ...(fallbackOf ? { fallbackDe: fallbackOf } : {}) } });
    expect(simpleIllustration([ev(1, 'KIE_API_KEY ausente')], 1)).toBe('o serviço de ilustração ainda não foi ligado');
    expect(simpleIllustration([ev(1, 'KIE_API_KEY ausente'), ev(2)], 2)).toBeNull();
    expect(simpleIllustration([ev(1), ev(2, 'marca sem arteRefR2')], 1)).toBeNull();
    expect(simpleIllustration([{ tipo: 'peca.ilustracao_falhou', payload: { versao: 1, fallbackDe: 'x' } }], 1)).toBeNull();
    expect(simpleIllustration([], 1)).toBeNull();
  });
});

describe('multi-city coverage', () => {
  it('UF from the first two IBGE digits; label "nome · UF"', () => {
    expect(ufDoIbge('3548500')).toBe('SP');
    expect(ufDoIbge('5300108')).toBe('DF');
    expect(ufDoIbge('9900000')).toBeNull();
    expect(areaLabel({ ibge: '3548500', nome: 'Santos' })).toBe('Santos · SP');
    expect(areaLabel({ ibge: '9900000', nome: 'X' })).toBe('X');
  });
  it('?cidade= only applies to a coverage city, and only with more than one; an idea without a city only under Todas', () => {
    const two = [{ ibge: '3518701' }, { ibge: '3548500' }];
    expect(cityFilter('3548500', two)).toBe('3548500');
    expect(cityFilter('3304557', two)).toBeNull();
    expect(cityFilter('3518701', [{ ibge: '3518701' }])).toBeNull();
    expect(cityFilter(null, two)).toBeNull();
    const leads = [{ id: 'a', municipio_ibge: '3548500' }, { id: 'b', municipio_ibge: '3518701' }, { id: 'c', municipio_ibge: null }];
    expect(filterPerCity(leads, '3548500').map((p) => p.id)).toEqual(['a']);
    expect(filterPerCity(leads, null).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});
