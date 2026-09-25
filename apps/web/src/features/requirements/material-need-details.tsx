import { MaterialUnit, type CommerceTaxonomyIndex, humanizeEnum } from '@saarthi/shared';
import { WizardField } from '@/components/common/form-wizard';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CommerceEntryPanel } from '@/features/commerce/commerce-entry-panel';
import { attributesForSave, type CommerceEntry } from '@/features/commerce/use-commerce';

/**
 * The details step of a material requirement: "What do you need?"
 *
 * The customer types one line; the category, its details and the quantity are
 * read from it, and only what is missing is asked for. A fleet owner then
 * sources it from a seller and delivers it — there is no seller to pick here.
 */
export function MaterialNeedDetails({
  entry,
  index,
  quantity,
  onQuantityChange,
  unit,
  onUnitChange,
  specification,
  onSpecificationChange,
  errors,
}: {
  entry: CommerceEntry;
  index: CommerceTaxonomyIndex | null;
  quantity: number;
  onQuantityChange: (next: number) => void;
  unit: MaterialUnit;
  onUnitChange: (next: MaterialUnit) => void;
  specification: string;
  onSpecificationChange: (next: string) => void;
  errors: Record<string, string | undefined>;
}) {
  return (
    <>
      <CommerceEntryPanel
        entry={entry}
        index={index}
        idPrefix="need"
        label="What do you need?"
        placeholder="25 tons of river sand from Saharanpur to Lucknow within 3 days"
        hint="Say it the way you would on the phone. Saarthi fills in what it can."
        attributeErrors={errors}
        categoryError={errors.categoryId}
        textError={errors.text}
      />

      {entry.interpreted ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <WizardField label="Quantity" htmlFor="req-quantity" required error={errors.quantity}>
              <Input
                id="req-quantity"
                type="number"
                min={1}
                value={quantity}
                aria-invalid={Boolean(errors.quantity) || undefined}
                onChange={(event) => onQuantityChange(Number(event.target.value))}
              />
            </WizardField>
            <WizardField label="Unit" htmlFor="req-unit">
              <Select value={unit} onValueChange={(value) => onUnitChange(value as MaterialUnit)}>
                <SelectTrigger id="req-unit">
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
          </div>

          <WizardField
            label="Anything else it must meet?"
            htmlFor="req-spec"
            hint="Optional. Fleet owners source against this."
          >
            <Textarea
              id="req-spec"
              value={specification}
              onChange={(event) => onSpecificationChange(event.target.value)}
              rows={2}
              placeholder="ISI marked, delivered in one lot…"
            />
          </WizardField>

          <p className="text-xs text-muted-foreground">
            Fleet owners near you source this from verified sellers and quote one delivered price.
            You deal only with the fleet owner you choose.
          </p>
        </>
      ) : null}
    </>
  );
}

/** The material detail block the API expects, built from the entry. */
export function materialDetailFrom(
  entry: CommerceEntry,
  quantity: number,
  unit: MaterialUnit,
  specification: string,
) {
  const leaf = entry.path[entry.path.length - 1];
  const details = Object.values(attributesForSave(entry)).map(String);
  // A classified need is named by what it is ("River Sand Fine"); an
  // unclassified one keeps the customer's own words.
  const materialName = leaf && !entry.isFallback ? [leaf, ...details].join(' ') : entry.text.trim();

  return {
    materialName: materialName.slice(0, 160),
    ...(entry.categoryId
      ? { categoryId: entry.categoryId, attributes: attributesForSave(entry) }
      : {}),
    quantity,
    unit,
    ...(specification.trim() ? { specification: specification.trim() } : {}),
  };
}
