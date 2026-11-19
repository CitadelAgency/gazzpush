import { PRODUCT } from "../brand";
import { useDesk } from "../theme";

export default function GazzpushBrand({ className = "w-[148px] sm:w-44" }: { className?: string }) {
  const src = useDesk() === "noite" ? "/marca/lombada/assinatura-clara.svg" : "/marca/lombada/assinatura.svg";
  return <img src={src} alt={PRODUCT} width={148} height={19} className={`block h-auto shrink-0 ${className}`} />;
}
