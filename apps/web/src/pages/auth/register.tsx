import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, HandshakeIcon, Package, Plane, ShoppingCart, Truck } from 'lucide-react';
import { RoleName, registerSchema, type RegisterInput } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Registration.
 *
 * The account type chosen here decides what Saarthi creates alongside the user
 * — a fleet, a supplier yard, a customer account, a travel operator, a truck
 * association, or a driver profile inside an existing fleet.
 *
 * This choice is not cosmetic. Several surfaces belong to exactly one kind of
 * business: only a travel operator can publish tour packages, only an
 * association can run an emergency queue. The API enforces that by
 * organization type, so picking the wrong one here cannot be worked around
 * later from the UI — it has to be the right account from the start.
 */
const ACCOUNT_TYPES = [
  {
    role: RoleName.FLEET_OWNER,
    icon: Truck,
    title: 'Fleet owner',
    description: 'I own trucks and want to manage my fleet and win loads.',
  },
  {
    role: RoleName.CUSTOMER,
    icon: ShoppingCart,
    title: 'Customer',
    description: 'I need materials moved and want to track the delivery.',
  },
  {
    role: RoleName.SUPPLIER,
    icon: Package,
    title: 'Supplier',
    description: 'I sell materials and arrange dispatch from my yard.',
  },
  {
    role: RoleName.MOBILITY_PROVIDER,
    icon: Plane,
    title: 'Travel & tour operator',
    description: 'I run taxis, buses or tour packages and sell passenger journeys.',
  },
  {
    role: RoleName.ASSOCIATION_ADMIN,
    icon: HandshakeIcon,
    title: 'Truck association',
    description: 'I represent a district association coordinating roadside help.',
  },
  {
    role: RoleName.DRIVER,
    icon: Building2,
    title: 'Driver',
    description: 'I drive for a fleet that already uses Saarthi.',
  },
] as const;

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      role: RoleName.FLEET_OWNER,
      organizationName: '',
      acceptedTerms: false as unknown as true,
    },
  });

  const role = form.watch('role');
  const isDriver = role === RoleName.DRIVER;

  const onSubmit = async (values: RegisterInput): Promise<void> => {
    setFormError(null);
    try {
      await register(values as unknown as Record<string, unknown>);
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        // Re-attach server-side field errors to the matching inputs.
        const fields = error.fieldErrors;
        let attached = false;
        for (const [field, messages] of Object.entries(fields)) {
          if (field in values && messages[0]) {
            form.setError(field as keyof RegisterInput, { message: messages[0] });
            attached = true;
          }
        }
        if (!attached) setFormError(error.message);
      } else {
        setFormError('Unable to create your account right now. Please try again.');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Set up Saarthi for how you actually work.
        </p>
      </div>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>I am a…</FormLabel>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ACCOUNT_TYPES.map((type) => {
                    const selected = field.value === type.role;
                    return (
                      <button
                        key={type.role}
                        type="button"
                        onClick={() => field.onChange(type.role)}
                        aria-pressed={selected}
                        className={cn(
                          'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                          selected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border hover:bg-secondary',
                        )}
                      >
                        <type.icon
                          className={cn(
                            'mt-0.5 size-4 shrink-0',
                            selected ? 'text-primary' : 'text-muted-foreground',
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{type.title}</span>
                          <span className="block text-xs leading-snug text-muted-foreground">
                            {type.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>First name</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="given-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Last name</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="family-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Email address</FormLabel>
                <FormControl>
                  <Input {...field} type="email" autoComplete="email" placeholder="you@company.com" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Mobile number</FormLabel>
                <FormControl>
                  <Input {...field} type="tel" autoComplete="tel" placeholder="9876543210" />
                </FormControl>
                <FormDescription>Indian mobile number, with or without +91.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {isDriver ? (
            <>
              <FormField
                control={form.control}
                name="fleetInviteCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Fleet invite code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="SR-XXXXXX"
                        className="font-mono uppercase"
                      />
                    </FormControl>
                    <FormDescription>Ask your truck owner for this code.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenseNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Driving licence number</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="DL-1420-20100000000" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ) : (
            <FormField
              control={form.control}
              name="organizationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>
                    {role === RoleName.SUPPLIER
                      ? 'Business name'
                      : role === RoleName.ASSOCIATION_ADMIN
                        ? 'Association name'
                        : role === RoleName.MOBILITY_PROVIDER
                          ? 'Travel business name'
                          : 'Company name'}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      autoComplete="organization"
                      placeholder={
                        role === RoleName.FLEET_OWNER
                          ? 'Sharma Transport Company'
                          : 'Kumar Constructions'
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Password</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="new-password" />
                </FormControl>
                <FormDescription>
                  At least 10 characters, with upper case, lower case and a number.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="acceptedTerms"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-2.5">
                  <FormControl>
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      className="mt-0.5"
                    />
                  </FormControl>
                  <FormLabel className="text-sm font-normal leading-snug text-muted-foreground">
                    I agree to the Saarthi terms of service and privacy policy.
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Create account
          </Button>
        </form>
      </Form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default RegisterPage;
