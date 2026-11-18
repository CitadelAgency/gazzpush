// Ícones de traço (1,6 px, ponta redonda), desenhados para 24×24. Decorativos: o rótulo está no texto ao lado.
import type { ReactNode } from "react";

function Icone({ children, className = "size-[22px]" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}
      fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

type P = { className?: string };
export const IconeIdeias = (p: P) => <Icone {...p}><path d="M4 5h16M4 9.5h10M4 14h16M4 18.5h10" /></Icone>;
export const IconeAprovar = (p: P) => <Icone {...p}><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M9 12l2 2 4-4" /></Icone>;
export const IconePostar = (p: P) => <Icone {...p}><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v5h14v-5" /></Icone>;
export const IconePostados = (p: P) => <Icone {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.3l2.4 2.4 4.8-5" /></Icone>;
export const IconeTextos = (p: P) => <Icone {...p}><path d="M6.5 3.5h7.5l3.5 3.5v13.5h-11z" /><path d="M14 3.5V7h3.5M9.5 11.5h5M9.5 15h5" /></Icone>;
export const IconeMais = (p: P) => <Icone {...p}><path d="M12 5v14M5 12h14" /></Icone>;
export const IconeSeta = (p: P) => <Icone {...p}><path d="M7 10l5 5 5-5" /></Icone>;
export const IconeVoltar = (p: P) => <Icone {...p}><path d="M15 5l-7 7 7 7" /></Icone>;
export const IconeCerto = (p: P) => <Icone {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icone>;
export const IconeFechar = (p: P) => <Icone {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Icone>;
// Grupo Veículo da lateral: marca (quadrado com a inicial), contas (câmera do Instagram), fontes (ondas do RSS), equipe.
export const IconeMarca = (p: P) => <Icone {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 16l3-8 3 8M10.2 13h3.6" /></Icone>;
export const IconeContas = (p: P) => <Icone {...p}><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.5" /><circle cx="16.8" cy="7.2" r=".6" fill="currentColor" /></Icone>;
export const IconeFontes = (p: P) => <Icone {...p}><path d="M5 11a8 8 0 0 1 8 8M5 6a13 13 0 0 1 13 13" /><circle cx="6" cy="18" r="1.2" fill="currentColor" /></Icone>;
export const IconeEquipe = (p: P) => <Icone {...p}><circle cx="9.5" cy="8.5" r="3" /><path d="M3.5 19a6 6 0 0 1 12 0M15.5 6a3 3 0 0 1 0 5.5M17 13.5a5.5 5.5 0 0 1 3.5 5.5" /></Icone>;
export const IconePlano = (p: P) => <Icone {...p}><rect x="4" y="6" width="16" height="12" rx="1.5" /><path d="M4 10h16M8 15h3" /></Icone>;
export const IconeKit = (p: P) => <Icone {...p}><path d="M12 3.5l7 2.6v5.4c0 4.3-2.9 7.4-7 9-4.1-1.6-7-4.7-7-9V6.1z" /><path d="M9 12l2.2 2.2L15.2 10" /></Icone>;
// Formatos do post (etiqueta sobre a arte): carrossel (folha com outra atrás), post de uma imagem, Reels (vídeo em pé).
export const IconeCarrossel = (p: P) => <Icone {...p}><rect x="8" y="4" width="12" height="15" rx="2" /><path d="M5 7.5v9.2a2.3 2.3 0 0 0 2.3 2.3H16" /></Icone>;
export const IconeImagem = (p: P) => <Icone {...p}><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4.5 16.5l4.2-4.2 3.3 3.3 2.7-2.7 4.8 4.8" /><circle cx="9" cy="9" r="1.3" /></Icone>;
export const IconeReels = (p: P) => <Icone {...p}><rect x="5.5" y="3.5" width="13" height="17" rx="3" /><path d="M10.2 9.3v5.4l4.4-2.7z" /></Icone>;
// Paleta de comandos e atalhos.
export const IconeBusca = (p: P) => <Icone {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Icone>;
export const IconeEnter = (p: P) => <Icone {...p}><path d="M19 6v6.5a2 2 0 0 1-2 2H6M9.5 11l-3.7 3.5 3.7 3.5" /></Icone>;
export const IconeRaio = (p: P) => <Icone {...p}><path d="M13 3.5L5.5 13.5h5.5L10 20.5l8-10.5h-5.7z" /></Icone>;
export const IconeAspas = (p: P) => <Icone {...p}><path d="M5 17.5c0-4.5.8-8.2 4.2-10M13.5 17.5c0-4.5.8-8.2 4.2-10" /><circle cx="6.2" cy="17.4" r="1.6" fill="currentColor" /><circle cx="14.7" cy="17.4" r="1.6" fill="currentColor" /></Icone>;
// Rodada 4: seletor que abre para os dois lados, aviso, teclado, ir, grade e lista, copiar, baixar, link para fora.
export const IconeTroca = (p: P) => <Icone {...p}><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" /></Icone>;
export const IconeAlerta = (p: P) => <Icone {...p}><path d="M12 4.5l8.5 15h-17z" /><path d="M12 10v4.5M12 17v.4" /></Icone>;
export const IconeDuvida = (p: P) => <Icone {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.7 9.6a2.4 2.4 0 1 1 3.6 2.1c-.8.5-1.3 1-1.3 1.9M12 16.6v.4" /></Icone>;
export const IconeTeclado = (p: P) => <Icone {...p}><rect x="3.5" y="6.5" width="17" height="11" rx="2" /><path d="M7 10h.5M10.5 10h.5M14 10h.5M17 10h.5M8 14h8" /></Icone>;
export const IconeIr = (p: P) => <Icone {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icone>;
export const IconeAvanca = (p: P) => <Icone {...p}><path d="M9 5l7 7-7 7" /></Icone>;
export const IconeGrade = (p: P) => <Icone {...p}><rect x="4.5" y="4.5" width="6" height="7.5" rx="1" /><rect x="13.5" y="4.5" width="6" height="7.5" rx="1" /><path d="M4.5 16h6M13.5 16h6M4.5 19h4M13.5 19h4" /></Icone>;
export const IconeLista = (p: P) => <Icone {...p}><path d="M4 6.5h16M4 12h16M4 17.5h16" /></Icone>;
export const IconeCopiar = (p: P) => <Icone {...p}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></Icone>;
export const IconeBaixar = (p: P) => <Icone {...p}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" /></Icone>;
export const IconeFora = (p: P) => <Icone {...p}><path d="M14 5h5v5M19 5l-8 8M11 6H6v12h12v-5" /></Icone>;
export const IconeEditar = (p: P) => <Icone {...p}><path d="M5 19l1-4L16.5 4.5l3 3L9 18z" /></Icone>;
export const IconeLua = (p: P) => <Icone {...p}><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /></Icone>;
export const IconeSol = (p: P) => <Icone {...p}><circle cx="12" cy="12" r="3.8" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" /></Icone>;
/** Cruz de registro girando: o sinal de "trabalhando" (rodada4.css, `.registro`). */
export const Registro = ({ className = "" }: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={`registro ${className}`}><circle cx="8" cy="8" r="4.2" /><path d="M8 1v14M1 8h14" /></svg>
);
