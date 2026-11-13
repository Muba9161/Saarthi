import * as React from 'react';

export function IciciLombardLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="ICICI Lombard Logo">
      <rect width="100" height="100" rx="20" fill="#FFF7ED" />
      <path d="M22 68C22 42 42 22 68 22" stroke="#EA580C" strokeWidth="12" strokeLinecap="round" />
      <path d="M38 68C38 50 50 38 68 38" stroke="#9A3412" strokeWidth="8" strokeLinecap="round" />
      <circle cx="68" cy="68" r="10" fill="#EA580C" />
    </svg>
  );
}

export function BajajAllianzLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Bajaj General Insurance Logo">
      <rect width="100" height="100" rx="20" fill="#EFF6FF" />
      <path
        d="M26 28H56C66 28 74 34 74 44C74 50 70 55 64 58C72 61 76 68 76 76C76 86 68 92 56 92H26V28Z"
        fill="#1D4ED8"
      />
      <rect x="36" y="38" width="18" height="16" rx="4" fill="white" />
      <rect x="36" y="64" width="20" height="18" rx="4" fill="white" />
    </svg>
  );
}

export function TataAigLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Tata AIG Logo">
      <rect width="100" height="100" rx="20" fill="#0284C7" />
      <text x="50" y="44" fill="white" fontSize="22" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">
        TATA
      </text>
      <text x="50" y="74" fill="white" fontSize="26" fontWeight="900" textAnchor="middle" letterSpacing="2" fontFamily="sans-serif">
        AIG
      </text>
    </svg>
  );
}

export function HdfcErgoLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="HDFC ERGO Logo">
      <rect width="100" height="100" rx="20" fill="#DC2626" />
      <text x="50" y="42" fill="white" fontSize="20" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">
        HDFC
      </text>
      <text x="50" y="72" fill="white" fontSize="18" fontWeight="800" textAnchor="middle" letterSpacing="1" fontFamily="sans-serif">
        ERGO
      </text>
    </svg>
  );
}

export function NewIndiaAssuranceLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="New India Assurance Logo">
      <rect width="100" height="100" rx="20" fill="#1E3A8A" />
      <circle cx="50" cy="50" r="32" stroke="white" strokeWidth="4" />
      <circle cx="50" cy="50" r="22" fill="#3B82F6" />
      <path d="M50 32V68M32 50H68" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <circle cx="50" cy="50" r="8" fill="#F59E0B" />
    </svg>
  );
}

export function SbiGeneralLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="SBI General Insurance Logo">
      <rect width="100" height="100" rx="20" fill="#F0F9FF" />
      <circle cx="50" cy="50" r="34" fill="#0284C7" />
      <circle cx="50" cy="44" r="14" fill="white" />
      <rect x="46" y="44" width="8" height="26" fill="white" />
    </svg>
  );
}

export function DigitInsuranceLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Digit Insurance Logo">
      <rect width="100" height="100" rx="20" fill="#09090B" />
      <circle cx="35" cy="46" r="14" fill="#10B981" />
      <circle cx="65" cy="46" r="14" fill="#F59E0B" />
      <text x="50" y="78" fill="white" fontSize="18" fontWeight="800" textAnchor="middle" fontFamily="sans-serif">
        digit
      </text>
    </svg>
  );
}

export function RelianceGeneralLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Reliance General Insurance Logo">
      <rect width="100" height="100" rx="20" fill="#1E3A8A" />
      <path
        d="M32 26H54C64 26 72 32 72 42C72 50 66 56 56 58L74 76H58L44 60H42V76H32V26Z"
        fill="#EF4444"
      />
      <rect x="42" y="36" width="14" height="14" rx="2" fill="white" />
    </svg>
  );
}

export function RoyalSundaramLogo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Royal Sundaram Logo">
      <rect width="100" height="100" rx="20" fill="#172554" />
      <circle cx="50" cy="50" r="30" stroke="#EAB308" strokeWidth="4" />
      <path d="M50 24L56 40H72L58 50L64 66L50 56L36 66L42 50L28 40H44L50 24Z" fill="#EAB308" />
    </svg>
  );
}

export function getProviderLogoComponent(id: string, className?: string) {
  switch (id) {
    case 'icici-lombard':
      return <IciciLombardLogo className={className} />;
    case 'bajaj-general':
      return <BajajAllianzLogo className={className} />;
    case 'tata-aig':
      return <TataAigLogo className={className} />;
    case 'hdfc-ergo':
      return <HdfcErgoLogo className={className} />;
    case 'new-india-assurance':
      return <NewIndiaAssuranceLogo className={className} />;
    case 'sbi-general':
      return <SbiGeneralLogo className={className} />;
    case 'digit-insurance':
      return <DigitInsuranceLogo className={className} />;
    case 'reliance-general':
      return <RelianceGeneralLogo className={className} />;
    case 'royal-sundaram':
      return <RoyalSundaramLogo className={className} />;
    default:
      return <IciciLombardLogo className={className} />;
  }
}

