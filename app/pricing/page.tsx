"use client";

import { usePrivy } from "@privy-io/react-auth";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function PricingPage() {
  const { authenticated, login } = usePrivy();
  const router = useRouter();

  const handleAction = () => {
    if (authenticated) {
      router.push("/dashboard");
    } else {
      login();
    }
  };

  const plans = [
    {
      name: "Personal",
      price: "Free",
      description: "Ideal for individuals sending money to friends and family.",
      features: [
        "Gas-free transfers",
        "Email-based payments",
        "Local fiat ramps",
        "Biometric security",
        "Standard support",
      ],
      cta: "Get Started",
      accent: false,
    },
    {
      name: "Business",
      price: "$49",
      period: "/mo",
      description: "For teams and organizations managing payroll and ops.",
      features: [
        "Everything in Personal",
        "Batch engine access",
        "Multiple sub-accounts",
        "Transaction API access",
        "Priority 24/7 support",
        "Custom webhooks",
      ],
      cta: "Upgrade to Business",
      accent: true,
    },
    {
      name: "Enterprise",
      price: "Custom",
      description:
        "Custom infrastructure and support for high-volume entities.",
      features: [
        "Everything in Business",
        "Dedicated account manager",
        "Whitelabel options",
        "On-premise deployment",
        "SLA guarantees",
        "Audit-ready reporting",
      ],
      cta: "Contact Sales",
      accent: false,
    },
  ];

  return (
    <div
      className="min-h-screen selection:bg-accent/30"
      style={{ background: "#07070a" }}
    >
      {/* Background Ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[10%] left-[20%] w-[60%] h-[60%] rounded-full bg-accent opacity-[0.03] blur-[160px]" />
        <div className="absolute bottom-[20%] right-[10%] w-[50%] h-[50%] rounded-full bg-blue-500 opacity-[0.02] blur-[140px]" />
      </div>

      <header className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center py-5 px-6 md:px-12 bg-[#07070a]/60 backdrop-blur-xl border-b border-white/5">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.svg"
            alt="Sendzz"
            width={100}
            height={30}
            priority
          />
        </Link>
        <button
          onClick={handleAction}
          className="btn-accent h-10 px-6 text-sm rounded-full font-semibold"
        >
          {authenticated ? "Dashboard" : "Get Started"}
        </button>
      </header>

      <main className="pt-40 pb-24 px-6 relative z-10">
        <div className="max-w-6xl mx-auto space-y-24">
          {/* Hero Section */}
          <div className="text-center space-y-6 max-w-2xl mx-auto">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-display text-5xl md:text-7xl font-bold tracking-tight text-brand-secondary"
            >
              Simple. <br />
              Transparent <span className="text-accent">Pricing.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg text-brand-secondary/50 leading-relaxed"
            >
              No hidden fees. No gas costs. Choose the plan that fits your
              scale.
            </motion.p>
          </div>

          {/* Pricing Grid */}
          <div className="grid lg:grid-cols-3 gap-8 items-start">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={cn(
                  "card-glass p-10 flex flex-col h-full",
                  plan.accent &&
                    "border-accent/30 bg-accent/3 scale-105 z-10 shadow-[0_32px_80px_rgba(0,232,122,0.1)]",
                )}
              >
                <div className="space-y-4 mb-10">
                  <h3 className="text-xs font-bold uppercase tracking-[0.25em] text-accent">
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-5xl font-bold text-brand-secondary">
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="text-brand-secondary/30 text-lg">
                        {plan.period}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-brand-secondary/50 leading-relaxed">
                    {plan.description}
                  </p>
                </div>

                <div className="flex-1 space-y-4 mb-10">
                  {plan.features.map((f) => (
                    <div
                      key={f}
                      className="flex items-center gap-3 text-sm font-medium text-brand-secondary/70"
                    >
                      <div className="w-5 h-5 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
                        <Check className="w-3 h-3 text-accent" />
                      </div>
                      {f}
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleAction}
                  className={cn(
                    "w-full h-14 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all",
                    plan.accent
                      ? "bg-accent text-[#07070a] hover:brightness-110"
                      : "bg-white/5 text-brand-secondary border border-white/10 hover:bg-white/8",
                  )}
                >
                  {authenticated ? "Enter Dashboard" : plan.cta}
                </button>
              </motion.div>
            ))}
          </div>

          {/* Fee Table Section */}
          <div className="card-glass p-10 lg:p-16 space-y-12">
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-brand-secondary">
                Transaction Fee Structure
              </h3>
              <p className="text-sm text-brand-secondary/40">
                While network gas is free, we maintain a small spread on fiat
                conversions.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30">
                      Service
                    </th>
                    <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30">
                      Network Fee
                    </th>
                    <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30">
                      Our Fee
                    </th>
                    <th className="py-4 text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30">
                      Settlement
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    {
                      s: "Wallet to Wallet",
                      n: "$0.00",
                      o: "Free",
                      st: "Instant",
                    },
                    {
                      s: "Fiat Deposit (On-ramp)",
                      n: "$0.00",
                      o: "0.8%",
                      st: "< 2 mins",
                    },
                    {
                      s: "Fiat Withdrawal (Off-ramp)",
                      n: "$0.00",
                      o: "1.2%",
                      st: "< 5 mins",
                    },
                    {
                      s: "Batch Disbursement",
                      n: "$0.00",
                      o: "$0.10 / rec",
                      st: "Instant",
                    },
                  ].map((row, i) => (
                    <tr key={i} className="group hover:bg-white/2">
                      <td className="py-6 text-sm font-bold text-brand-secondary">
                        {row.s}
                      </td>
                      <td className="py-6 text-sm font-medium text-accent">
                        {row.n}
                      </td>
                      <td className="py-6 text-sm font-medium text-brand-secondary/60">
                        {row.o}
                      </td>
                      <td className="py-6 text-sm font-medium text-brand-secondary/60">
                        {row.st}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <footer className="py-12 px-12 border-t border-white/5 text-center">
        <p className="text-[11px] font-bold uppercase tracking-widest opacity-20 text-brand-secondary">
          © 2026 Sendzz Global Operations Group
        </p>
      </footer>
    </div>
  );
}

function cn(...classes: unknown[]) {
  return classes.filter(Boolean).join(" ");
}
