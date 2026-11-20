import * as React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import type { AuthView } from './auth-views';
import { useAuthModal } from './use-auth-modal';

/**
 * A link that opens the sign-in modal on `view`, over the page it is on.
 * Drop-in for `<Link to="/login">`: the same element, the right address.
 */
export const AuthLink = React.forwardRef<
  HTMLAnchorElement,
  Omit<LinkProps, 'to'> & { view: AuthView; params?: Readonly<Record<string, string>> }
>(function AuthLink({ view, params, ...props }, ref) {
  const { hrefFor } = useAuthModal();
  return <Link ref={ref} to={hrefFor(view, params)} {...props} />;
});
