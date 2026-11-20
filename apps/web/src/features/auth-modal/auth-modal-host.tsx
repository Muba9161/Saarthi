import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { AuthModal } from './auth-modal';
import { useAuthModal } from './use-auth-modal';

/**
 * The route layout that owns the sign-in modal. It sits above every route, so
 * the modal can open over whichever page the visitor is on, and it renders the
 * modal only for somebody signed out: a signed-in person who follows an old
 * `/login` link is sent on by the landing route instead.
 */
export function AuthModalHost() {
  const { status } = useAuth();
  const { view, show, close } = useAuthModal();

  return (
    <>
      <Outlet />
      {status === 'unauthenticated' ? (
        <AuthModal view={view} onShow={show} onClose={close} />
      ) : null}
    </>
  );
}
