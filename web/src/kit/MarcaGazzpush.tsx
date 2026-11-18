import { PRODUTO } from "../marca";
import { useMesa } from "../mesa";

export default function MarcaGazzpush({ className = "w-[148px] sm:w-44" }: { className?: string }) {
  const src = useMesa() === "noite" ? "/marca/lombada/assinatura-clara.svg" : "/marca/lombada/assinatura.svg";
  return <img src={src} alt={PRODUTO} width={148} height={19} className={`block h-auto shrink-0 ${className}`} />;
}
