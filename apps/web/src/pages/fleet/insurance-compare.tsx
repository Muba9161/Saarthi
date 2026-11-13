import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Home,
  Info,
  PhoneCall,
  Search,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import type { VehicleSummary } from '@/lib/mobility-types';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/common/states';
import { cn } from '@/lib/utils';
import { getProviderLogoComponent } from '@/features/vehicles/insurance/insurance-provider-logos';

export interface InsuranceProvider {
  id: string;
  name: string;
  shortName: string;
  officialUrl: string;
  claimSettlementRatio: string;
  cashlessGarages: number;
  customerCare: string;
  rating: number;
  description: string;
  features: string[];
}

interface VehicleInsuranceResponse {
  vehicle: {
    id: string;
    registrationNumber: string;
    type: string;
    make: string | null;
    model: string | null;
  };
  policySummary: {
    company: string;
    policyNumber: string;
    expiryDate: string | null;
    status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNINSURED';
  };
}

type InsurancePlanType = 'COMPREHENSIVE' | 'THIRD_PARTY' | 'OWN_DAMAGE';

const PLAN_TYPE_CONFIG: Record<
  InsurancePlanType,
  {
    title: string;
    tagline: string;
    description: string;
    coverageHighlights: string[];
    recommended?: boolean;
  }
> = {
  COMPREHENSIVE: {
    title: 'Comprehensive Package',
    tagline: 'Recommended for Maximum Protection',
    description:
      'Covers own vehicle damage (accidents, fire, theft, natural disasters) plus mandatory third-party liability for bodily injury and third-party property damage.',
    coverageHighlights: [
      'Accidental damages & collisions',
      'Theft, burglary, & riot damage',
      'Natural disasters (flood, cyclone, earthquake)',
      'Third-party death, bodily injury & property liability',
      'Zero depreciation & engine protect add-on eligibility',
    ],
    recommended: true,
  },
  THIRD_PARTY: {
    title: 'Third Party (TP) Only',
    tagline: 'Mandatory by Law (Motor Vehicles Act 1988)',
    description:
      'Covers legal liability against damage, disability, death of third parties, or damage to third-party property caused by your vehicle.',
    coverageHighlights: [
      'Legal compliance under MV Act 1988',
      'Third-party personal injury & death (unlimited liability)',
      'Third-party property damage up to ₹7.5 Lakh',
      'Personal accident cover for owner-driver (₹15 Lakh)',
      'Does not cover own damage or theft',
    ],
  },
  OWN_DAMAGE: {
    title: 'Own Damage (OD) Standalone',
    tagline: 'Physical Protection for Active TP Holders',
    description:
      'Standalone cover protecting your vehicle against physical damage, fire, and theft when you already possess an active multi-year third-party policy.',
    coverageHighlights: [
      'Physical accidental damage to own vehicle',
      'Total loss or theft compensation based on IDV',
      'Fire, explosion & lightning damage',
      'Can be paired with Zero-Dep & Roadside Assistance add-ons',
      'Must have active Third Party policy from any insurer',
    ],
  },
};

export function InsuranceComparePage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [selectedPlanType, setSelectedPlanType] = React.useState<InsurancePlanType>('COMPREHENSIVE');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [filterRating, setFilterRating] = React.useState<'ALL' | 'TOP_RATED'>('ALL');

  // 1. Fetch Indian Insurance Providers from API
  const providersQuery = useQuery({
    queryKey: ['insurance', 'providers'],
    queryFn: () => api.get<InsuranceProvider[]>('/insurance/providers'),
  });

  // 2. Fetch Vehicle Details from API
  const vehicleQuery = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api.get<VehicleSummary>(`/fleet/vehicles/${id}`),
    enabled: Boolean(id),
  });

  // 3. Fetch Vehicle Insurance Summary from API
  const vehicleInsuranceQuery = useQuery({
    queryKey: ['insurance', 'vehicle', id],
    queryFn: () => api.get<VehicleInsuranceResponse>(`/insurance/vehicle/${id}`),
    enabled: Boolean(id),
  });

  if (providersQuery.isLoading || (id && vehicleQuery.isLoading)) {
    return <LoadingState label="Loading insurance comparison & provider directory…" />;
  }

  if (providersQuery.error) {
    return (
      <ErrorState
        error={providersQuery.error}
        onRetry={() => void providersQuery.refetch()}
      />
    );
  }

  const providers = providersQuery.data ?? [];
  const vehicle = vehicleQuery.data;
  const regNo = vehicle?.registrationNumber ?? vehicleInsuranceQuery.data?.vehicle.registrationNumber ?? 'UP63N5670';
  const vehicleClass = vehicle?.classLabel ?? vehicle?.categoryLabel ?? 'LMV (Car)';
  const vehicleMakeModel =
    vehicle?.manufacturer && vehicle?.model
      ? `${vehicle.manufacturer} ${vehicle.model}`
      : vehicleInsuranceQuery.data?.vehicle.make && vehicleInsuranceQuery.data?.vehicle.model
        ? `${vehicleInsuranceQuery.data.vehicle.make} ${vehicleInsuranceQuery.data.vehicle.model}`
        : 'Maruti Suzuki Brezza';
  const fuelType = vehicle?.fuelType ? vehicle.fuelType.replace(/_/g, ' ') : 'Diesel';
  const year = vehicle?.year ?? 2023;

  // Filtered providers
  const filteredProviders = providers.filter((p) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.shortName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.features.some((f) => f.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRating = filterRating === 'ALL' || p.rating >= 4.8;
    return matchesSearch && matchesRating;
  });

  const activePlanConfig = PLAN_TYPE_CONFIG[selectedPlanType];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in-50 duration-200">
      {/* 1. Breadcrumb Navigation */}
      <nav aria-label="Breadcrumbs" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 font-medium hover:text-foreground transition-colors"
        >
          <Home className="size-4" />
          <span>Home</span>
        </Link>
        <span aria-hidden className="text-muted-foreground/60">/</span>
        <Link
          to="/fleet/vehicles"
          className="inline-flex items-center font-medium hover:text-foreground transition-colors"
        >
          Vehicles
        </Link>
        <span aria-hidden className="text-muted-foreground/60">/</span>
        {id ? (
          <Link
            to={`/fleet/vehicles/${id}?tab=documents&folder=INSURANCE`}
            className="inline-flex items-center font-mono font-medium text-primary hover:underline transition-colors"
          >
            {regNo}
          </Link>
        ) : (
          <span className="font-mono">{regNo}</span>
        )}
        <span aria-hidden className="text-muted-foreground/60">/</span>
        {id ? (
          <Link
            to={`/fleet/vehicles/${id}?tab=documents&folder=INSURANCE`}
            className="inline-flex items-center font-medium hover:text-foreground transition-colors"
          >
            Documents
          </Link>
        ) : (
          <span>Documents</span>
        )}
        <span aria-hidden className="text-muted-foreground/60">/</span>
        {id ? (
          <Link
            to={`/fleet/vehicles/${id}?tab=documents&folder=INSURANCE`}
            className="inline-flex items-center font-medium hover:text-foreground transition-colors"
          >
            Insurance
          </Link>
        ) : (
          <span>Insurance</span>
        )}
        <span aria-hidden className="text-muted-foreground/60">/</span>
        <span className="font-semibold text-foreground">Policy Comparison</span>
      </nav>

      {/* 2. Page Header & Back Button */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-md ring-4 ring-red-500/10">
            <ShieldAlert className="size-7" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Comparison of Insurance Policies
              </h1>
              <span className="inline-flex items-center rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-500/20">
                Official IRDAI Portals
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Compare coverage options and directly access verified official web portals of top Indian vehicle insurance companies.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (id) {
                navigate(`/fleet/vehicles/${id}?tab=documents&folder=INSURANCE`);
              } else {
                navigate(-1);
              }
            }}
            className="rounded-xl shadow-xs border-border/80 hover:bg-muted"
          >
            <ChevronLeft className="mr-1.5 size-4" />
            Back to Insurance
          </Button>
        </div>
      </div>

      {/* 3. Top Vehicle Context & Comparison Section */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-5">
        {/* Vehicle Badge & Overview Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-muted/30 p-4 rounded-xl border border-border/60">
          <div className="flex items-center gap-3.5">
            {/* Number plate pill */}
            <div className="flex items-center overflow-hidden rounded-lg border-2 border-foreground/80 bg-white text-zinc-950 font-mono text-sm font-bold shadow-xs">
              <div className="bg-blue-700 px-1.5 py-1 text-[10px] font-black text-white flex flex-col items-center justify-center leading-none">
                <span>IND</span>
              </div>
              <span className="px-2.5 py-1 tracking-wider">{regNo}</span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground text-sm">
                  {vehicleMakeModel}
                </span>
                <span className="text-xs text-muted-foreground">({year})</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Class: <span className="font-medium text-foreground">{vehicleClass}</span> · Fuel: <span className="font-medium text-foreground capitalize">{fuelType}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="rounded-lg bg-emerald-500/10 px-3 py-1.5 border border-emerald-500/20 flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                Eligible for Instant Online Policy Renewal
              </span>
            </div>
          </div>
        </div>

        {/* 4. Insurance Type Selector (Requirement 4) */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wider text-muted-foreground">
              Select Insurance Coverage Type
            </h2>
            <span className="text-xs text-muted-foreground">
              Choose policy scope to view applicable benefits
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                { type: 'COMPREHENSIVE', label: 'Comprehensive', badge: 'Recommended' },
                { type: 'THIRD_PARTY', label: 'Third Party (TP)', badge: 'Mandatory' },
                { type: 'OWN_DAMAGE', label: 'Own Damage (OD)', badge: 'Standalone' },
              ] as const
            ).map((item) => {
              const isSelected = selectedPlanType === item.type;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setSelectedPlanType(item.type)}
                  className={cn(
                    'relative flex flex-col items-start p-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs'
                      : 'border-border bg-background hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className={cn('text-sm font-bold', isSelected ? 'text-primary' : 'text-foreground')}>
                      {item.label}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {item.badge}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {PLAN_TYPE_CONFIG[item.type].tagline}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Active Plan Explanation Banner */}
          <div className="mt-3.5 bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/70 dark:border-blue-900/40 rounded-xl p-3.5 text-xs">
            <div className="flex items-start gap-2.5">
              <Info className="size-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-blue-900 dark:text-blue-200">
                  {activePlanConfig.title} &mdash; {activePlanConfig.tagline}
                </p>
                <p className="text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
                  {activePlanConfig.description}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11px] text-blue-900/90 dark:text-blue-200/90 font-medium">
                  {activePlanConfig.coverageHighlights.map((highlight, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1">
                      <span className="size-1 rounded-full bg-blue-500" />
                      {highlight}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 5. IRDAI Quotation Notice (Requirement 4) */}
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3.5 flex items-start gap-3">
          <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200 space-y-0.5">
            <p className="font-semibold">Direct Official Insurer Portals Notice</p>
            <p className="leading-relaxed opacity-90">
              Under IRDAI compliance guidelines, exact vehicle insurance quotations require chassis number and accurate Insured Declared Value (IDV) calculation. To protect your data and avoid inflated third-party agent brokerage, WorldX Saarthi directs you straight to the verified official quotation and renewal portals of each insurer below.
            </p>
          </div>
        </div>
      </div>

      {/* 6. Filter & Search Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">
            Top Indian Vehicle Insurance Companies
          </h2>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
            {filteredProviders.length} Providers
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search insurer or feature..."
              className="w-full rounded-xl border border-border bg-card pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="flex items-center rounded-xl border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setFilterRating('ALL')}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                filterRating === 'ALL'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              All Providers
            </button>
            <button
              type="button"
              onClick={() => setFilterRating('TOP_RATED')}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                filterRating === 'TOP_RATED'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              ★ 4.8+ Rated
            </button>
          </div>
        </div>
      </div>

      {/* 7. Responsive 3-Column Card Grid (Requirement 3) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredProviders.map((provider) => (
          <div
            key={provider.id}
            className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-200"
          >
            <div>
              {/* Card Header: Brand Logo, Name, Rating */}
              <div className="flex items-start justify-between gap-3 mb-3.5">
                <div className="flex items-center gap-3">
                  <div className="shrink-0 p-1 rounded-xl bg-muted/40 border border-border/50 group-hover:border-primary/20 transition-colors">
                    {getProviderLogoComponent(provider.id, 'size-10')}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground leading-snug group-hover:text-primary transition-colors">
                      {provider.name}
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium mt-0.5">
                      {provider.shortName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-md text-xs font-bold shrink-0">
                  <Star className="size-3 fill-amber-500 text-amber-500" />
                  <span>{provider.rating.toFixed(1)}</span>
                </div>
              </div>

              {/* Insurer Description */}
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-4">
                {provider.description}
              </p>

              {/* Metrics Pill Grid */}
              <div className="grid grid-cols-2 gap-2.5 bg-muted/30 p-2.5 rounded-xl border border-border/50 mb-4 text-xs">
                <div>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                    Claim Settlement (CSR)
                  </p>
                  <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {provider.claimSettlementRatio}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                    Cashless Garages
                  </p>
                  <p className="text-xs font-bold text-foreground mt-0.5">
                    {provider.cashlessGarages.toLocaleString('en-IN')}+ Workshops
                  </p>
                </div>
              </div>

              {/* Key Features List */}
              <div className="space-y-1.5 mb-5">
                <p className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
                  Key Coverage Perks:
                </p>
                <ul className="space-y-1">
                  {provider.features.slice(0, 3).map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                      <span className="truncate">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Bottom Actions: Helpline & Visit Website Button */}
            <div className="pt-4 border-t border-border/60 flex items-center justify-between gap-3">
              <a
                href={`tel:${provider.customerCare.replace(/\s+/g, '')}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                title={`Call ${provider.shortName} customer support`}
              >
                <PhoneCall className="size-3.5" />
                <span className="truncate max-w-[100px]">{provider.customerCare}</span>
              </a>

              <a
                href={provider.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 hover:shadow-sm transition-all group-hover:ring-2 group-hover:ring-primary/20 shrink-0"
              >
                <span>Visit Website</span>
                <ExternalLink className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
          </div>
        ))}
      </div>

      {filteredProviders.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <Building2 className="size-12 text-muted-foreground mx-auto mb-3 opacity-40" />
          <h3 className="text-base font-bold text-foreground">No matching insurance providers</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Try adjusting your search query or reset filter to view all 9 verified Indian providers.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearchQuery('');
              setFilterRating('ALL');
            }}
            className="mt-4 rounded-xl"
          >
            Reset Filters
          </Button>
        </div>
      )}

      {/* 8. Feature Comparison Matrix Table */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm mt-8 space-y-4">
        <div>
          <h3 className="text-base font-bold text-foreground">
            Side-by-Side Features & Settlement Comparison
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Key operational metrics across all 9 top insurance companies for vehicle {regNo}.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="py-3 px-3 font-semibold text-foreground">Insurance Company</th>
                <th className="py-3 px-3 font-semibold text-foreground">Claim Settlement (CSR)</th>
                <th className="py-3 px-3 font-semibold text-foreground">Cashless Garages</th>
                <th className="py-3 px-3 font-semibold text-foreground">Video Claims</th>
                <th className="py-3 px-3 font-semibold text-foreground">24x7 RSA</th>
                <th className="py-3 px-3 font-semibold text-foreground">Zero-Depreciation</th>
                <th className="py-3 px-3 font-semibold text-foreground text-right">Official Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {providers.map((p) => (
                <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2.5">
                      <div className="shrink-0">
                        {getProviderLogoComponent(p.id, 'size-6')}
                      </div>
                      <span className="font-semibold text-foreground">{p.shortName}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-bold text-emerald-600 dark:text-emerald-400">
                    {p.claimSettlementRatio}
                  </td>
                  <td className="py-3 px-3 font-medium text-foreground">
                    {p.cashlessGarages.toLocaleString('en-IN')}+
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="size-3.5" /> Supported
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="size-3.5" /> Pan-India
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="size-3.5" /> Available Add-on
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <a
                      href={p.officialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                    >
                      <span>Visit Portal</span>
                      <ExternalLink className="size-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default InsuranceComparePage;
