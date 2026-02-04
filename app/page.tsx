import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';
import {
  ArrowRight,
  Banknote,
  DollarSign,
  Globe,
  Mail,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If logged in, redirect to dashboard
  if (user) {
    redirect('/dashboard');
  }

  return (
    <main className="min-h-screen bg-linear-to-br from-blue-50 via-white to-violet-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-linear-to-br from-blue-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200/50">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-black tracking-tight bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              SENDZZ
            </span>
          </div>
          <Link href="/login">
            <Button className="font-bold bg-linear-to-r from-blue-600 to-violet-600">
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-20 md:py-32">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-2 rounded-full text-sm font-semibold mb-6">
            <Zap className="w-4 h-4" />
            Instant • Borderless • Payments
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-6">
            Send Money to{' '}
            <span className="bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              Any Email
            </span>{' '}
            Instantly
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Transfer USDC to anyone using just their email address. No wallet
            needed. Withdraw directly to your bank account.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button
                size="lg"
                className="h-14 px-8 text-lg font-bold bg-linear-to-r from-blue-600 to-violet-600 shadow-xl hover:shadow-2xl transition-all"
              >
                <Mail className="mr-2 h-5 w-5" />
                Start Sending
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="h-14 px-8 text-lg font-bold"
            >
              Learn More
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-white rounded-2xl p-8 border-2 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mb-6">
              <Mail className="w-7 h-7 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold mb-3">Email-Based Transfers</h3>
            <p className="text-muted-foreground">
              Send USDC to any email address. Recipients don't need a crypto
              wallet - they sign in with just their email.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 border-2 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mb-6">
              <DollarSign className="w-7 h-7 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-3">Stablecoin Powered</h3>
            <p className="text-muted-foreground">
              All transfers are in USDC - a stablecoin pegged to the US Dollar.
              No volatility, no surprises.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 border-2 shadow-lg hover:shadow-xl transition-shadow">
            <div className="w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center mb-6">
              <Banknote className="w-7 h-7 text-violet-600" />
            </div>
            <h3 className="text-xl font-bold mb-3">Withdraw to Bank</h3>
            <p className="text-muted-foreground">
              Cash out directly to your bank account in NGN, KES, GHS, and more
              currencies. Fast and secure.
            </p>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="bg-linear-to-br from-blue-600 to-violet-600 rounded-3xl p-8 md:p-12 text-white text-center">
          <div className="flex justify-center gap-4 mb-6">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6" />
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Globe className="w-6 h-6" />
            </div>
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6" />
            </div>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Secure, Global, Instant
          </h2>
          <p className="text-blue-100 max-w-2xl mx-auto mb-8">
            Built with enterprise-grade security. Send money across borders in
            seconds, not days. No hidden fees.
          </p>
          <Link href="/login">
            <Button
              size="lg"
              className="h-12 px-8 bg-white text-blue-600 hover:bg-blue-50 font-bold"
            >
              Get Started Free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white/50">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <span className="font-bold text-muted-foreground">
              © 2026 Sendzz. All rights reserved.
            </span>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground">
              Terms
            </a>
            <a href="#" className="hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="hover:text-foreground">
              Support
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
