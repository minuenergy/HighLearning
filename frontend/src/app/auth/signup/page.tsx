import AuthForm from '@/components/auth/AuthForm'

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.10),_transparent_20%),linear-gradient(180deg,#f8fafc_0%,#eef4ff_48%,#ffffff_100%)] px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <AuthForm mode="signup" />
      </div>
    </div>
  )
}
