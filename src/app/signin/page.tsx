import SignInClient from './SignInClient';

function sanitizeNextPath(value?: string): string {
  if (!value) {
    return '/';
  }
  return value.startsWith('/') ? value : '/';
}

export default async function SignInPage({
  searchParams
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const next = sanitizeNextPath(resolved?.next);

  return (
    <div className="signin-shell">
      <SignInClient next={next} />
    </div>
  );
}
