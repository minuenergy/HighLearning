import AuthForm from '@/components/auth/AuthForm'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_20%),linear-gradient(180deg,#eff6ff_0%,#f8fafc_55%,#ffffff_100%)] px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <AuthForm mode="login" />
      </div>
    </div>
  )
}
