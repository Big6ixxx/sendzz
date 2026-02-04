'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { ArrowLeft, Copy, LogOut, Shield, Sparkles, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setEmail(user.email || '');
      setLoading(false);
    };
    checkUser();
  }, [router, supabase.auth]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    toast.success('Logged out successfully');
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(email);
    toast.success('Email copied to clipboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Account */}
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Account
            </CardTitle>
            <CardDescription>Your Sendzz account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Email Address
                </p>
                <p className="font-semibold">{email}</p>
              </div>
              <Button variant="outline" size="sm" onClick={copyEmail}>
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Account ID
              </p>
              <p className="font-mono text-sm text-muted-foreground">
                Linked to your email address
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Security
            </CardTitle>
            <CardDescription>Manage your account security</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Authentication</p>
                <p className="text-sm text-muted-foreground">
                  Passwordless login via email OTP
                </p>
              </div>
              <div className="text-sm font-medium text-green-600 bg-green-100 px-3 py-1 rounded-full">
                Enabled
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Withdrawal Verification</p>
                <p className="text-sm text-muted-foreground">
                  OTP required for all withdrawals
                </p>
              </div>
              <div className="text-sm font-medium text-green-600 bg-green-100 px-3 py-1 rounded-full">
                Enabled
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Customization */}
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              Customization
            </CardTitle>
            <CardDescription>
              Personalize your Sendzz experience
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between opacity-60">
              <div>
                <p className="font-semibold">Custom Sendzz Email</p>
                <p className="text-sm text-muted-foreground">
                  Get your own @sendzz.io address
                </p>
              </div>
              <div className="text-xs font-bold text-blue-600 bg-blue-100 px-3 py-1 rounded-full uppercase tracking-wider">
                Coming Soon
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Session */}
        <Card className="border-2 border-red-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <LogOut className="w-5 h-5" />
              Session
            </CardTitle>
            <CardDescription>Manage your current session</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground pt-4">
          <p>Sendzz v1.0.0</p>
          <p className="mt-1">© 2026 Sendzz. All rights reserved.</p>
        </div>
      </main>
    </div>
  );
}
