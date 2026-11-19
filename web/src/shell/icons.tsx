// Stroke icons (1.6 px, round cap), drawn for 24×24. Decorative: the label is in the text next to them.
import type { ReactNode } from "react";

function Icon({ children, className = "size-[22px]" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}
      fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

type P = { className?: string };
export const IconIdeas = (p: P) => <Icon {...p}><path d="M4 5h16M4 9.5h10M4 14h16M4 18.5h10" /></Icon>;
export const IconApprove = (p: P) => <Icon {...p}><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M9 12l2 2 4-4" /></Icon>;
export const IconPost = (p: P) => <Icon {...p}><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v5h14v-5" /></Icon>;
export const IconPosted = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.3l2.4 2.4 4.8-5" /></Icon>;
export const IconTexts = (p: P) => <Icon {...p}><path d="M6.5 3.5h7.5l3.5 3.5v13.5h-11z" /><path d="M14 3.5V7h3.5M9.5 11.5h5M9.5 15h5" /></Icon>;
export const IconMore = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const IconArrow = (p: P) => <Icon {...p}><path d="M7 10l5 5 5-5" /></Icon>;
export const IconBack = (p: P) => <Icon {...p}><path d="M15 5l-7 7 7 7" /></Icon>;
export const IconRight = (p: P) => <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const IconClose = (p: P) => <Icon {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Icon>;
// The sidebar's Outlet group: brand (a square with the initial), accounts (Instagram camera), sources (RSS waves), team.
export const IconBrand = (p: P) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 16l3-8 3 8M10.2 13h3.6" /></Icon>;
export const IconAccounts = (p: P) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.5" /><circle cx="16.8" cy="7.2" r=".6" fill="currentColor" /></Icon>;
export const IconSources = (p: P) => <Icon {...p}><path d="M5 11a8 8 0 0 1 8 8M5 6a13 13 0 0 1 13 13" /><circle cx="6" cy="18" r="1.2" fill="currentColor" /></Icon>;
export const IconTeam = (p: P) => <Icon {...p}><circle cx="9.5" cy="8.5" r="3" /><path d="M3.5 19a6 6 0 0 1 12 0M15.5 6a3 3 0 0 1 0 5.5M17 13.5a5.5 5.5 0 0 1 3.5 5.5" /></Icon>;
export const IconPlan = (p: P) => <Icon {...p}><rect x="4" y="6" width="16" height="12" rx="1.5" /><path d="M4 10h16M8 15h3" /></Icon>;
export const IconKit = (p: P) => <Icon {...p}><path d="M12 3.5l7 2.6v5.4c0 4.3-2.9 7.4-7 9-4.1-1.6-7-4.7-7-9V6.1z" /><path d="M9 12l2.2 2.2L15.2 10" /></Icon>;
// Post formats (a tag over the art): carousel (a sheet with another behind), single-image post, Reels (upright video).
export const IconCarousel = (p: P) => <Icon {...p}><rect x="8" y="4" width="12" height="15" rx="2" /><path d="M5 7.5v9.2a2.3 2.3 0 0 0 2.3 2.3H16" /></Icon>;
export const IconImage = (p: P) => <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4.5 16.5l4.2-4.2 3.3 3.3 2.7-2.7 4.8 4.8" /><circle cx="9" cy="9" r="1.3" /></Icon>;
export const IconReels = (p: P) => <Icon {...p}><rect x="5.5" y="3.5" width="13" height="17" rx="3" /><path d="M10.2 9.3v5.4l4.4-2.7z" /></Icon>;
// Command palette and shortcuts.
export const IconSearch = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></Icon>;
export const IconEnter = (p: P) => <Icon {...p}><path d="M19 6v6.5a2 2 0 0 1-2 2H6M9.5 11l-3.7 3.5 3.7 3.5" /></Icon>;
export const IconRay = (p: P) => <Icon {...p}><path d="M13 3.5L5.5 13.5h5.5L10 20.5l8-10.5h-5.7z" /></Icon>;
export const IconQuotes = (p: P) => <Icon {...p}><path d="M5 17.5c0-4.5.8-8.2 4.2-10M13.5 17.5c0-4.5.8-8.2 4.2-10" /><circle cx="6.2" cy="17.4" r="1.6" fill="currentColor" /><circle cx="14.7" cy="17.4" r="1.6" fill="currentColor" /></Icon>;
// Round 4: a picker that opens both ways, warning, keyboard, go, grid and list, copy, download, external link.
export const IconSwap = (p: P) => <Icon {...p}><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" /></Icon>;
export const IconAlert = (p: P) => <Icon {...p}><path d="M12 4.5l8.5 15h-17z" /><path d="M12 10v4.5M12 17v.4" /></Icon>;
export const IconDoubt = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.7 9.6a2.4 2.4 0 1 1 3.6 2.1c-.8.5-1.3 1-1.3 1.9M12 16.6v.4" /></Icon>;
export const IconKeyboard = (p: P) => <Icon {...p}><rect x="3.5" y="6.5" width="17" height="11" rx="2" /><path d="M7 10h.5M10.5 10h.5M14 10h.5M17 10h.5M8 14h8" /></Icon>;
export const IconGo = (p: P) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const IconAdvances = (p: P) => <Icon {...p}><path d="M9 5l7 7-7 7" /></Icon>;
export const IconGrid = (p: P) => <Icon {...p}><rect x="4.5" y="4.5" width="6" height="7.5" rx="1" /><rect x="13.5" y="4.5" width="6" height="7.5" rx="1" /><path d="M4.5 16h6M13.5 16h6M4.5 19h4M13.5 19h4" /></Icon>;
export const IconList = (p: P) => <Icon {...p}><path d="M4 6.5h16M4 12h16M4 17.5h16" /></Icon>;
export const IconCopy = (p: P) => <Icon {...p}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></Icon>;
export const IconDownload = (p: P) => <Icon {...p}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" /></Icon>;
export const IconOutside = (p: P) => <Icon {...p}><path d="M14 5h5v5M19 5l-8 8M11 6H6v12h12v-5" /></Icon>;
export const IconEdit = (p: P) => <Icon {...p}><path d="M5 19l1-4L16.5 4.5l3 3L9 18z" /></Icon>;
export const IconMoon = (p: P) => <Icon {...p}><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /></Icon>;
export const IconSun = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="3.8" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" /></Icon>;
/** A spinning registration mark: the "working" sign (desk.css, `.registro`). */
export const RecordIcon = ({ className = "" }: P) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={`registro ${className}`}><circle cx="8" cy="8" r="4.2" /><path d="M8 1v14M1 8h14" /></svg>
);
