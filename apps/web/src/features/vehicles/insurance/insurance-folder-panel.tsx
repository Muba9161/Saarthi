import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FileUp,
  Folder,
  Home,
  Maximize2,
  PhoneCall,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { DocumentOwnerType } from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import type { DocumentSummary } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  getProviderLogoComponent,
} from './insurance-provider-logos';

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

export interface PolicyComparisonItem {
  id: string;
  providerId: string;
  providerName: string;
  officialUrl: string;
  planName: string;
  planType: 'COMPREHENSIVE' | 'ZERO_DEP' | 'THIRD_PARTY';
  claimSettlementRatio: string;
  cashlessGarages: number;
  idvCoverage: string;
  zeroDepreciation: boolean;
  engineProtection: boolean;
  roadsideAssistance: boolean;
  consumablesCover: boolean;
  keyReplacement: boolean;
  ncbProtection: boolean;
  estimatedAnnualPremium: {
    twoWheeler: number;
    car: number;
    commercialTruck: number;
  };
}

const INDIAN_INSURANCE_COMPANIES: InsuranceProvider[] = [
  {
    id: 'icici-lombard',
    name: 'ICICI Lombard General Insurance',
    shortName: 'ICICI Lombard',
    officialUrl: 'https://www.icicilombard.com',
    claimSettlementRatio: '98.4%',
    cashlessGarages: 11000,
    customerCare: '1800 2666',
    rating: 4.8,
    description: 'Instant digital policy issuance and video claims approval in minutes.',
    features: ['Instant policy issuance', 'Video claims approval', '24x7 Roadside Assistance', 'Zero-depreciation add-on'],
  },
  {
    id: 'bajaj-general',
    name: 'Bajaj Allianz General Insurance',
    shortName: 'Bajaj General Insurance',
    officialUrl: 'https://www.bajajallianz.com',
    claimSettlementRatio: '98.2%',
    cashlessGarages: 10500,
    customerCare: '1800 209 5858',
    rating: 4.7,
    description: 'Pioneered Motor On The Spot (MOTS) settlements and spot assistance.',
    features: ['Motor on the Spot', '24x7 spot assistance', 'Engine protector cover', 'Personal accident shield'],
  },
  {
    id: 'tata-aig',
    name: 'Tata AIG General Insurance',
    shortName: 'Tata AIG',
    officialUrl: 'https://www.tataaig.com',
    claimSettlementRatio: '99.1%',
    cashlessGarages: 8700,
    customerCare: '1800 266 7780',
    rating: 4.8,
    description: 'Trusted coverage backed by the Tata legacy with high settlement efficiency.',
    features: ['Auto Secure comprehensive', 'Consumables & tyre cover', 'Emergency transport', 'Warranty protection'],
  },
  {
    id: 'hdfc-ergo',
    name: 'HDFC ERGO General Insurance',
    shortName: 'HDFC ERGO',
    officialUrl: 'https://www.hdfcergo.com',
    claimSettlementRatio: '98.9%',
    cashlessGarages: 12200,
    customerCare: '022 6234 6234',
    rating: 4.9,
    description: 'Extensive cashless workshop network across India with overnight express repair.',
    features: ['Overnight vehicle repair', 'Zero paper claim process', 'Unlimited zero dep claims', 'Return to invoice'],
  },
  {
    id: 'new-india-assurance',
    name: 'The New India Assurance Co. Ltd.',
    shortName: 'New India Assurance',
    officialUrl: 'https://www.newindia.co.in',
    claimSettlementRatio: '96.5%',
    cashlessGarages: 6500,
    customerCare: '1800 209 1415',
    rating: 4.6,
    description: 'India’s largest government general insurer with pan-India network.',
    features: ['Government-backed reliability', 'Pan-India branch network', 'Commercial fleet support', 'Affordable rates'],
  },
  {
    id: 'sbi-general',
    name: 'SBI General Insurance',
    shortName: 'SBI General Insurance',
    officialUrl: 'https://www.sbigeneral.in',
    claimSettlementRatio: '97.3%',
    cashlessGarages: 7800,
    customerCare: '1800 102 1111',
    rating: 4.6,
    description: 'Trust of State Bank of India with transparent settlements and fleet discounts.',
    features: ['SBI banking trust', 'Commercial fleet packages', 'No claim bonus protection', 'Fast-track settlement'],
  },
  {
    id: 'digit-insurance',
    name: 'Go Digit General Insurance',
    shortName: 'Digit Insurance',
    officialUrl: 'https://www.godigit.com',
    claimSettlementRatio: '99.5%',
    cashlessGarages: 8000,
    customerCare: '1800 258 5956',
    rating: 4.9,
    description: '100% paperless motor insurer with smartphone self-inspection in 7 minutes.',
    features: ['Self-inspection in 7 mins', '100% paperless onboarding', 'Customizable IDV', 'Superfast reimbursement'],
  },
  {
    id: 'reliance-general',
    name: 'Reliance General Insurance',
    shortName: 'Reliance General Insurance',
    officialUrl: 'https://www.reliancegeneral.co.in',
    claimSettlementRatio: '97.8%',
    cashlessGarages: 9100,
    customerCare: '1800 3009',
    rating: 4.7,
    description: 'Comprehensive commercial and personal motor packages with doorstep pickup.',
    features: ['Instant video survey', 'Free pickup & drop repairs', 'Commercial carriage packages', 'Tyre & battery protection'],
  },
  {
    id: 'royal-sundaram',
    name: 'Royal Sundaram General Insurance',
    shortName: 'Royal Sundaram',
    officialUrl: 'https://www.royalsundaram.in',
    claimSettlementRatio: '97.1%',
    cashlessGarages: 7200,
    customerCare: '1860 425 0000',
    rating: 4.5,
    description: 'Dedicated commercial vehicle protection and Car Shield comprehensive plans.',
    features: ['Car Shield & Heavy Commercial', 'Direct surveyor assignment', 'Lifetime repair warranty', 'Cashless garage network'],
  },
];

type InsuranceSubTab = 'overview' | 'policy-details' | 'renewal' | 'claims' | 'comparison' | 'history';

interface InsuranceFolderPanelProps {
  vehicleId: string;
  registrationNumber: string;
  onBack: () => void;
  onOpenVirtualRc?: () => void;
  canUpload: boolean;
  allDocuments: DocumentSummary[];
}

export function InsuranceFolderPanel({
  vehicleId,
  registrationNumber,
  onBack,
  onOpenVirtualRc,
  canUpload,
  allDocuments,
}: InsuranceFolderPanelProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = React.useState<InsuranceSubTab>('overview');
  const [fullscreenOpen, setFullscreenOpen] = React.useState(false);
  const [previewBlobUrl, setPreviewBlobUrl] = React.useState<string | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Filter existing physical RC document from all uploaded documents
  const rcDocument = React.useMemo(() => {
    return allDocuments.find((d) => d.documentType === 'REGISTRATION_CERTIFICATE') ?? null;
  }, [allDocuments]);

  // Filter existing Insurance policy document
  const insuranceDocument = React.useMemo(() => {
    return allDocuments.find((d) => d.documentType === 'INSURANCE') ?? null;
  }, [allDocuments]);

  // Query backend insurance API
  const insuranceQuery = useQuery({
    queryKey: ['insurance', 'vehicle', vehicleId],
    queryFn: async () => {
      try {
        return await api.get<{
          vehicle: { registrationNumber: string; manufacturer?: string; model?: string; fuelType?: string };
          rcDocument: DocumentSummary | null;
          insuranceDocument: DocumentSummary | null;
          policySummary: {
            company: string;
            policyNumber: string;
            validTill: string;
            status: string;
            daysUntilExpiry: number;
          };
          providers: InsuranceProvider[];
        }>(`/insurance/vehicle/${vehicleId}`);
      } catch {
        return null;
      }
    },
    enabled: Boolean(vehicleId),
  });

  // Query comparison plans
  const comparisonQuery = useQuery({
    queryKey: ['insurance', 'compare'],
    queryFn: async () => {
      try {
        return await api.get<PolicyComparisonItem[]>('/insurance/compare');
      } catch {
        return [];
      }
    },
    enabled: activeTab === 'comparison',
  });

  // Upload or replace physical RC mutation
  const uploadRcMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('ownerType', DocumentOwnerType.TRUCK);
      formData.append('ownerId', vehicleId);
      formData.append('documentType', 'REGISTRATION_CERTIFICATE');
      formData.append('documentNumber', registrationNumber);
      formData.append('file', file);

      return api.post<DocumentSummary>('/documents', formData);
    },
    onSuccess: () => {
      toast.success('Vehicle RC uploaded successfully', {
        description: 'Physical RC document saved and queued for verification.',
      });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['insurance'] });
    },
    onError: (error) => {
      toast.error('RC upload failed', {
        description: errorMessage(error),
      });
    },
  });

  // Handler for file selection / drop
  const handleFileChosen = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large', { description: 'Vehicle RC must be 10 MB or smaller.' });
      return;
    }
    uploadRcMutation.mutate(file);
  };

  // Download RC file
  const handleDownloadRc = async (inline: boolean = false) => {
    if (!rcDocument) return;
    try {
      const response = await fetch(
        absoluteApiUrl(`/documents/${rcDocument.id}/download${inline ? '?disposition=inline' : ''}`),
        {
          credentials: 'include',
          headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        },
      );
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (inline) {
        setPreviewBlobUrl(url);
        setFullscreenOpen(true);
      } else {
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = rcDocument.fileName || `Vehicle_RC_${registrationNumber}.pdf`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        toast.success('Download started');
      }
    } catch {
      toast.error('Could not download Vehicle RC');
    }
  };

  // Cleanup preview URL on modal close
  React.useEffect(() => {
    if (!fullscreenOpen && previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
  }, [fullscreenOpen, previewBlobUrl]);

  // Format expiry date for summary
  const policyExpiryDisplay = React.useMemo(() => {
    if (insuranceDocument?.expiryDate) {
      return new Date(insuranceDocument.expiryDate).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
    if (insuranceQuery.data?.policySummary.validTill) {
      return new Date(insuranceQuery.data.policySummary.validTill).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    }
    return '15-Feb-2027';
  }, [insuranceDocument, insuranceQuery.data]);

  const policyCompany = insuranceDocument?.title || insuranceQuery.data?.policySummary.company || 'ICICI Lombard';
  const policyNumber = insuranceDocument?.documentNumber || insuranceQuery.data?.policySummary.policyNumber || 'IL-9876543210';

  return (
    <div className="flex flex-col gap-6 animate-in fade-in-50 duration-200">
      {/* 1. Breadcrumbs */}
      <nav aria-label="Breadcrumbs" className="flex items-center gap-2 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Home className="size-4" />
          <span>Home</span>
        </button>
        <span aria-hidden className="text-muted-foreground/60">/</span>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline transition-colors"
        >
          <Folder className="size-4" />
          <span>Documents</span>
        </button>
        <span aria-hidden className="text-muted-foreground/60">/</span>
        <span className="font-semibold text-foreground">Insurance</span>
      </nav>

      {/* 2. Folder Header with Purple Accent */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
            <Shield className="size-7" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Insurance</h1>
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Active Cover
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage vehicle insurance, view RC, compare policies and renew easily.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onBack} className="rounded-xl">
            <ChevronLeft className="mr-1.5 size-4" />
            Back to Documents
          </Button>
          {onOpenVirtualRc ? (
            <Button variant="ghost" size="sm" onClick={onOpenVirtualRc} className="rounded-xl text-primary hover:text-primary">
              <FileText className="mr-1.5 size-4" />
              Virtual RC
            </Button>
          ) : null}
        </div>
      </div>

      {/* 3. Sub-Navigation Tabs */}
      <div className="flex border-b border-border overflow-x-auto no-scrollbar gap-2 sm:gap-6">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'policy-details', label: 'Policy Details' },
          { id: 'renewal', label: 'Renewal' },
          { id: 'claims', label: 'Claims' },
          { id: 'comparison', label: 'Comparison' },
          { id: 'history', label: 'History' },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === 'comparison') {
                  navigate(`/fleet/vehicles/${vehicleId}/insurance/compare`);
                } else {
                  setActiveTab(tab.id as InsuranceSubTab);
                }
              }}
              className={cn(
                'relative pb-3 text-sm font-medium transition-colors whitespace-nowrap px-1',
                isActive
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* 4. Tab Contents */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ================= LEFT COLUMN (~60% = col-span-7) ================= */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            {/* Card 1: Vehicle RC (Physical) */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3.5 mb-5">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText className="size-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">Vehicle RC (Physical)</h2>
                  <p className="text-xs text-muted-foreground">
                    View your vehicle's Registration Certificate (RC) and upload a copy for records.
                  </p>
                </div>
              </div>

              {/* Sub-grid: Left = Actual Uploaded RC Document / Preview, Right = Upload / Replace Dropzone */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
                {/* Part A: Actual Uploaded Vehicle RC Document */}
                <div className="rounded-xl border border-border/80 bg-muted/20 p-4 flex flex-col justify-between">
                  {rcDocument ? (
                    <div className="flex flex-col h-full justify-between gap-3">
                      {/* Document Card Visual Representation */}
                      <div className="relative rounded-lg border border-border bg-white dark:bg-card p-3 shadow-xs overflow-hidden">
                        <div className="flex items-start justify-between gap-2 border-b border-border/50 pb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold text-primary tracking-wider uppercase">
                              Official Document
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleDownloadRc(true)}
                            aria-label="View Fullscreen"
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                          >
                            <Maximize2 className="size-3.5" />
                          </button>
                        </div>

                        <div className="py-2.5">
                          <p className="text-xs font-semibold text-foreground truncate" title={rcDocument.fileName}>
                            {rcDocument.fileName}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span>Plate: <strong className="text-foreground">{registrationNumber}</strong></span>
                            <span>Size: {(rcDocument.fileSize / 1024 / 1024).toFixed(2)} MB</span>
                            <span>v{rcDocument.currentVersion}</span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center justify-between pt-1">
                          {rcDocument.verificationStatus === 'VERIFIED' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" />
                              Verified
                            </span>
                          ) : rcDocument.verificationStatus === 'REJECTED' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                              <AlertCircle className="size-3" />
                              Rejected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                              <RefreshCw className="size-3 animate-spin" />
                              Pending Verification
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {rcDocument.mimeType.includes('pdf') ? 'PDF Document' : 'Image Scan'}
                          </span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleDownloadRc(true)}
                          className="flex-1 rounded-lg text-xs font-medium"
                        >
                          <Eye className="mr-1.5 size-3.5" />
                          View Fullscreen
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleDownloadRc(false)}
                          className="flex-1 rounded-lg text-xs font-medium"
                        >
                          <Download className="mr-1.5 size-3.5" />
                          Download
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Empty State when no RC is uploaded yet */
                    <div className="flex flex-col items-center justify-center text-center h-full py-6 px-3">
                      <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
                        <FileText className="size-6" />
                      </div>
                      <p className="text-xs font-semibold text-foreground">No physical RC on file</p>
                      <p className="text-[11px] text-muted-foreground mt-1 max-w-[190px]">
                        Upload your vehicle's physical Registration Certificate to keep records compliant.
                      </p>
                    </div>
                  )}
                </div>

                {/* Part B: Drag & Drop Upload RC */}
                <div
                  onDragOver={(e) => {
                    if (!canUpload) return;
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    if (!canUpload) return;
                    e.preventDefault();
                    setIsDragOver(false);
                    handleFileChosen(e.dataTransfer.files);
                  }}
                  onClick={() => {
                    if (canUpload) fileInputRef.current?.click();
                  }}
                  className={cn(
                    'rounded-xl border-2 border-dashed p-4 flex flex-col items-center justify-center text-center transition-all duration-200 select-none min-h-[190px]',
                    canUpload ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
                    isDragOver
                      ? 'border-primary bg-primary/5 scale-[0.99]'
                      : 'border-border/80 hover:border-primary/60 hover:bg-muted/30 bg-muted/10',
                  )}
                >
                  {canUpload && (
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                      className="hidden"
                      onChange={(e) => {
                        handleFileChosen(e.target.files);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    />
                  )}

                  <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary mb-2.5">
                    <UploadCloud className="size-5" />
                  </div>

                  <p className="text-xs font-semibold text-foreground">
                    {rcDocument ? 'Replace or Update RC' : 'Upload RC'}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {canUpload ? 'Drag & drop or click to upload' : 'Upload permissions required'}
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 mt-1">
                    (PDF / JPG / PNG, Max 10 MB)
                  </p>

                  {canUpload && (
                    <Button
                      type="button"
                      size="sm"
                      loading={uploadRcMutation.isPending}
                      variant="outline"
                      className="mt-3 rounded-lg text-xs font-medium border-border/80 hover:bg-background"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      <FileUp className="mr-1.5 size-3.5" />
                      Choose File
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Card 2: Policy Summary */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShieldCheck className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Policy Summary</h3>
                    <p className="text-xs text-muted-foreground">Current coverage status and validity</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveTab('renewal')}
                  className="rounded-xl text-xs font-medium border-primary/30 text-primary hover:bg-primary/5"
                >
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Renew Now
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/20 p-3.5 rounded-xl border border-border/60">
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Insurance Company</p>
                  <p className="text-xs font-semibold text-foreground mt-0.5 truncate" title={policyCompany}>
                    {policyCompany}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Policy Number</p>
                  <p className="text-xs font-semibold text-foreground mt-0.5 font-mono">
                    {policyNumber}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Valid Till</p>
                  <p className="text-xs font-semibold text-foreground mt-0.5">
                    {policyExpiryDisplay}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium">Status</p>
                  <div className="mt-0.5">
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Active
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ================= RIGHT COLUMN (~40% = col-span-5) ================= */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {/* Prominent RED CTA Card: Comparison of Insurance Policies */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/fleet/vehicles/${vehicleId}/insurance/compare`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/fleet/vehicles/${vehicleId}/insurance/compare`);
                }
              }}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-red-700 p-5 text-white shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-0.5 cursor-pointer select-none ring-1 ring-red-500/20"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-md shadow-xs">
                    <ShieldAlert className="size-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white tracking-tight leading-snug">
                      Comparison of Insurance Policies
                    </h3>
                    <p className="text-xs text-white/90 mt-1 line-clamp-2 leading-relaxed">
                      Compare plans from top vehicle insurance companies in India and choose the best for your vehicle.
                    </p>
                  </div>
                </div>

                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20 group-hover:bg-white group-hover:text-red-600 text-white transition-all shadow-xs">
                  <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </div>

            {/* Insurance Guidance & Key Features Card */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Why Compare Before Renewal?</h3>
                  <p className="text-xs text-muted-foreground">IRDAI-verified insurer network</p>
                </div>
              </div>

              <div className="space-y-3 text-xs text-muted-foreground">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Direct access to official portals of <strong className="text-foreground">9 top Indian motor insurers</strong> with zero agent commission or markup.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Transfer and protect your accrued <strong className="text-foreground">No Claim Bonus (NCB) up to 50%</strong> for substantial discount on Own Damage premium.
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    Over <strong className="text-foreground">11,000+ cashless network garages</strong> with instant video inspection and fast-track claim settlement.
                  </span>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/fleet/vehicles/${vehicleId}/insurance/compare`)}
                  className="w-full rounded-xl text-xs font-semibold border-primary/30 text-primary hover:bg-primary/5"
                >
                  Open Comparison Center
                  <ArrowRight className="ml-1.5 size-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Comparison Tab Content */}
      {activeTab === 'comparison' && (
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-foreground">Compare Vehicle Insurance Policies</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Detailed comparison across top Indian general insurers for comprehensive, zero-dep, and commercial protection.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveTab('overview')}
                className="rounded-xl"
              >
                <ChevronLeft className="mr-1.5 size-4" />
                Back to Overview
              </Button>
            </div>

            {/* Comparison Table */}
            {comparisonQuery.isLoading && (
              <div className="flex items-center justify-center p-8 text-xs text-muted-foreground">
                <RefreshCw className="mr-2 size-4 animate-spin text-primary" />
                Loading latest policy rates and coverage...
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground uppercase text-[10px] tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Insurance Company</th>
                    <th className="py-3 px-4">Claim Settlement (CSR)</th>
                    <th className="py-3 px-4">Cashless Garages</th>
                    <th className="py-3 px-4">Zero Depreciation</th>
                    <th className="py-3 px-4">Engine Protect</th>
                    <th className="py-3 px-4">24x7 Roadside</th>
                    <th className="py-3 px-4">Customer Helpline</th>
                    <th className="py-3 px-4 text-right">Official Quote</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {INDIAN_INSURANCE_COMPANIES.map((company) => (
                    <tr key={company.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3.5 px-4 font-medium text-foreground">
                        <div className="flex items-center gap-2.5">
                          {getProviderLogoComponent(company.id, 'size-7')}
                          <div>
                            <span className="block font-semibold">{company.shortName}</span>
                            <span className="text-[10px] text-muted-foreground">{company.name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-emerald-600 dark:text-emerald-400">
                        {company.claimSettlementRatio}
                      </td>
                      <td className="py-3.5 px-4 font-mono">
                        {company.cashlessGarages.toLocaleString()}+
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="size-3.5" /> Included
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="size-3.5" /> Available
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="size-3.5" /> 24x7 Pan-India
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-muted-foreground">
                        {company.customerCare}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <a
                          href={company.officialUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-white px-3 py-1.5 text-xs font-semibold transition-all"
                        >
                          Visit Portal
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
      )}

      {/* 6. Policy Details Tab Content */}
      {activeTab === 'policy-details' && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground mb-4">Detailed Policy Coverage & Terms</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">Coverage Category</p>
              <p className="text-sm font-semibold text-foreground mt-1">Comprehensive + Bumper to Bumper</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Covers own damage, third-party liability, theft, fire, and natural disasters.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">Insured Declared Value (IDV)</p>
              <p className="text-sm font-semibold text-foreground mt-1 font-mono">₹ 8,45,000</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Agreed current vehicle valuation basis for total loss and theft claims.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">No Claim Bonus (NCB)</p>
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-1">35% Discount Applied</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Accumulated reward for claim-free driving during the preceding policy term.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 7. Renewal Tab Content */}
      {activeTab === 'renewal' && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <RefreshCw className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Vehicle Policy Renewal</h2>
              <p className="text-xs text-muted-foreground">Instant renewal with zero inspection and pre-filled data</p>
            </div>
          </div>

          <div className="bg-primary/5 rounded-xl border border-primary/20 p-4 mb-6">
            <p className="text-sm font-medium text-foreground">
              Your policy is currently <strong className="text-emerald-600">Active</strong> until {policyExpiryDisplay}.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Renew early up to 90 days prior to expiry without losing your existing NCB accumulated bonus.
            </p>
          </div>

          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Choose Your Insurer to Renew Instantly
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {INDIAN_INSURANCE_COMPANIES.slice(0, 6).map((c) => (
              <a
                key={c.id}
                href={c.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3.5 rounded-xl border border-border hover:border-primary/50 bg-background/50 hover:bg-muted/40 transition-all"
              >
                <div className="flex items-center gap-2.5">
                  {getProviderLogoComponent(c.id, 'size-6')}
                  <span className="text-xs font-semibold">{c.shortName}</span>
                </div>
                <ExternalLink className="size-3.5 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 8. Claims Tab Content */}
      {activeTab === 'claims' && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <PhoneCall className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Cashless Claim Procedure & Helplines</h2>
              <p className="text-xs text-muted-foreground">Emergency accident support and toll-free assistance</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {INDIAN_INSURANCE_COMPANIES.map((company) => (
              <div key={company.id} className="p-3.5 rounded-xl border border-border bg-muted/10">
                <div className="flex items-center gap-2 mb-2">
                  {getProviderLogoComponent(company.id, 'size-6')}
                  <span className="text-xs font-semibold text-foreground">{company.shortName}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Toll-Free Helpline:</p>
                <p className="text-xs font-bold text-primary font-mono mt-0.5">{company.customerCare}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{company.cashlessGarages.toLocaleString()} Cashless Garages</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 9. History Tab Content */}
      {activeTab === 'history' && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground mb-4">Past Policies & Verified Logs</h2>
          <div className="rounded-xl border border-border divide-y divide-border text-xs">
            <div className="p-3.5 flex items-center justify-between">
              <div>
                <p className="font-semibold text-foreground">{policyCompany} - Comprehensive Cover</p>
                <p className="text-[11px] text-muted-foreground">Term: 15-Feb-2025 to {policyExpiryDisplay}</p>
              </div>
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
                Current Term
              </span>
            </div>
            <div className="p-3.5 flex items-center justify-between text-muted-foreground">
              <div>
                <p className="font-semibold text-foreground">New India Assurance - Commercial Standard</p>
                <p className="text-[11px]">Term: 15-Feb-2024 to 14-Feb-2025</p>
              </div>
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                Completed
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Document Preview Modal */}
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden rounded-2xl border border-border">
          <DialogHeader className="p-4 border-b border-border flex flex-row items-center justify-between bg-muted/40">
            <div>
              <DialogTitle className="text-base font-semibold">
                Vehicle Registration Certificate (RC) Preview
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plate: {registrationNumber} · {rcDocument?.fileName}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void handleDownloadRc(false)}>
                <Download className="mr-1.5 size-3.5" />
                Download
              </Button>
            </div>
          </DialogHeader>

          <div className="p-4 min-h-[450px] max-h-[80vh] flex items-center justify-center bg-zinc-950/5 dark:bg-black/40 overflow-auto">
            {previewBlobUrl ? (
              rcDocument?.mimeType.includes('pdf') ? (
                <iframe
                  src={previewBlobUrl}
                  title="RC PDF Preview"
                  className="w-full h-[600px] rounded-lg border border-border bg-white"
                />
              ) : (
                <img
                  src={previewBlobUrl}
                  alt="Vehicle RC Document"
                  className="max-h-[600px] max-w-full rounded-lg object-contain shadow-md"
                />
              )
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <RefreshCw className="size-6 animate-spin text-primary" />
                <p className="text-xs">Loading document preview...</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

