'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError('Incorrect code. Please try again.');
      }
    } catch {
      setError('Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5F5F7] px-4">
      <div className="w-full max-w-[340px]">
        <div className="text-center mb-8">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-[#007AFF] to-[#0055D4] shadow-lg">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" />
              <line x1="12" y1="2" x2="12" y2="5" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="2" y1="12" x2="5" y2="12" />
              <line x1="19" y1="12" x2="22" y2="12" />
            </svg>
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight text-[#1D1D1F]">
            Midpoint
          </h1>
          <p className="mt-1 text-[15px] text-[#86868B]">
            Enter your access code to continue.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-black/[0.04]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code"
              autoFocus
              autoComplete="off"
              className="flex h-[44px] w-full rounded-xl border border-[#D2D2D7] bg-white px-3.5 text-[15px] text-[#1D1D1F] placeholder:text-[#86868B] focus:outline-none focus:ring-[3px] focus:ring-[#007AFF]/20 focus:border-[#007AFF] transition-all"
            />

            {error && (
              <p className="text-[13px] text-[#FF3B30]">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="flex h-[44px] w-full items-center justify-center rounded-xl bg-[#007AFF] text-[15px] font-medium text-white hover:bg-[#0071EB] disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
