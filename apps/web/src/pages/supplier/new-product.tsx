import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Pencil } from 'lucide-react';
import {
  MaterialUnit,
  Permission,
  formatCurrency,
  formatNumber,
  humanizeEnum,
} from '@saarthi/shared';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import type { MaterialSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { CommerceEntryPanel } from '@/features/commerce/commerce-entry-panel';
import {
  attributesForSave,
  useCommerceEntry,
  useCommerceTaxonomy,
} from '@/features/commerce/use-commerce';
import { fieldErrorsFrom } from '@/features/commerce/field-errors';
import { useMitraDraft } from '@/features/ai/use-mitra-draft';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { WizardField } from '@/components/common/form-wizard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Add a product — "What are you selling?"
 *
 * One line in; Saarthi reads the category, the details and any price or stock
 * it can; the seller is asked only for what is still missing, reviews the
 * whole listing, and publishes. Nothing is published before that review.
 */
export function NewProductPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const taxonomy = useCommerceTaxonomy();
  const entry = useCommerceEntry('PRODUCT', taxonomy.index);
  // Opened from Saarthi Mitra with the seller's own words: read them straight away.
  useMitraDraft((draft) => {
    if (draft.text) entry.interpret(draft.text);
  }, taxonomy.index !== null);

  // What the seller typed wins over what was read from the line.
  const [nameOverride, setNameOverride] = React.useState<string | null>(null);
  const [priceOverride, setPriceOverride] = React.useState<string | null>(null);
  const [stockOverride, setStockOverride] = React.useState<string | null>(null);
  const [unitOverride, setUnitOverride] = React.useState<MaterialUnit | null>(null);
  const [minimumOrder, setMinimumOrder] = React.useState('1');
  const [description, setDescription] = React.useState('');
  const [editingDetected, setEditingDetected] = React.useState(false);
  const [reviewing, setReviewing] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});

  const detected = entry.commercial;
  const name = nameOverride ?? entry.text.trim().slice(0, 120);
  const price =
    priceOverride ?? (detected.pricePerUnit !== null ? String(detected.pricePerUnit) : '');
  const stock = stockOverride ?? (detected.stock !== null ? String(detected.stock) : '');
  const unit = unitOverride ?? detected.unit ?? MaterialUnit.PIECE;
  const unitLabel = humanizeEnum(unit).toLowerCase();

  const priceDetected = detected.pricePerUnit !== null && priceOverride === null;
  const stockDetected = detected.stock !== null && stockOverride === null;
  const showPrice = editingDetected || !priceDetected;
  const showStock = editingDetected || !stockDetected;

  const publish = useMutation({
    mutationFn: () =>
      api.post<MaterialSummary>('/marketplace/materials', {
        name,
        categoryId: entry.categoryId,
        attributes: attributesForSave(entry),
        unit,
        pricePerUnit: Number(price),
        availableQuantity: Number(stock),
        minimumOrderQty: Number(minimumOrder) || 1,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: (listing) => {
      void queryClient.invalidateQueries({ queryKey: ['/marketplace/my-materials'] });
      toast.success('Product published', {
        description: `${listing.name} is now visible to fleet owners sourcing it.`,
      });
      navigate('/supplier/materials');
    },
    onError: (error) => {
      setReviewing(false);
      if (error instanceof ApiError) setErrors(fieldErrorsFrom(error));
      toast.error('Could not publish the product', { description: errorMessage(error) });
    },
  });

  const validate = (): boolean => {
    const found: Record<string, string> = {};
    if (!entry.categoryId) found.categoryId = 'Choose what you are selling.';
    if (name.trim().length < 2) found.name = 'Give the product a name buyers will recognise.';
    if (!(Number(price) > 0)) found.price = 'Enter your price.';
    if (stock === '' || !(Number(stock) >= 0)) found.stock = 'How many are available?';
    for (const key of entry.missingAttributes) {
      found[key] =
        `${entry.fields.find((field) => field.key === key)?.label ?? 'This'} is required.`;
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  if (!can(Permission.MATERIALS_MANAGE)) return <UnauthorizedState />;
  if (taxonomy.isLoading) return <LoadingState label="Loading categories…" />;
  if (taxonomy.error && !taxonomy.index) return <ErrorState error={taxonomy.error} />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => navigate('/supplier/materials')}
      >
        <ArrowLeft className="size-4" />
        My products
      </Button>

      <PageHeader
        eyebrow="Seller"
        title="Add a product"
        description="Describe it in one line. Saarthi fills in what it can and asks only for what is missing."
      />

      <Card>
        <CardContent className="space-y-6 p-5 sm:p-6">
          {reviewing ? (
            <Review
              name={name}
              path={entry.path}
              details={entry.fields
                .filter((field) => entry.attributes[field.key] !== undefined)
                .map((field) => [field.label, String(entry.attributes[field.key])])}
              price={`${formatCurrency(Number(price))} per ${unitLabel}`}
              stock={`${formatNumber(Number(stock))} ${unitLabel}`}
              minimumOrder={`${formatNumber(Number(minimumOrder) || 1)} ${unitLabel}`}
              onEdit={() => setReviewing(false)}
              onPublish={() => publish.mutate()}
              publishing={publish.isPending}
            />
          ) : (
            <>
              <CommerceEntryPanel
                entry={entry}
                index={taxonomy.index}
                idPrefix="product"
                label="What are you selling?"
                placeholder="Teak wood 6-seater dining table ₹25,000, 5 available"
                hint="Include the price and how many you have, if you like - Saarthi will read them."
                attributeErrors={errors}
                categoryError={errors.categoryId}
              />

              {entry.interpreted ? (
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="section-label">Price &amp; stock</h2>
                    {(priceDetected || stockDetected) && !editingDetected ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingDetected(true)}
                      >
                        <Pencil className="size-3.5" />
                        Edit detected
                      </Button>
                    ) : null}
                  </div>

                  {(priceDetected || stockDetected) && !editingDetected ? (
                    <p className="text-sm text-muted-foreground">
                      {[
                        priceDetected ? `${formatCurrency(Number(price))} per ${unitLabel}` : null,
                        stockDetected
                          ? `${formatNumber(Number(stock))} ${unitLabel} available`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <WizardField
                      label="Product name"
                      htmlFor="product-name"
                      required
                      error={errors.name ?? null}
                    >
                      <Input
                        id="product-name"
                        value={name}
                        maxLength={120}
                        onChange={(event) => setNameOverride(event.target.value)}
                      />
                    </WizardField>
                    <WizardField label="Sold per" htmlFor="product-unit">
                      <Select
                        value={unit}
                        onValueChange={(next) => setUnitOverride(next as MaterialUnit)}
                      >
                        <SelectTrigger id="product-unit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(MaterialUnit).map((value) => (
                            <SelectItem key={value} value={value}>
                              {humanizeEnum(value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </WizardField>
                    {showPrice ? (
                      <WizardField
                        label={`Price per ${unitLabel} (₹)`}
                        htmlFor="product-price"
                        required
                        error={errors.price ?? null}
                      >
                        <Input
                          id="product-price"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={price}
                          aria-invalid={Boolean(errors.price) || undefined}
                          onChange={(event) => setPriceOverride(event.target.value)}
                        />
                      </WizardField>
                    ) : null}
                    {showStock ? (
                      <WizardField
                        label="Available quantity"
                        htmlFor="product-stock"
                        required
                        error={errors.stock ?? null}
                      >
                        <Input
                          id="product-stock"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={stock}
                          aria-invalid={Boolean(errors.stock) || undefined}
                          onChange={(event) => setStockOverride(event.target.value)}
                        />
                      </WizardField>
                    ) : null}
                    <WizardField
                      label="Minimum order"
                      htmlFor="product-minimum"
                      hint={`In ${unitLabel}.`}
                    >
                      <Input
                        id="product-minimum"
                        type="number"
                        min={0}
                        value={minimumOrder}
                        onChange={(event) => setMinimumOrder(event.target.value)}
                      />
                    </WizardField>
                  </div>

                  <WizardField
                    label="Anything else a buyer should know?"
                    htmlFor="product-description"
                    hint="Optional."
                  >
                    <Textarea
                      id="product-description"
                      rows={2}
                      maxLength={2000}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </WizardField>

                  <div className="flex justify-end">
                    <Button type="button" onClick={() => validate() && setReviewing(true)}>
                      Review
                    </Button>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Review({
  name,
  path,
  details,
  price,
  stock,
  minimumOrder,
  onEdit,
  onPublish,
  publishing,
}: {
  name: string;
  path: string[];
  details: string[][];
  price: string;
  stock: string;
  minimumOrder: string;
  onEdit: () => void;
  onPublish: () => void;
  publishing: boolean;
}) {
  const rows: [string, string][] = [
    ['Category', path.join(' › ')],
    ...details.map(([label, value]) => [label!, value!] as [string, string]),
    ['Price', price],
    ['Available', stock],
    ['Minimum order', minimumOrder],
  ];

  return (
    <section className="space-y-5" aria-labelledby="review-heading">
      <div className="space-y-1">
        <p className="section-label">Review before publishing</p>
        <h2 id="review-heading" className="text-lg font-semibold tracking-tight">
          {name}
        </h2>
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Fleet owners see this listing when sourcing for their customers. Buyers never see your
        contact details, and you never see theirs - orders reach you through the fleet owner.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onEdit} disabled={publishing}>
          Edit
        </Button>
        <Button type="button" onClick={onPublish} disabled={publishing}>
          <CheckCircle2 className="size-4" />
          {publishing ? 'Publishing…' : 'Publish product'}
        </Button>
      </div>
    </section>
  );
}

export default NewProductPage;
