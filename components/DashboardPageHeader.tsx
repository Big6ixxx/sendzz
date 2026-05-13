interface DashboardPageHeaderProps {
  title: string;
  subtitle: string;
}

export function DashboardPageHeader({
  title,
  subtitle,
}: DashboardPageHeaderProps) {
  return (
    <div className="space-y-1">
      <h1 className="text-4xl font-display font-bold tracking-tight text-brand-secondary">{title}</h1>
      <p className="text-brand-secondary/40 font-medium">{subtitle}</p>
    </div>
  );
}
